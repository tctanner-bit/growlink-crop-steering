import { inferLightSchedule } from '@gl-steering/core';
import { addEvent, q, RoomRow, ConnectionRow, RoomStateRow } from './db';
import { apiFor, isSimulated, roomConfig } from './clients';

type RoomWithConn = RoomRow & { conn: ConnectionRow; state: RoomStateRow | null };

const WINDOW_DAYS = 3;

/**
 * Reads the room's real day/night schedule from Growlink (sensor chart `dayNight` markers) and keeps
 * lightsOn / photoperiodHours in step with it. Simulated rooms and rooms with sync turned off are skipped.
 */
export async function syncRoomLights(room: RoomWithConn, opts: { force?: boolean } = {}): Promise<string> {
  const cfg = roomConfig(room);
  if (isSimulated(room, room.conn)) return 'Simulated room — lights come from setup.';
  if (!cfg.lightsSync && !opts.force) return 'Lights sync is off for this room.';
  const sensorIds = [...room.wc_sensor_ids, ...room.ec_sensor_ids].slice(0, 1);
  const note = async (text: string) => {
    await q(`update rooms set config = config || $2::jsonb where id = $1`, [room.id, JSON.stringify({ lightsSyncNote: text })]);
    return text;
  };
  if (!sensorIds.length) return note('Map a sensor first — the light schedule is read alongside its chart.');
  const { api, orgId } = apiFor(room, room.conn, room.state);
  if (!api.sensorChart) return note('This connection cannot read charts.');

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const chart = await api.sensorChart(orgId, sensorIds, start.toISOString(), end.toISOString());
  const sched = inferLightSchedule(chart.dayNight, cfg.timezone, start.toISOString());
  if (!sched) return note(`Growlink reported no complete light cycle in the last ${WINDOW_DAYS} days (lights may be 24 h or the room has no day/night schedule).`);

  const changed = sched.lightsOn !== cfg.lightsOn || sched.photoperiodHours !== cfg.photoperiodHours;
  await q(`update rooms set config = config || $2::jsonb, updated_at = case when $3 then now() else updated_at end where id = $1`, [
    room.id,
    JSON.stringify({ lightsOn: sched.lightsOn, photoperiodHours: sched.photoperiodHours, lightsSyncedAt: end.toISOString(), lightsSyncNote: null }),
    changed,
  ]);
  if (changed) {
    await addEvent(room.id, 'lights_synced', 'info',
      `Lights schedule synced from Growlink: on ${sched.lightsOn}, ${sched.photoperiodHours} h (was ${cfg.lightsOn}, ${cfg.photoperiodHours} h).`,
      { ...sched, previous: { lightsOn: cfg.lightsOn, photoperiodHours: cfg.photoperiodHours } });
  }
  return changed ? `Synced: on ${sched.lightsOn}, ${sched.photoperiodHours} h.` : `In sync: on ${sched.lightsOn}, ${sched.photoperiodHours} h.`;
}

/** Every real room with sync on, in any mode (setup should be right before a room is switched on). */
export async function syncAllLights() {
  const rooms = await q<RoomWithConn>(`
    select r.*, to_char(r.phase_start_date, 'YYYY-MM-DD') as phase_start_date, row_to_json(c.*) as conn,
           case when s.room_id is null then null else row_to_json(s.*) end as state
      from rooms r join connections c on c.id = r.connection_id left join room_state s on s.room_id = r.id
     where c.kind <> 'demo' and coalesce((r.config->>'lightsSync')::boolean, true)`);
  for (const room of rooms) {
    try { await syncRoomLights(room); }
    catch (e: any) { console.error(`[lights ${room.id}]`, e?.message ?? e); }
  }
}
