import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

export async function migrate() {
  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query(`select name from schema_migrations`)).rows.map((r) => r.name));
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query(`insert into schema_migrations (name) values ($1)`, [f]);
      await c.query('commit');
      console.log(`migrated ${f}`);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
