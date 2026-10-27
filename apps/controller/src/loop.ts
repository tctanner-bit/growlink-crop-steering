import { env } from './env';
import {
  aggregateReadings, detectObservedIrrigation, EngineEvent, GlDeviceReading, GlSensorReading, initialState, recordManualShot,
  step, idKey, describeEvent,
} from '@gl-steering/core';
import { addEvent, loadActiveRooms, loadRoom, q, RoomRow, ConnectionRow, RoomStateRow } from './db';
import { apiFor, forgetRoom, isSimulated, roomConfig } from './clients';
import { fireShot, roomHasOpenValve, setAllValves } from './executor';
import { roomTuning, runDailyReview, runReviewNow } from './review';
import { syncRoomLights } from './lights';

type Active = RoomRow & { conn: ConnectionRow; state: RoomStateRow | null };

const EVENT_SEVERITY: Record<string, 'info' | 'warning' | 'critical'> = { shot: 'info', shadow_shot: 'info', period: 'info' };
const lastMode = new Map<string, string>();

/** One control tick for every active room. Each API backend is polled once (batched). */
export async function tick() {
  const rooms = await loadActiveRooms();
  const now = new Date();

  // Group rooms that share one API backend so sensors and devices are fetched in one call each.
  const groups = new Map<string, { rooms: Active[]; api: ReturnType<typeof apiFor> }>();
  for (const room of rooms) {
    try {
      const api = apiFor(room, room.conn, room.state);
      const key = api.sim ? `sim:${room.id}` : `conn:${room.conn.id}`;
      const g = groups.get(key) ?? { rooms: [], api };
      g.rooms.push(room);
      groups.set(key, g);
    } catch (e: any) {
      await q(`insert into room_state (room_id, last_error, updated_at) values ($1, $2, now())
               on conflict (room_id) do update set last_error = excluded.last_error, updated_at = now()`, [room.id, String(e?.message ?? e)]);
    }
  }

  await Promise.all([...groups.values()].map(async ({ rooms: grp, api }) => {
    const sensorIds = [...new Set(grp.flatMap((r) => [...r.wc_sensor_ids, ...r.ec_sensor_ids]))];
    const deviceIds = [...new Set(grp.flatMap((r) => r.valve_ids))];
    let sensors: GlSensorReading[] = [];
    let devices: GlDeviceReading[] = [];
    let pollError: string | null = null;
    try {
      [sensors, devices] = await Promise.all([api.api.liveSensors(api.orgId, sensorIds), api.api.liveDevices(api.orgId, deviceIds)]);
      if (!api.sim) await q(`update connections set status = 'ok', last_error = null where id = $1 and status <> 'ok'`, [grp[0].conn.id]);
    } catch (e: any) {
      pollError = String(e?.message ?? e);
      if (!api.sim) await q(`update connections set status = 'error', last_error = $2 where id = $1`, [grp[0].conn.id, pollError]);
    }
    for (const room of grp) {
      try { await tickRoom(room, api, sensors, devices, pollError, now); }
      catch (e: any) {
        console.error(`[room ${room.id}]`, e);
        await q(`update room_state set last_error = $2, updated_at = now() where room_id = $1`, [room.id, String(e?.message ?? e)]);
      }
    }
  }));
}

