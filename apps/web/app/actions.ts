'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  HttpGrowlinkClient, GrowlinkError, DEMO_ORG, demoFarmSpecs, PhaseId, PHASES, TuningKey, clampTuning, defaultTuning,
  DEFAULT_ROOM_CONFIG, backfillRoom,
} from '@gl-steering/core';
import { seal } from '@gl-steering/core/vault';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { getConnection, getRoom, Mode } from '@/lib/data';
import { apiForConnection } from '@/lib/growlink';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

// ── Connections ──────────────────────────────────────────────────────────────

/** Step 1 of onboarding: validate a key and list the organizations it can see. Nothing is stored. */
export async function checkApiKey(apiKey: string): Promise<{ ok: true; orgs: { id: string; name: string }[] } | { ok: false; error: string }> {
  await requireUser();
  const key = apiKey.trim();
  if (key.length < 10) return { ok: false, error: 'That does not look like a Growlink API key.' };
  try {
    const orgs = await new HttpGrowlinkClient({ apiKey: key, baseUrl: process.env.GROWLINK_BASE_URL || undefined }).listOrganizations();
    if (!orgs.length) return { ok: false, error: 'The key is valid but no organizations are linked to it.' };
    return { ok: true, orgs: orgs.map((o) => ({ id: o.id, name: o.name })) };
  } catch (e) {
    return { ok: false, error: e instanceof GrowlinkError ? e.message : 'Could not reach the Growlink API.' };
  }
}

/** Step 2: seal the key and store the connection for one organization. */
export async function createConnection(apiKey: string, orgId: string, orgName: string, label: string) {
  const user = await requireUser();
  const check = await checkApiKey(apiKey);
  if (!check.ok) return fail(check.error);
  const org = check.orgs.find((o) => o.id.toLowerCase() === orgId.toLowerCase());
  if (!org) return fail('That organization is not visible to this key.');
  const s = seal(apiKey.trim());
  const [c] = await q<{ id: string }>(
    `insert into connections (owner_id, kind, label, org_id, org_name, key_ciphertext, key_iv, key_tag, key_last4)
     values ($1, 'growlink', $2, $3, $4, $5, $6, $7, $8) returning id`,
    [user.id, label.trim() || org.name, org.id, org.name || orgName, s.ciphertext, s.iv, s.tag, s.last4]);
  redirect(`/connections/${c.id}`);
}

/** A fully simulated farm — three rooms mapped and steering in Simulate mode. */
export async function createDemoFarm() {
  const user = await requireUser();
  const existing = await q(`select id from connections where owner_id = $1 and kind = 'demo'`, [user.id]);
  if (existing.length) redirect('/');
  const [c] = await q<{ id: string }>(
    `insert into connections (owner_id, kind, label, org_id, org_name) values ($1, 'demo', 'Demo Farm', $2, $3) returning id`,
    [user.id, DEMO_ORG.id, DEMO_ORG.name]);
  // Each room opens with three days of simulated steering history — same engine and rules as production.
  const specs = demoFarmSpecs();
  const histories = await Promise.all(specs.map((s) => backfillRoom(s, 3)));
  for (const [i, s] of specs.entries()) {
    const h = histories[i];
    const [room] = await q<{ id: string }>(
      `insert into rooms (connection_id, gl_room_id, name, mode, phase, phase_start_date, config, wc_sensor_ids, ec_sensor_ids, valve_ids, ai_mode, tuning)
       values ($1, $2, $3, 'simulate', $4, $5, $6, $7, $8, $9, 'apply', $10) returning id`,
      [c.id, s.roomId, s.name, s.phase, s.phaseStartDate,
        JSON.stringify({ timezone: s.timezone, lightsOn: s.lightsOn, photoperiodHours: s.photoperiodHours }),
        s.wcSensorIds, s.ecSensorIds, s.valveIds, JSON.stringify(h.tuning)]);
    await q(`insert into readings (room_id, ts, wc, ec, valve_open)
             select $1, x.ts, x.wc, x.ec, x.valve from jsonb_to_recordset($2::jsonb) as x(ts timestamptz, wc real, ec real, valve boolean)
             on conflict do nothing`, [room.id, JSON.stringify(h.readings)]);
    await q(`insert into events (room_id, ts, type, severity, message, data)
             select $1, x.ts, x.type, x.severity, x.message, x.data from jsonb_to_recordset($2::jsonb) as x(ts timestamptz, type text, severity text, message text, data jsonb)`,
      [room.id, JSON.stringify(h.events)]);
    for (const d of h.summaries) {
      await q(`insert into day_summaries (room_id, cycle_key, summary) values ($1, $2, $3) on conflict do nothing`, [room.id, d.cycleKey, JSON.stringify(d)]);
    }
    for (const r of h.ruleReviews) {
      await q(`insert into reviews (room_id, cycle_key, source, summary, changes, applied) values ($1, $2, 'rules', $3, $4, true)`,
        [room.id, r.cycleKey, r.changes.map((c) => c.reason).join(' '), JSON.stringify(r.changes)]);
    }
    await q(`insert into room_state (room_id, engine, sim, last_tick_at) values ($1, $2, $3, now())`,
      [room.id, JSON.stringify(h.state), JSON.stringify(h.snapshot)]);
  }
  revalidatePath('/');
  redirect('/');
}

