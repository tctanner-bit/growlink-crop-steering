import pg from 'pg';
import { env } from './env';
import type { EngineState, EngineStatus, RoomConfig, Tuning, PhaseId, SimSnapshot } from '@gl-steering/core';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 8,
  ssl: /sslmode=require|supabase\.co|pooler\.supabase/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

export type Mode = 'off' | 'simulate' | 'shadow' | 'live';

export interface ConnectionRow {
  id: string; owner_id: string; kind: 'growlink' | 'demo'; label: string; org_id: string; org_name: string;
  key_ciphertext: string | null; key_iv: string | null; key_tag: string | null; key_last4: string | null;
}

export interface RoomRow {
  id: string; connection_id: string; gl_room_id: string; name: string; mode: Mode; phase: PhaseId;
  phase_start_date: string; config: Partial<RoomConfig>; wc_sensor_ids: string[]; ec_sensor_ids: string[];
  valve_ids: string[]; sequential_valves: boolean; rest_state: 'off' | 'auto'; paused: boolean;
  ai_mode: 'off' | 'suggest' | 'apply'; post_to_tasks: boolean; grower_notes: string | null; tuning: Partial<Tuning>;
}

export interface RoomStateRow {
  room_id: string; engine: EngineState | null; status: EngineStatus | null; sim: SimSnapshot | null;
  valve_obs: Record<string, { active: boolean; since: string | null }>;
}

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

export async function loadActiveRooms() {
  return q<RoomRow & { conn: ConnectionRow; state: RoomStateRow | null }>(`
    select r.*, to_char(r.phase_start_date, 'YYYY-MM-DD') as phase_start_date,
           row_to_json(c.*) as conn,
           case when s.room_id is null then null else row_to_json(s.*) end as state
      from rooms r
      join connections c on c.id = r.connection_id
      left join room_state s on s.room_id = r.id
     where r.mode <> 'off'
     order by r.connection_id, r.id`);
}

export async function loadRoom(roomId: string) {
  const rows = await q<RoomRow & { conn: ConnectionRow; state: RoomStateRow | null }>(`
    select r.*, to_char(r.phase_start_date, 'YYYY-MM-DD') as phase_start_date,
           row_to_json(c.*) as conn,
           case when s.room_id is null then null else row_to_json(s.*) end as state
      from rooms r join connections c on c.id = r.connection_id
      left join room_state s on s.room_id = r.id
     where r.id = $1`, [roomId]);
  return rows[0] ?? null;
}

export async function addEvent(roomId: string, type: string, severity: 'info' | 'warning' | 'critical', message: string, data: unknown = {}) {
  await q(`insert into events (room_id, type, severity, message, data) values ($1, $2, $3, $4, $5)`, [roomId, type, severity, message, JSON.stringify(data)]);
}