async function tickRoom(room: Active, api: ReturnType<typeof apiFor>, sensors: GlSensorReading[], devices: GlDeviceReading[], pollError: string | null, now: Date) {
  const cfg = roomConfig(room);
  const tuning = roomTuning(room.phase, room.tuning);
  // Live is locked (env.liveEnabled): a real room left in Live runs exactly like Shadow.
  const liveLocked = room.mode === 'live' && !env.liveEnabled && !isSimulated(room, room.conn);
  const effMode = liveLocked ? 'shadow' : room.mode;
  const engineMode = effMode === 'shadow' ? 'shadow' : effMode === 'live' ? 'live' : 'simulate';
  if (liveLocked && lastMode.get(room.id) !== 'live-locked') {
    await addEvent(room.id, 'mode', 'warning', 'Live control is disabled until valves accept a timed ON command. This room is running as Shadow: decisions are logged, no valves move.');
  }

  // Taking control of real valves: put them in the rest state so no other program irrigates.
  if (effMode === 'live' && lastMode.get(room.id) !== 'live' && room.rest_state === 'off' && !isSimulated(room, room.conn)) {
    try { await setAllValves(room, room.conn, room.state, false); }
    catch (e: any) { await addEvent(room.id, 'valve_error', 'critical', `Could not set valves to OFF when taking control: ${e?.message ?? e}`); }
    await addEvent(room.id, 'mode', 'warning', 'Autopilot is now in control of this room\'s valves. Growlink irrigation automation on these valves is overridden.');
  }
  lastMode.set(room.id, liveLocked ? 'live-locked' : room.mode);

  const readings = aggregateReadings({ wcSensorIds: room.wc_sensor_ids, ecSensorIds: room.ec_sensor_ids }, sensors);
  if (readings.outliers.length) {
    const prev = room.state?.status as any;
    if (!prev?.outliers?.length) await addEvent(room.id, 'sensor_outlier', 'warning', `Ignoring ${readings.outliers.length} WC probe(s) reading far from the others.`, { sensors: readings.outliers });
  }

  let observed = 0;
  let valveObs = room.state?.valve_obs ?? {};
  if (effMode === 'shadow') {
    const d = detectObservedIrrigation(room.valve_ids, valveObs, devices, now);
    observed = d.seconds; valveObs = d.next;
  }
  const valveBusy = await roomHasOpenValve(room.id);

  const res = step({
    now, config: cfg, phase: room.phase, phaseStartDate: room.phase_start_date, tuning,
    state: room.state?.engine ?? initialState(), readings, mode: engineMode, paused: room.paused,
    valveBusy, observedShotSeconds: observed || null,
  });

  const valveOpen = valveBusy || room.valve_ids.some((id) => devices.find((d) => idKey(d.deviceId) === idKey(id))?.isActive);
  const status = { ...res.status, outliers: readings.outliers, pollError, efficiency: res.state.efficiency, dayRate: res.state.dayRatePctPerHour, overnightRate: res.state.overnightRatePctPerHour, tuning, valveOpen };

  await q(`insert into room_state (room_id, engine, status, sim, valve_obs, last_tick_at, last_error, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, now())
           on conflict (room_id) do update set engine = excluded.engine, status = excluded.status, sim = excluded.sim,
             valve_obs = excluded.valve_obs, last_tick_at = excluded.last_tick_at, last_error = excluded.last_error, updated_at = now()`,
    [room.id, JSON.stringify(res.state), JSON.stringify(status), api.sim ? JSON.stringify(api.sim.snapshot()) : null,
      JSON.stringify(valveObs), now, pollError]);

  if (readings.wc != null || readings.ec != null) {
    await q(`insert into readings (room_id, ts, wc, ec, valve_open) values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [room.id, now, readings.wc, readings.ec, valveOpen]);
  }

  for (const e of res.events) {
    if (e.type === 'cycle_started') continue;
    const severity = e.type === 'alert' ? e.severity : EVENT_SEVERITY[e.type] ?? 'info';
    await addEvent(room.id, e.type === 'alert' ? `alert_${e.key}` : e.type, severity, describeEvent(e), e);
    if (e.type === 'day_closed') void runDailyReview(room.id, e.summary).catch((err) => console.error('review', err));
  }

  for (const a of res.actions) {
    await fireShot(room, room.conn, room.state, a.kind, a.seconds);
  }
}

/** UI → controller commands. */
export async function processCommands() {
  const cmds = await q<{ id: number; room_id: string; type: string; payload: any }>(
    `update commands set status = 'done', done_at = now()
      where id in (select id from commands where status = 'pending' order by created_at limit 20 for update skip locked)
      returning id, room_id, type, payload`);
  for (const c of cmds) {
    const room = await loadRoom(c.room_id);
    if (!room) continue;
    try {
      let result = 'ok';
      if (c.type === 'test_shot') {
        if (room.mode === 'off' || room.mode === 'shadow') throw new Error(`Test shots need Simulate or Live mode (room is ${room.mode}).`);
        const seconds = Math.min(roomConfig(room).maxShotSeconds, Math.max(1, Number(c.payload?.seconds ?? 10)));
        if (await roomHasOpenValve(room.id)) throw new Error('A valve is already open.');
        await fireShot(room, room.conn, room.state, 'test', seconds);
        const wc = (room.state?.status as any)?.wc ?? null;
        const engine = recordManualShot(room.state?.engine ?? initialState(), new Date(), seconds, roomConfig(room), wc);
        await q(`update room_state set engine = $2 where room_id = $1`, [room.id, JSON.stringify(engine)]);
        await addEvent(room.id, 'shot', 'info', `Test shot ${seconds}s fired from the dashboard.`, { kind: 'test', seconds });
        result = `Fired ${seconds}s`;
      } else if (c.type === 'all_off') {
        await setAllValves(room, room.conn, room.state, false);
        await addEvent(room.id, 'all_off', 'warning', 'All valves forced OFF from the dashboard.');
      } else if (c.type === 'release_valves') {
        if (!isSimulated(room, room.conn)) await setAllValves(room, room.conn, room.state, 'auto');
        lastMode.delete(room.id);
        forgetRoom(room.id);
        await addEvent(room.id, 'mode', 'info', 'Valves handed back to Growlink automation (AUTO).');
      } else if (c.type === 'sync_lights') {
        result = await syncRoomLights(room, { force: true });
      } else if (c.type === 'run_review') {
        await runReviewNow(room.id);
        result = 'review complete';
      }
      await q(`update commands set result = $2 where id = $1`, [c.id, result]);
    } catch (e: any) {
      await q(`update commands set status = 'failed', result = $2 where id = $1`, [c.id, String(e?.message ?? e)]);
      await addEvent(room.id, 'command_error', 'warning', `${c.type} failed: ${e?.message ?? e}`);
    }
  }
}
