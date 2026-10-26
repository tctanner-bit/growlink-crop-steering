import type { GrowlinkApi, ShotKind } from '@gl-steering/core';
import { idKey } from '@gl-steering/core';
import { addEvent, loadRoom, q, RoomRow, ConnectionRow, RoomStateRow } from './db';
import { env } from './env';
import { apiFor } from './clients';

/**
 * Valve executor. Every opening is written to valve_runs *before* the ON command, so a crash
 * at any point leaves a record the watchdog will close. Close = the room's rest state
 * (forced OFF by default, so no other program can irrigate; or AUTO to hand back to Growlink).
 */

interface RunRow { id: number; room_id: string; gl_room_id: string; device_id: string; kind: string; seconds: number; open_until: string; close_attempts: number }

const timers = new Map<number, NodeJS.Timeout>();

export async function fireShot(room: RoomRow, conn: ConnectionRow, state: RoomStateRow | null, kind: ShotKind, seconds: number) {
  const secs = Math.min(env.hardMaxShotSeconds, Math.max(1, Math.round(seconds)));
  const { api, orgId } = apiFor(room, conn, state);
  if (!room.valve_ids.length) {
    await addEvent(room.id, 'valve_error', 'warning', 'Shot skipped: no valves are mapped to this room.');
    return;
  }
  if (room.sequential_valves) {
    // One zone at a time; each opening is its own run so the watchdog covers every valve.
    let offset = 0;
    for (const deviceId of room.valve_ids) {
      const startIn = offset;
      setTimeout(() => { openValve(api, orgId, room, deviceId, kind, secs).catch((e) => valveFailure(room, deviceId, e)); }, startIn * 1000);
      offset += secs + 2;
    }
  } else {
    await Promise.all(room.valve_ids.map((d) => openValve(api, orgId, room, d, kind, secs).catch((e) => valveFailure(room, d, e))));
  }
}

async function valveFailure(room: RoomRow, deviceId: string, e: any) {
  console.error(`[room ${room.id}] valve ${deviceId}`, e);
  await addEvent(room.id, 'valve_error', 'critical', `Shot on valve ${deviceId.slice(0, 8)} failed: ${e?.message ?? e}`).catch(() => undefined);
}

async function openValve(api: GrowlinkApi, orgId: string, room: RoomRow, deviceId: string, kind: ShotKind, seconds: number) {
  const [run] = await q<RunRow>(
    `insert into valve_runs (room_id, gl_room_id, device_id, kind, seconds, open_until)
     values ($1, $2, $3, $4, $5::int, now() + make_interval(secs => $5::int)) returning *`,
    [room.id, room.gl_room_id, deviceId, kind, seconds]);
  try {
    await api.setDeviceState(room.gl_room_id, deviceId, true);
  } catch (e: any) {
    await q(`update valve_runs set status = 'failed', error = $2 where id = $1`, [run.id, String(e?.message ?? e)]);
    await addEvent(room.id, 'valve_error', 'critical', `Valve ${deviceId.slice(0, 8)} did not accept ON: ${e?.message ?? e}. Sending OFF.`);
    await closeRun(run, api, room).catch(() => undefined);
    return;
  }
  await q(`update valve_runs set status = 'open' where id = $1`, [run.id]);
  timers.set(run.id, setTimeout(() => { void closeRun(run, api, room); }, seconds * 1000));

  // Documented pattern: re-poll after every command to confirm.
  try {
    const live = await api.liveDevices(orgId, [deviceId]);
    const r = live.find((x) => idKey(x.deviceId) === idKey(deviceId));
    if (r && r.isActive === false) {
      await addEvent(room.id, 'valve_unconfirmed', 'warning', `Valve ${deviceId.slice(0, 8)} reports inactive right after ON. Check wiring/controller.`);
    }
  } catch { /* confirmation is best-effort; the watchdog guarantees the close */ }
}

