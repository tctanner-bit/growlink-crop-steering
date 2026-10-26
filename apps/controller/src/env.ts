export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres',
  tickMs: Number(process.env.TICK_MS ?? 30_000),
  watchdogMs: Number(process.env.WATCHDOG_MS ?? 2_000),
  /** Absolute cap on any single valve opening, regardless of room config. */
  hardMaxShotSeconds: Number(process.env.HARD_MAX_SHOT_SECONDS ?? 900),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-sonnet-5-5',
  growlinkBaseUrl: process.env.GROWLINK_BASE_URL || undefined,
  instanceId: process.env.FLY_MACHINE_ID ?? process.env.HOSTNAME ?? `controller-${process.pid}`,
  version: process.env.APP_VERSION ?? '0.1.0',
  readingsRetentionDays: Number(process.env.READINGS_RETENTION_DAYS ?? 120),
};
