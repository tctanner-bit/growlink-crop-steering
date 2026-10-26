# Crop Steering Autopilot

Grodan 5-Phase crop steering for stonewool blocks, running on the Growlink Developer API. Multi-tenant: a grower
pastes a Growlink API key, maps substrate sensors and irrigation valves, picks a phase, and the autopilot runs
Grodan's Day-Dynamic model — P1 ramp, P2 maintenance, P3 overnight dry-back — with full valve control.
Every night **Nova**, the AI agronomist, reviews the closed cycle against Grodan's targets and tunes tomorrow.

```
┌────────────────────┐   server actions    ┌──────────────┐   30 s tick, batched   ┌────────────────────┐
│ apps/web (Next.js, │ ──────────────────▶ │   Postgres   │ ◀───────────────────── │ apps/controller    │
│ Atlassian DS/Rovo) │ ◀── reads state ─── │  (Supabase)  │ ── commands, config ─▶ │ leader + standby   │
└────────────────────┘                     └──────────────┘                        └─────────┬──────────┘
                                                                                            │ Gl-Api-Key (decrypted in memory)
                               packages/core: Grodan profiles · steering engine ·           ▼
                               simulator · AI review · Growlink client             api.developer.growlink.com
```

## What it does

| | |
|---|---|
| **Phases** | Grodan 5-Phase Model (Large Blocks, One-Transplant). Phases 2–5 are steered; phase 1 (propagation) is tray-weight driven, so it is monitored only. Targets ramp within a phase — e.g. phase 2 day-level WC steps from ~80% to ~65%, phase 3 overnight dry-back grows from 10–15% to ~25% by day 21. |
| **Day-Dynamic engine** | P1 starts at lights-on + delay *or* after a 1–2% WC drop; ramp shots until WC reaches the day band; P2 shots fire on inter-irrigation dry-back and refill toward the top of the band; the last shot is timed to hit the overnight dry-back target. Substrate EC above/below target enlarges/trims shots. |
| **Learning** | Each shot's measured WC response calibrates shot size; daytime and overnight dry-back rates are learned and used to move the last-shot time. |
| **Daily tuning** | A deterministic rule engine (always on) nudges stop time, shot size and P1 start toward the targets. Nova (Claude) then reviews the trajectory and proposes bounded changes — **Suggest** or **Auto-apply**. Every change is clamped to hard bounds and to a maximum move per review. |
| **Modes** | **Off** · **Shadow** (real sensors, decisions logged, your Growlink program still irrigates; observed irrigations are tracked) · **Simulate** (a physical block model behind the same API interface) · **Live** (autopilot owns the valves). |
| **Multi-tenant** | Supabase Auth; each user's connections and rooms are owner-scoped. API keys are sealed with AES-256-GCM (`VAULT_MASTER_KEY`) and never returned to the browser. |
| **Demo farm** | One click creates three simulated rooms (phases 2, 3, 4) with three days of real engine history. |

## Safety model

Valves are real hardware. The design assumes any process can die at any moment.

1. **Write-ahead valve runs.** Every opening is recorded in `valve_runs` (with `open_until`) *before* the ON command.
2. **Watchdog on every instance** (2 s) closes any run past its deadline — missed timer, crash, deploy. Verified: controller `kill -9`'d mid-shot → valves closed within 1 s of restart. Run **two** controller machines: the standby's watchdog closes valves while the leader is down.
3. **Leader election** via Postgres advisory lock — exactly one instance steers.
4. **Rest state**: between shots valves sit in forced OFF, so no Growlink program double-irrigates. Leaving Live hands them back to AUTO.
5. **Caps**: per-room max shot seconds, global `HARD_MAX_SHOT_SECONDS`, max shots/day, P1 shot cap, one shot at a time per room.
6. **Blind = hold.** No fresh WC reading for 2+ minutes → no irrigation and an alert. A WC probe >8% from the median is ignored.
7. **Emergency floor** fires up to two small shots, day or night, if WC collapses.
8. **Go-live friction**: typed confirmation, and the UI steers growers to Shadow first.
9. **SIGTERM** closes all open valves before exit.

## Run it locally

```bash
docker compose up -d db                       # Postgres on :5432
cp .env.example .env                          # set VAULT_MASTER_KEY=$(openssl rand -base64 32), DEV_AUTH_BYPASS=1
npm install
npm test                                      # engine + closed-loop simulation tests
set -a; source .env; set +a
npm run db:migrate
npm run dev:controller                        # terminal 1
npm run dev:web                               # terminal 2 → http://localhost:3000 → “Try the demo farm”
```

`npm run sim -- phase=3 days=21` runs the engine against the simulator for a full phase and prints daily results.

## Deploy

1. **Supabase** — create a project; enable email auth. Use the *session pooler* connection string as `DATABASE_URL`.
2. **Controller (Fly.io)** — see `apps/controller/fly.toml`. `fly secrets set DATABASE_URL VAULT_MASTER_KEY ANTHROPIC_API_KEY`, deploy, `fly scale count 2`. Migrations run on boot.
3. **Web (Vercel)** — root directory `apps/web`; env `DATABASE_URL`, `VAULT_MASTER_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Add `<your-domain>/auth/callback` to Supabase redirect URLs.

`VAULT_MASTER_KEY` must be identical on web and controller.

## Repository

```
packages/core       Grodan profiles, steering engine, rule tuning, simulator, AI review prompt/parse, Growlink client, vault
apps/controller     Control loop, valve executor + watchdog, nightly review (Anthropic SDK), migrations
apps/web            Next.js 16 app on Atlassian Design System (Atlaskit) with Rovo UI for AI surfaces
db/migrations       Postgres schema (+ Supabase RLS policies)
docs/               Steering logic and Growlink API notes
```

## Design system

The UI uses the Atlassian Design System — Atlaskit components and `@atlaskit/tokens` throughout, light and dark.
Rovo UI is applied only to AI surfaces, per its guidelines: one `appearance="rovo"` button per region ("Review last
cycle"), Rovo's four flat colors (blue, purple, saffron, lime — clockwise, hard stops) as the generative border
**only while a review is generating**, and never as decoration. The Rovo logo is not used; the AI is Growlink's Nova.

## Growlink API asks

The app works on today's API. These additions would make it safer and simpler:

- **Timed device state** — `PUT …/state?value=true&duration=45` so the controller hardware closes the valve even if this service disappears.
- **Scoped API keys** — a key limited to named rooms/devices and to device control, issued per app.
- **Irrigation volume / drain** endpoints — measured drain to replace the estimate inferred from the WC response.
- **Webhooks** for sensor updates, to cut polling.
