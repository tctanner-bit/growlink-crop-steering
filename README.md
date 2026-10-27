# Growlink Autosteer AI

> ⚠️ **Growlink Labs experiment.** Experimental and not yet supported. Use caution before giving it control of
> real valves: run Shadow first, start with one room, and keep your Growlink irrigation program ready as a backup.
> Release path: **Labs → Beta → General release.**

Growlink Autosteer AI runs rock wool crop steering on the Growlink Developer API. Multi-tenant: a grower
pastes a Growlink API key, maps substrate sensors and irrigation valves, picks a phase, and the program runs
the daily cycle — P1 ramp, P2 maintenance, P3 overnight dry-back — with full valve control.
Every night **Nova**, the AI agronomist, reviews the closed cycle against the phase targets and tunes tomorrow.

```
┌────────────────────┐   server actions    ┌──────────────┐   30 s tick, batched   ┌────────────────────┐
│ apps/web (Next.js, │ ──────────────────▶ │   Postgres   │ ◀───────────────────── │ apps/controller    │
│ Growlink Labs UI)  │ ◀── reads state ─── │  (Supabase)  │ ── commands, config ─▶ │ leader + standby   │
└────────────────────┘                     └──────────────┘                        └─────────┬──────────┘
                                                                                            │ Gl-Api-Key (decrypted in memory)
                               packages/core: phase profiles · steering engine ·            ▼
                               simulator · AI review · Growlink client             api.developer.growlink.com
```

## What it does

| | |
|---|---|
| **Phases** | Five phases for large rock wool blocks, propagation to ripening. Phases 2–5 are steered; phase 1 (propagation) is tray-weight driven, so it is monitored only. Targets ramp within a phase — e.g. phase 2 day-level WC steps from ~80% to ~65%, phase 3 overnight dry-back grows from 10–15% to ~25% by day 21. |
| **Daily-cycle engine** | P1 starts at lights-on + delay *or* after a 1–2% WC drop; ramp shots until WC reaches the day band; P2 shots fire on inter-irrigation dry-back and refill toward the top of the band; the last shot is timed to hit the overnight dry-back target. Substrate EC above/below target enlarges/trims shots. |
| **Learning** | Each shot's measured WC response calibrates shot size; daytime and overnight dry-back rates are learned and used to move the last-shot time. |
| **Daily tuning** | A deterministic rule engine (always on) nudges stop time, shot size and P1 start toward the targets. Nova (OpenAI by default, or Anthropic) then reviews the trajectory and proposes bounded changes — **Suggest** or **Auto-apply**. Every change is clamped to hard bounds and to a maximum move per review. |
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
8. **Go-live friction**: a Labs-experiment warning the grower must acknowledge, typed confirmation, a standing warning on every Live room, and the UI steers growers to Shadow first.
9. **SIGTERM** closes all open valves before exit.
10. **OFF is confirmed, not assumed.** After every OFF the controller re-reads live device state; a valve still reporting ON keeps its run open and the watchdog re-sends OFF every 2 s, alerting after 3 attempts. (The Core firmware's `switchDevice` can return 200 for a command it did not apply.)

## Nova's AI key

Nova runs only in the controller. Set the key as a Fly secret — never on Vercel, in `.env` files that get committed,
or in the database:

```bash
fly secrets set OPENAI_API_KEY="<key>"      # Fly encrypts it; the app reads it from the environment
# optional: fly secrets set AI_MODEL="gpt-6-astra"   (default gpt-6.1-sol)
# optional: AI_PROVIDER=anthropic + ANTHROPIC_API_KEY to use Claude instead
```

The key is never logged, stored, returned to the browser, or included in error text (errors are redacted before they
are saved). The web app only sees `{ ai: true, provider, model }` in the controller heartbeat. CI fails if anything
key-shaped is committed or if `apps/web` references an AI key. Requests use OpenAI's Responses API with `store: false`.
Use a dedicated OpenAI project key with a monthly budget cap for this app.

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

Supabase project `crop-steering` (Growlink org, us-east-1) is created with the schema and RLS applied.

1. **Database password** — Supabase → crop-steering → Settings → Database → *Reset database password*. Then Connect → copy two URIs:
   - **Session pooler** (port 5432) → controller `DATABASE_URL` (its leader lock needs a session).
   - **Transaction pooler** (port 6543) → web `DATABASE_URL`.
2. **Vault key** — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Same value on web and controller.
3. **Web (Vercel)** — Add New → Project → import `tctanner-bit/growlink-crop-steering`, Root Directory `apps/web`. Env: `DATABASE_URL` (6543), `VAULT_MASTER_KEY`, `NEXT_PUBLIC_SUPABASE_URL=https://nidmpmbmtgwvboviqgep.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → API keys → anon). Deploy.
4. **Auth URLs** — Supabase → Authentication → URL Configuration: Site URL = the Vercel URL; add `<vercel-url>/auth/callback` to redirect URLs.
5. **Controller (Fly.io)** — from the repo root, see the commands at the top of `fly.toml`.

## Repository

```
packages/core       Phase profiles, steering engine, rule tuning, simulator, AI review prompt/parse, Growlink client, vault
apps/controller     Control loop, valve executor + watchdog, nightly review (Anthropic SDK), migrations
apps/web            Next.js 16 app — Growlink Labs UI, dark and light themes, displayLINK panel route
db/migrations       Postgres schema (+ Supabase RLS policies)
docs/               Steering logic and Growlink API notes
```

## Design

Growlink Labs look, built to read like a car display: one big number per screen (the water-content dial), black
and white grounds, Growlink orange (#F46E1A) only for the live value, the target band and Nova, green/amber for
on/off target, red only for **All valves off**. Dark and light themes (system by default; toggle in the top bar).

- `apps/web/app/globals.css` — theme tokens (`--gl-*`) for both themes, plus the component styles.
- `apps/web/components/ui.tsx` — the small UI kit (buttons, pills, notices, inputs, toggle, modal, segmented control).
- `apps/web/components/RoomVisuals.tsx` — the dial and the light-cycle bar.
- `/rooms/<id>/panel` — the displayLINK wall view: one room, readable across a hallway, Pause and All valves off as
  large touch targets. Add `?theme=dark` or `?theme=light` to pin the theme on a panel.

## Roadmap — v2: timed device commands

v1 sends ON and OFF. v2 adds `PUT …/state?value=true&duration=45`, executed by the controller itself, so a valve
closes even if this service and the cloud are unreachable. Firmware design: optional `Duration`/`RevertTo` on
`switchDevice`, expiry persisted and restored like manual tasks (with a cap on restored time), safety overrides
still honored, and a capability flag so the cloud never sends a duration to firmware that would ignore it.

## Growlink API asks

The app works on today's API. These additions would make it safer and simpler:

- **Timed device state** — `PUT …/state?value=true&duration=45` so the controller hardware closes the valve even if this service disappears.
- **Scoped API keys** — a key limited to named rooms/devices and to device control, issued per app.
- **Irrigation volume / drain** endpoints — measured drain to replace the estimate inferred from the WC response.
- **Webhooks** for sensor updates, to cut polling.
