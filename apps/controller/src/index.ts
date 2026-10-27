import { env } from './env';
import pg from 'pg';
import { pool, q } from './db';
import { migrate } from './migrate';
import { processCommands, tick } from './loop';
import { closeAllOpenRuns, watchdog } from './executor';
import { aiStatus } from './ai';
import { syncAllLights } from './lights';

/**
 * Growlink Autosteer AI controller.
 *
 * Exactly one instance leads (Postgres advisory lock) and runs the control loop. Every
 * instance runs the valve watchdog, so a standby closes valves even if the leader dies mid-shot.
 */
const LOCK_KEY = 0x6c5f737465; // "gl_ste"
let isLeader = false;
let lockClient: pg.PoolClient | null = null;
const startedAt = new Date();

async function tryLead() {
  if (isLeader) return;
  try {
    if (!lockClient) lockClient = await pool.connect();
    const c = lockClient;
    const r = await c.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
    if (r.rows[0].ok) {
      isLeader = true;
      console.log(`[${env.instanceId}] leader — running the control loop`);
      c.on('error', () => { isLeader = false; lockClient = null; });
    }
  } catch (e) {
    console.error('leader election failed', e);
    const c = lockClient as pg.PoolClient | null;
    c?.release(true);
    lockClient = null;
  }
}

async function heartbeat() {
  await q(`insert into controller_status (id, started_at, heartbeat_at, is_leader, version, info)
           values ($1, $2, now(), $3, $4, $5)
           on conflict (id) do update set heartbeat_at = now(), is_leader = excluded.is_leader, version = excluded.version, info = excluded.info`,
    [env.instanceId, startedAt, isLeader, env.version, JSON.stringify({ tickMs: env.tickMs, ai: aiStatus.configured, aiProvider: aiStatus.provider, model: aiStatus.model })]);
}

function every(ms: number, name: string, fn: () => Promise<void>) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch (e) { console.error(`[${name}]`, e); } finally { running = false; }
  };
  void run();
  return setInterval(run, ms);
}

async function main() {
  await migrate();
  console.log(`Autosteer AI controller ${env.version} (${env.instanceId}) — tick ${env.tickMs} ms, AI ${aiStatus.configured ? `${aiStatus.provider}/${aiStatus.model}` : 'disabled'}`);
  every(env.watchdogMs, 'watchdog', watchdog);
  every(5_000, 'leader', tryLead);
  every(10_000, 'heartbeat', heartbeat);
  every(3_000, 'commands', async () => { if (isLeader) await processCommands(); });
  every(env.tickMs, 'tick', async () => { if (isLeader) await tick(); });
  every(30 * 60_000, 'lights', async () => { if (isLeader) await syncAllLights(); });
  setTimeout(() => { if (isLeader) void syncAllLights().catch((e) => console.error('[lights]', e)); }, 20_000);
  every(6 * 3_600_000, 'retention', async () => {
    if (!isLeader) return;
    await q(`delete from readings where ts < now() - make_interval(days => $1)`, [env.readingsRetentionDays]);
    await q(`delete from controller_status where heartbeat_at < now() - interval '1 day'`);
  });

  const shutdown = async (sig: string) => {
    console.log(`${sig} — closing open valves and shutting down`);
    try { await closeAllOpenRuns(); } catch { /* best effort; the next instance's watchdog retries */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// A control loop must never die on one bad promise; log it and keep the watchdog running.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

main().catch((e) => { console.error(e); process.exit(1); });
