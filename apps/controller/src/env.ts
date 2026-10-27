export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres',
  tickMs: Number(process.env.TICK_MS ?? 30_000),
  watchdogMs: Number(process.env.WATCHDOG_MS ?? 2_000),
  /** Absolute cap on any single valve opening, regardless of room config. */
  hardMaxShotSeconds: Number(process.env.HARD_MAX_SHOT_SECONDS ?? 900),
  // AI keys: Fly secrets only. Never logged, stored or sent to the web app (see ai.ts).
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** 'openai' | 'anthropic'; blank = OpenAI if its key is set, else Anthropic. */
  aiProvider: (process.env.AI_PROVIDER ?? '').toLowerCase(),
  /** Blank = provider default (gpt-6.1-sol / claude-sonnet-5-5). */
  aiModel: process.env.AI_MODEL ?? '',
  growlinkBaseUrl: process.env.GROWLINK_BASE_URL || undefined,
  instanceId: process.env.FLY_MACHINE_ID ?? process.env.HOSTNAME ?? `controller-${process.pid}`,
  version: process.env.APP_VERSION ?? '0.1.0',
  readingsRetentionDays: Number(process.env.READINGS_RETENTION_DAYS ?? 120),
  /**
   * Live control of real valves. OFF until the firmware accepts a timed ON command (v2): with plain
   * ON/OFF a valve can stay open if the cloud is unreachable mid-shot. Set LIVE_ENABLED=1 to unlock.
   */
  liveEnabled: process.env.LIVE_ENABLED === '1',
};
