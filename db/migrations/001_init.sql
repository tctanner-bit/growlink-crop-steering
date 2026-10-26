-- Crop Steering Autopilot — core schema (Postgres 15+, Supabase-compatible).
create extension if not exists pgcrypto;

-- A tenant's link to one Growlink organization. API keys are AES-256-GCM sealed;
-- the plaintext never leaves the server process.
create table if not exists connections (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  kind            text not null default 'growlink' check (kind in ('growlink', 'demo')),
  label           text not null,
  org_id          text not null,
  org_name        text not null,
  key_ciphertext  text,
  key_iv          text,
  key_tag         text,
  key_last4       text,
  status          text not null default 'ok' check (status in ('ok', 'error')),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (kind = 'demo' or (key_ciphertext is not null and key_iv is not null and key_tag is not null))
);
create index if not exists connections_owner_idx on connections (owner_id);

create table if not exists rooms (
  id                uuid primary key default gen_random_uuid(),
  connection_id     uuid not null references connections (id) on delete cascade,
  gl_room_id        text not null,
  name              text not null,
  mode              text not null default 'off' check (mode in ('off', 'simulate', 'shadow', 'live')),
  phase             smallint not null default 3 check (phase between 1 and 5),
  phase_start_date  date not null default current_date,
  config            jsonb not null default '{}'::jsonb,
  wc_sensor_ids     text[] not null default '{}',
  ec_sensor_ids     text[] not null default '{}',
  valve_ids         text[] not null default '{}',
  sequential_valves boolean not null default false,
  rest_state        text not null default 'off' check (rest_state in ('off', 'auto')),
  paused            boolean not null default false,
  ai_mode           text not null default 'suggest' check (ai_mode in ('off', 'suggest', 'apply')),
  post_to_tasks     boolean not null default false,
  grower_notes      text,
  tuning            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (connection_id, gl_room_id)
);

-- Controller-owned runtime state (engine state machine, last status, simulator snapshot).
create table if not exists room_state (
  room_id      uuid primary key references rooms (id) on delete cascade,
  engine       jsonb,
  status       jsonb,
  sim          jsonb,
  valve_obs    jsonb not null default '{}'::jsonb,
  last_tick_at timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now()
);

create table if not exists readings (
  room_id    uuid not null references rooms (id) on delete cascade,
  ts         timestamptz not null,
  wc         real,
  ec         real,
  valve_open boolean not null default false,
  primary key (room_id, ts)
);

create table if not exists events (
  id        bigserial primary key,
  room_id   uuid not null references rooms (id) on delete cascade,
  ts        timestamptz not null default now(),
  type      text not null,
  severity  text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  message   text not null,
  data      jsonb not null default '{}'::jsonb
);
create index if not exists events_room_ts_idx on events (room_id, ts desc);

-- Every valve opening the controller makes. The watchdog closes anything past open_until,
-- including runs orphaned by a crash or deploy.
create table if not exists valve_runs (
  id             bigserial primary key,
  room_id        uuid not null references rooms (id) on delete cascade,
  gl_room_id     text not null,
  device_id      text not null,
  kind           text not null,
  seconds        integer not null check (seconds > 0),
  opened_at      timestamptz not null default now(),
  open_until     timestamptz not null,
  closed_at      timestamptz,
  close_attempts integer not null default 0,
  status         text not null default 'opening' check (status in ('opening', 'open', 'closed', 'failed')),
  error          text
);
create index if not exists valve_runs_open_idx on valve_runs (open_until) where closed_at is null;

create table if not exists day_summaries (
  room_id    uuid not null references rooms (id) on delete cascade,
  cycle_key  date not null,
  summary    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, cycle_key)
);

create table if not exists reviews (
  id            bigserial primary key,
  room_id       uuid not null references rooms (id) on delete cascade,
  cycle_key     date,
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('rules', 'ai')),
  assessment    text,
  summary       text,
  changes       jsonb not null default '[]'::jsonb,
  applied       boolean not null default false,
  phase_advance jsonb,
  alerts        jsonb not null default '[]'::jsonb,
  model         text,
  error         text
);
create index if not exists reviews_room_idx on reviews (room_id, created_at desc);

-- UI → controller command queue.
create table if not exists commands (
  id         bigserial primary key,
  room_id    uuid not null references rooms (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  type       text not null check (type in ('test_shot', 'all_off', 'run_review', 'release_valves')),
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  result     text,
  done_at    timestamptz
);
create index if not exists commands_pending_idx on commands (created_at) where status = 'pending';

create table if not exists controller_status (
  id           text primary key,
  started_at   timestamptz not null,
  heartbeat_at timestamptz not null,
  is_leader    boolean not null default false,
  version      text,
  info         jsonb not null default '{}'::jsonb
);

create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