export async function deleteConnection(connectionId: string): Promise<ActionResult> {
  const user = await requireUser();
  const live = await q(`select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = $1 and c.id = $2 and r.mode = 'live'`, [user.id, connectionId]);
  if (live.length) return fail('Switch every room on this connection out of Live before removing it.');
  await q(`delete from connections where owner_id = $1 and id = $2`, [user.id, connectionId]);
  revalidatePath('/');
  redirect('/');
}

export async function importRooms(connectionId: string, glRoomIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  const conn = await getConnection(user.id, connectionId);
  if (!conn) return fail('Connection not found.');
  const api = apiForConnection(conn);
  const rooms = await api.listRooms(conn.org_id);
  let n = 0;
  for (const id of glRoomIds) {
    const r = rooms.find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!r) continue;
    await q(`insert into rooms (connection_id, gl_room_id, name, config) values ($1, $2, $3, $4) on conflict (connection_id, gl_room_id) do nothing`,
      [conn.id, r.id, r.name, JSON.stringify({ timezone: DEFAULT_ROOM_CONFIG.timezone })]);
    n++;
  }
  revalidatePath('/');
  return { ok: true, message: `Imported ${n} room${n === 1 ? '' : 's'}.` };
}

// ── Rooms ────────────────────────────────────────────────────────────────────

async function ownedRoom(roomId: string) {
  const user = await requireUser();
  const room = await getRoom(user.id, roomId);
  if (!room) throw new Error('Room not found');
  return { user, room };
}

export interface RoomSetupInput {
  wcSensorIds: string[]; ecSensorIds: string[]; valveIds: string[];
  sequentialValves: boolean; restState: 'off' | 'auto';
  timezone: string; lightsOn: string; photoperiodHours: number;
  blockVolumeL: number; emitterFlowMlPerMin: number; emittersPerBlock: number;
  minShotSeconds: number; maxShotSeconds: number; emergencyWcFloor: number | null;
  postToTasks: boolean; growerNotes: string;
}

export async function saveRoomSetup(roomId: string, input: RoomSetupInput): Promise<ActionResult> {
  const { room } = await ownedRoom(roomId);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.lightsOn)) return fail('Lights-on must be HH:MM (24 h).');
  if (!(input.photoperiodHours > 0 && input.photoperiodHours <= 24)) return fail('Photoperiod must be between 1 and 24 hours.');
  if (!(input.blockVolumeL > 0.1 && input.blockVolumeL < 50)) return fail('Block volume looks wrong.');
  if (!(input.emitterFlowMlPerMin > 1 && input.emitterFlowMlPerMin < 2000)) return fail('Emitter flow looks wrong (ml/min).');
  if (!(input.maxShotSeconds >= input.minShotSeconds && input.maxShotSeconds <= 900)) return fail('Max shot must be ≥ min shot and ≤ 900 s.');
  try { Intl.DateTimeFormat('en-US', { timeZone: input.timezone }); } catch { return fail('Unknown time zone.'); }
  if (room.mode === 'live' && input.valveIds.length === 0) return fail('A live room needs at least one valve.');
  const config = {
    timezone: input.timezone, lightsOn: input.lightsOn, photoperiodHours: input.photoperiodHours,
    blockVolumeL: input.blockVolumeL, emitterFlowMlPerMin: input.emitterFlowMlPerMin, emittersPerBlock: input.emittersPerBlock,
    minShotSeconds: input.minShotSeconds, maxShotSeconds: input.maxShotSeconds, emergencyWcFloor: input.emergencyWcFloor,
  };
  await q(`update rooms set wc_sensor_ids = $2, ec_sensor_ids = $3, valve_ids = $4, sequential_valves = $5, rest_state = $6,
                            config = $7, post_to_tasks = $8, grower_notes = $9, updated_at = now() where id = $1`,
    [roomId, input.wcSensorIds, input.ecSensorIds, input.valveIds, input.sequentialValves, input.restState,
      JSON.stringify(config), input.postToTasks, input.growerNotes.trim() || null]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true, message: 'Setup saved.' };
}