async function closeRun(run: RunRow, api: GrowlinkApi, room: RoomRow) {
  const t = timers.get(run.id);
  if (t) { clearTimeout(t); timers.delete(run.id); }
  const rest = room.rest_state === 'auto' ? 'auto' : false;
  try {
    await api.setDeviceState(run.gl_room_id, run.device_id, rest);
    await q(`update valve_runs set status = 'closed', closed_at = now(), close_attempts = close_attempts + 1 where id = $1 and closed_at is null`, [run.id]);
  } catch (e: any) {
    const [r] = await q<{ close_attempts: number }>(
      `update valve_runs set close_attempts = close_attempts + 1, error = $2 where id = $1 returning close_attempts`, [run.id, String(e?.message ?? e)]);
    if (r && (r.close_attempts === 1 || r.close_attempts % 10 === 0)) {
      await addEvent(run.room_id, 'valve_stuck', 'critical',
        `Could not close valve ${run.device_id.slice(0, 8)} (attempt ${r.close_attempts}): ${e?.message ?? e}. Retrying every ${env.watchdogMs / 1000}s. Check the room.`);
    }
  }
}

/**
 * Watchdog: closes every run past its deadline that is still open — timer missed, process
 * restarted, or an earlier close failed. Runs on every instance; closing is idempotent.
 */
export async function watchdog() {
  const overdue = await q<RunRow>(
    `select * from valve_runs where closed_at is null and status <> 'failed' and open_until < now() - interval '2 seconds' order by open_until limit 50`);
  for (const run of overdue) {
    if (timers.has(run.id) && run.close_attempts === 0) continue; // timer about to fire
    const room = await loadRoom(run.room_id);
    if (!room) { await q(`update valve_runs set status = 'closed', closed_at = now(), error = 'room deleted' where id = $1`, [run.id]); continue; }
    const { api } = apiFor(room, room.conn, room.state);
    await closeRun(run, api, room);
  }
  // Failed opens still get a best-effort close until confirmed.
  const failed = await q<RunRow>(`select * from valve_runs where closed_at is null and status = 'failed' and close_attempts < 20 limit 20`);
  for (const run of failed) {
    const room = await loadRoom(run.room_id);
    if (!room) continue;
    await closeRun(run, apiFor(room, room.conn, room.state).api, room);
  }
}

/** Close every open run now — used on shutdown so no shot outlives the process. */
export async function closeAllOpenRuns() {
  const open = await q<RunRow>(`select * from valve_runs where closed_at is null`);
  for (const run of open) {
    const room = await loadRoom(run.room_id);
    if (room) await closeRun(run, apiFor(room, room.conn, room.state).api, room).catch(() => undefined);
  }
}

export async function roomHasOpenValve(roomId: string): Promise<boolean> {
  const [r] = await q<{ n: number }>(`select count(*)::int as n from valve_runs where room_id = $1 and closed_at is null and status in ('opening', 'open')`, [roomId]);
  return (r?.n ?? 0) > 0;
}

/** Force every mapped valve to OFF (emergency stop) or AUTO (hand back to Growlink). */
export async function setAllValves(room: RoomRow, conn: ConnectionRow, state: RoomStateRow | null, value: false | 'auto') {
  const { api } = apiFor(room, conn, state);
  const open = await q<RunRow>(`select * from valve_runs where room_id = $1 and closed_at is null`, [room.id]);
  for (const run of open) {
    const t = timers.get(run.id);
    if (t) { clearTimeout(t); timers.delete(run.id); }
  }
  const errors: string[] = [];
  for (const d of room.valve_ids) {
    try { await api.setDeviceState(room.gl_room_id, d, value); } catch (e: any) { errors.push(`${d.slice(0, 8)}: ${e?.message ?? e}`); }
  }
  // Only mark runs closed once every valve accepted the command; otherwise the watchdog keeps retrying.
  if (errors.length) throw new Error(errors.join('; '));
  await q(`update valve_runs set status = 'closed', closed_at = now() where room_id = $1 and closed_at is null`, [room.id]);
}
