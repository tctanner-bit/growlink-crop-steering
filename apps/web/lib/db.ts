import 'server-only';
import pg from 'pg';

const g = globalThis as unknown as { __glPool?: pg.Pool };
const url = process.env.DATABASE_URL ?? '';

export const pool = g.__glPool ?? new pg.Pool({
  connectionString: url,
  max: 5,
  ssl: /sslmode=require|supabase\.co|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
});
if (process.env.NODE_ENV !== 'production') g.__glPool = pool;

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}