export async function setMode(roomId: string, mode: Mode, confirmLive = false): Promise<ActionResult> {
  const { user, room } = await ownedRoom(roomId);
  if (mode === room.mode) return { ok: true };
  if (mode !== 'off' && room.wc_sensor_ids.length === 0) return fail('Map at least one water-content sensor first.');
  if ((mode === 'live' || mode === 'simulate') && room.valve_ids.length === 0) return fail('Map at least one valve first.');
  if (mode === 'live') {
    if (room.conn_kind === 'demo') return fail('The demo farm is simulated end to end — Simulate is its live mode.');
    if (!confirmLive) return fail('Confirm that the autopilot will take control of these valves.');
  }
  await q(`update rooms set mode = $2, updated_at = now() where id = $1`, [roomId, mode]);
  if (room.mode === 'live') {
    await q(`insert into commands (room_id, created_by, type) values ($1, $2, 'release_valves')`, [roomId, user.id]);
  }
  await q(`insert into events (room_id, type, severity, message) values ($1, 'mode', $2, $3)`,
    [roomId, mode === 'live' ? 'warning' : 'info', `Mode changed from ${room.mode} to ${mode} by ${user.email || 'user'}.`]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

export async function setPaused(roomId: string, paused: boolean): Promise<ActionResult> {
  const { user } = await ownedRoom(roomId);
  await q(`update rooms set paused = $2, updated_at = now() where id = $1`, [roomId, paused]);
  await q(`insert into events (room_id, type, message) values ($1, 'mode', $2)`, [roomId, `${paused ? 'Paused' : 'Resumed'} by ${user.email || 'user'}.`]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

export async function setPhase(roomId: string, phase: PhaseId, startDate: string): Promise<ActionResult> {
  const { user, room } = await ownedRoom(roomId);
  if (!PHASES[phase]) return fail('Unknown phase.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail('Start date must be YYYY-MM-DD.');
  // A new phase starts from that phase's default steering; calibration in the engine carries over.
  const resetTuning = phase !== room.phase;
  await q(`update rooms set phase = $2, phase_start_date = $3, tuning = case when $4 then '{}'::jsonb else tuning end, updated_at = now() where id = $1`,
    [roomId, phase, startDate, resetTuning]);
  await q(`insert into events (room_id, type, message) values ($1, 'phase', $2)`,
    [roomId, `Phase set to ${phase} — ${PHASES[phase].name} (from ${startDate}) by ${user.email || 'user'}.${resetTuning ? ' Tuning reset to phase defaults.' : ''}`]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

export async function setAiMode(roomId: string, aiMode: 'off' | 'suggest' | 'apply'): Promise<ActionResult> {
  await ownedRoom(roomId);
  await q(`update rooms set ai_mode = $2, updated_at = now() where id = $1`, [roomId, aiMode]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

export async function saveTuning(roomId: string, values: Partial<Record<TuningKey, number>>): Promise<ActionResult> {
  const { user, room } = await ownedRoom(roomId);
  const next = clampTuning(room.phase, { ...defaultTuning(room.phase), ...room.tuning, ...values });
  await q(`update rooms set tuning = $2, updated_at = now() where id = $1`, [roomId, JSON.stringify(next)]);
  await q(`insert into events (room_id, type, message) values ($1, 'tuning', $2)`, [roomId, `Tuning edited by ${user.email || 'user'}.`]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true, message: 'Tuning saved — applies on the next tick.' };
}

export async function applySuggestion(roomId: string, reviewId: number): Promise<ActionResult> {
  const { user, room } = await ownedRoom(roomId);
  const [rv] = await q<{ changes: { key: TuningKey; to: number }[]; applied: boolean }>(`select changes, applied from reviews where id = $1 and room_id = $2`, [reviewId, roomId]);
  if (!rv) return fail('Review not found.');
  if (rv.applied) return { ok: true };
  const values = Object.fromEntries(rv.changes.map((c) => [c.key, c.to]));
  const next = clampTuning(room.phase, { ...defaultTuning(room.phase), ...room.tuning, ...values });
  await q(`update rooms set tuning = $2, updated_at = now() where id = $1`, [roomId, JSON.stringify(next)]);
  await q(`update reviews set applied = true where id = $1`, [reviewId]);
  await q(`insert into events (room_id, type, message) values ($1, 'tuning', $2)`, [roomId, `AI suggestion applied by ${user.email || 'user'}.`]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true };
}

export async function resetTuning(roomId: string): Promise<ActionResult> {
  await ownedRoom(roomId);
  await q(`update rooms set tuning = '{}'::jsonb, updated_at = now() where id = $1`, [roomId]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true, message: 'Tuning reset to phase defaults.' };
}

export async function sendCommand(roomId: string, type: 'test_shot' | 'all_off' | 'run_review', payload: Record<string, unknown> = {}): Promise<ActionResult> {
  const { user, room } = await ownedRoom(roomId);
  if (type === 'test_shot' && !(room.mode === 'live' || room.mode === 'simulate')) return fail('Test shots need Simulate or Live mode.');
  await q(`insert into commands (room_id, created_by, type, payload) values ($1, $2, $3, $4)`, [roomId, user.id, type, JSON.stringify(payload)]);
  revalidatePath(`/rooms/${roomId}`);
  return { ok: true, message: type === 'all_off' ? 'All-off sent.' : type === 'test_shot' ? 'Test shot queued.' : 'Review requested.' };
}

export async function deleteRoom(roomId: string): Promise<ActionResult> {
  const { room } = await ownedRoom(roomId);
  if (room.mode === 'live') return fail('Switch the room out of Live first so its valves are handed back.');
  await q(`delete from rooms where id = $1`, [roomId]);
  revalidatePath('/');
  redirect('/');
}
