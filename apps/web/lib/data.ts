import 'server-only';
import { q } from './db';
import type { DaySummary, EngineStatus, PhaseId, RoomConfig, Tuning } from '@gl-steering/core';

export type Mode = 'off' | 'simulate' | 'shadow' | 'live';

export interface Connection {
  id: string; kind: 'growlink' | 'demo'; label: string; org_id: string; org_name: string;
  key_last4: string | null; status: 'ok' | 'error'; last_error: string | null; created_at: string;
}

export interface Room {
  id: string; connection_id: string; gl_room_id: string; name: string; mode: Mode; phase: PhaseId;
  phase_start_date: string; config: Partial<RoomConfig>; wc_sensor_ids: string[]; ec_sensor_ids: string[];
  valve_ids: string[]; sequential_valves: boolean; rest_state: 'off' | 'auto'; paused: boolean;
  ai_mode: 'off' | 'suggest' | 'apply'; post_to_tasks: boolean; grower_notes: string | null; tuning: Partial<Tuning>;
  conn_label: string; conn_kind: 'growlink' | 'demo'; org_name: string;
  status: (EngineStatus & { tuning?: Tuning; valveOpen?: boolean; efficiency?: number; dayRate?: number | null; outliers?: string[]; pollError?: string | null }) | null;
  last_tick_at: string | null; last_error: string | null;
}

const ROOM_SELECT = `
  select r.*, to_char(r.phase_start_date, 'YYYY-MM-DD') as phase_start_date,
         c.label as conn_label, c.kind as conn_kind, c.org_name,
         s.status, s.last_tick_at, s.last_error
    from rooms r
    join connections c on c.id = r.connection_id
    left join room_state s on s.room_id = r.id`;

export async function listConnections(ownerId: string) {
  return q<Connection>(`select id, kind, label, org_id, org_name, key_last4, status, last_error, created_at from connections where owner_id = $1 order by created_at`, [ownerId]);
}

export async function getConnection(ownerId: string, id: string) {
  const [c] = await q<Connection & { key_ciphertext: string | null; key_iv: string | null; key_tag: string | null }>(
    `select * from connections where owner_id = $1 and id = $2`, [ownerId, id]);
  return c ?? null;
}

export async function listRooms(ownerId: string) {
  return q<Room>(`${ROOM_SELECT} where c.owner_id = $1 order by c.created_at, r.name`, [ownerId]);
}

export async function getRoom(ownerId: string, roomId: string) {
  const [r] = await q<Room>(`${ROOM_SELECT} where c.owner_id = $1 and r.id = $2`, [ownerId, roomId]);
  return r ?? null;
}

export async function roomReadings(roomId: string, hours: number) {
  // Down-sample to ≤ ~600 points per window.
  const bucketSec = Math.max(30, Math.round((hours * 3600) / 600));
  return q<{ t: string; wc: number | null; ec: number | null; valve: boolean }>(
    `select to_timestamp(floor(extract(epoch from ts) / $3) * $3) as t,
            avg(wc)::real as wc, avg(ec)::real as ec, bool_or(valve_open) as valve
       from readings where room_id = $1 and ts > now() - make_interval(hours => $2)
      group by 1 order by 1`, [roomId, hours, bucketSec]);
}

export async function roomShots(roomId: string, hours: number) {
  return q<{ ts: string; type: string; data: any }>(
    `select ts, type, data from events where room_id = $1 and type in ('shot', 'shadow_shot') and ts > now() - make_interval(hours => $2) order by ts`, [roomId, hours]);
}

export async function roomEvents(roomId: string, limit = 60) {
  return q<{ id: number; ts: string; type: string; severity: 'info' | 'warning' | 'critical'; message: string }>(
    `select id, ts, type, severity, message from events where room_id = $1 order by ts desc, id desc limit $2`, [roomId, limit]);
}

export async function roomReviews(roomId: string, limit = 10) {
  return q<{ id: number; cycle_key: string | null; created_at: string; source: 'rules' | 'ai'; assessment: string | null; summary: string | null;
    changes: { key: keyof Tuning; from: number; to: number; reason: string }[]; applied: boolean; phase_advance: { recommend: boolean; reason: string } | null;
    alerts: string[]; model: string | null; error: string | null }>(
    `select id, to_char(cycle_key, 'YYYY-MM-DD') as cycle_key, created_at, source, assessment, summary, changes, applied, phase_advance, alerts, model, error
       from reviews where room_id = $1 order by created_at desc, id desc limit $2`, [roomId, limit]);
}

export async function roomDays(roomId: string, limit = 14) {
  return q<{ cycle_key: string; summary: DaySummary }>(
    `select to_char(cycle_key, 'YYYY-MM-DD') as cycle_key, summary from day_summaries where room_id = $1 order by cycle_key desc limit $2`, [roomId, limit]);
}

export async function pendingCommands(roomId: string) {
  return q<{ id: number; type: string; created_at: string }>(
    `select id, type, created_at from commands where room_id = $1 and (status = 'pending' or (type = 'run_review' and created_at > now() - interval '2 minutes' and status = 'done' and result is null)) order by id`, [roomId]);
}

export async function controllerHealth() {
  const [r] = await q<{ heartbeat_at: string; is_leader: boolean; version: string; info: any; age: number }>(
    `select heartbeat_at, is_leader, version, info, extract(epoch from now() - heartbeat_at)::int as age
       from controller_status order by is_leader desc, heartbeat_at desc limit 1`);
  return r ?? null;
}
