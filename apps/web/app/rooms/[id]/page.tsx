import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  PHASES, resolveTargets, dayInPhase, cycleInfo, DEFAULT_ROOM_CONFIG, defaultTuning, clampTuning, Range,
} from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { getRoom, roomReadings, roomShots, roomEvents, roomReviews, roomDays, pendingCommands, controllerHealth } from '@/lib/data';
import { Heading, Lozenge, LinkButton, SectionMessage } from '@/components/ui';
import { Dial, DayBar, type DaySegment } from '@/components/RoomVisuals';
import { RoomControls } from '@/components/RoomControls';
import { PhaseControl } from '@/components/PhaseControl';
import { SteeringChart } from '@/components/SteeringChart';
import { TuningPanel } from '@/components/TuningPanel';
import { NovaPanel } from '@/components/NovaPanel';
import { AutoRefresh } from '@/components/AutoRefresh';
import { MODE_LABEL, PERIOD_LABEL, fmt, fmtTime, ago } from '@/lib/format';

const RANGES = [{ h: 24, label: '24 h' }, { h: 72, label: '3 days' }, { h: 168, label: '7 days' }];

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ h?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const hours = Math.min(336, Math.max(6, Number((await searchParams).h ?? 24) || 24));
  const room = await getRoom(user.id, id);
  if (!room) notFound();

  const [readings, shots, events, reviews, days, pending, health] = await Promise.all([
    roomReadings(room.id, hours), roomShots(room.id, hours), roomEvents(room.id), roomReviews(room.id, 12),
    roomDays(room.id), pendingCommands(room.id), controllerHealth(),
  ]);

  const cfg = { ...DEFAULT_ROOM_CONFIG, ...room.config };
  const cycle = cycleInfo(new Date(), cfg);
  const dip = dayInPhase(cycle.cycleKey, room.phase_start_date, cfg.timezone);
  const targets = resolveTargets(room.phase, dip);
  const tuning = clampTuning(room.phase, { ...defaultTuning(room.phase), ...room.tuning });
  const s = room.status;
  const profile = PHASES[room.phase];
  const lastDay = days.find((d) => d.summary.odb != null)?.summary;
  const configured = room.wc_sensor_ids.length > 0 && room.valve_ids.length > 0;
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;
  const generating = pending.some((c) => c.type === 'run_review');

  const nowMs = Date.now();
  const segs = daySegments(cfg, tuning, s);
  const activeSeg = !s || room.mode === 'off' ? null : s.period === 'P1' || s.period === 'P2' ? 'irrigate' : s.period === 'P3' ? 'P3' : nowMs < Date.parse(s.p1StartAt) && nowMs >= Date.parse(s.lightsOnAt) ? 'wait' : 'night';
  const odbState = lastDay?.odb == null ? undefined : lastDay.odb >= targets.odb.min - 0.5 && lastDay.odb <= targets.odb.max + 0.5 ? 'ok' : 'off';
  const ecState = s?.ec == null ? undefined : s.ec >= targets.substrateEc.min && s.ec <= targets.substrateEc.max ? 'ok' : 'off';
  const drybackPct = s?.drybackSinceShot != null && tuning.p2TriggerPct > 0 ? Math.min(100, (s.drybackSinceShot / tuning.p2TriggerPct) * 100) : 0;

  return (
    <div className="stack gap-400">
      <AutoRefresh seconds={15} />
      <div className="stack gap-150">
        <Link href="/" className="small muted" style={{ textDecoration: 'none' }}>← Rooms</Link>
        <div className="room-head">
          <div className="room-title">
            <span className="eyebrow">Phase {room.phase} · {profile.name}</span>
            <h1>{room.name}</h1>
            <span className="small muted">Day {dip} of {profile.durationDays.min === profile.durationDays.max ? profile.durationDays.max : `${profile.durationDays.min}–${profile.durationDays.max}`} · {room.conn_label} · {room.org_name}</span>
          </div>
          <span className="grow" />
          <div className="row gap-100 wrap">
            <span className="room-pill" data-mode={room.mode}>
              {room.mode === 'off' ? 'Autopilot off' : `Autopilot · ${MODE_LABEL[room.mode]}`}
              {s && room.mode !== 'off' && <span className="muted">{room.paused ? 'Paused' : PERIOD_LABEL[s.period] ?? s.period}</span>}
            </span>
            {s?.valveOpen && <Lozenge appearance="new">Irrigating</Lozenge>}
            <LinkButton href={`/rooms/${room.id}/panel`} appearance="subtle">Panel view</LinkButton>
            <LinkButton href={`/rooms/${room.id}/setup`}>Setup</LinkButton>
          </div>
        </div>
      </div>

      {!configured && (
        <SectionMessage appearance="warning" title="Finish setup">
          Map at least one water-content sensor and one irrigation valve before turning the autopilot on. <Link href={`/rooms/${room.id}/setup`}>Open setup</Link>
        </SectionMessage>
      )}
      {room.mode === 'live' && process.env.LIVE_ENABLED !== '1' && room.conn_kind !== 'demo' && (
        <SectionMessage appearance="warning" title="Live is disabled — running as Shadow">
          Live control is locked until valves accept a timed ON command. The controller is treating this room as Shadow: it logs every decision and moves no valves. Switch the mode to Shadow to match.
        </SectionMessage>
      )}
      {room.mode === 'live' && process.env.LIVE_ENABLED === '1' && (
        <SectionMessage appearance="warning" title="Live — Growlink Labs experiment">
          This app is controlling real valves in this room. It is experimental and not yet supported. Check the room in person, keep your Growlink irrigation program ready as a backup, and use <b>All valves off</b> if anything looks wrong.
        </SectionMessage>
      )}
      {room.last_error && room.mode !== 'off' && <SectionMessage appearance="error" title="Controller error">{room.last_error}</SectionMessage>}
      {s && room.mode !== 'off' && !s.readingsFresh && <SectionMessage appearance="error" title="Sensor data is stale">Irrigation holds until fresh readings arrive. Last tick {ago(room.last_tick_at)}.</SectionMessage>}
      {!profile.autopilot && room.mode !== 'off' && (
        <SectionMessage appearance="information">Phase 1 cuttings are irrigated by tray weight (water at a 40–50% weight loss). The autopilot monitors only.</SectionMessage>
      )}

      <div className="hero">
        <div className="dial-card">
          <Dial value={s?.wc ?? null} band={targets.dayWc} scale={{ min: Math.min(40, targets.dayWc.min - 15), max: Math.max(85, targets.dayWc.max + 15) }} label="Water content" />
          <div className="dial-next">
            {room.mode === 'off' ? <span>Autopilot off</span> : s ? <span><b>{s.nextShotHint || '—'}</b></span> : <span>Waiting for the controller</span>}
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="eyebrow">Substrate EC</span>
            <span className="stat-value">{fmt(s?.ec, 1)}<small>mS/cm</small></span>
            <span className="stat-note" data-state={ecState}>Target {targets.substrateEc.min}–{targets.substrateEc.max}</span>
          </div>
          <div className="stat">
            <span className="eyebrow">Dry-back since shot</span>
            <span className="stat-value">{fmt(s?.drybackSinceShot)}<small>%</small></span>
            <div className="meter" aria-hidden="true"><span style={{ width: `${drybackPct}%` }} /></div>
            <span className="stat-note">Next P2 shot at {tuning.p2TriggerPct}%</span>
          </div>
          <div className="stat">
            <span className="eyebrow">Overnight dry-back</span>
            <span className="stat-value">{fmt(lastDay?.odb, 0)}<small>%</small></span>
            <span className="stat-note" data-state={odbState}>Target {targets.odb.min}–{targets.odb.max}%</span>
          </div>
          <div className="stat">
            <span className="eyebrow">Shots today</span>
            <span className="stat-value">{s?.shotsToday ?? 0}<small>/ {tuning.maxShotsPerDay}</small></span>
            <span className="stat-note">{targets.shotStrategy === 'generative' ? 'Generative · large, infrequent' : 'Vegetative · small, frequent'}</span>
          </div>
        </div>
      </div>

      <div className="room-grid">
        <div className="stack gap-300">
          <section className="card stack gap-250" aria-label="Today">
            <div className="section-head">
              <Heading size="small" as="h2">Today</Heading>
              <span className="small muted">Lights {fmtTime(s?.lightsOnAt ?? cycle.lightsOnAt.toISO(), cfg.timezone)}–{fmtTime(s?.lightsOffAt ?? cycle.lightsOffAt.toISO(), cfg.timezone)} · P1 from {fmtTime(s?.p1StartAt ?? null, cfg.timezone)} · last shot by {fmtTime(s?.lastShotDeadline ?? null, cfg.timezone)}</span>
            </div>
            <DayBar segments={segs} now={nowMs} active={activeSeg} />
            <div className="stack gap-100" style={{ marginTop: 8 }}>
              <span className="eyebrow">Phase</span>
              <PhaseControl roomId={room.id} phase={room.phase} dayInPhase={dip} today={today} />
            </div>
          </section>

          <section className="card stack gap-200" aria-label="Root zone chart">
            <div className="section-head">
              <Heading size="small" as="h2">Root zone</Heading>
              <span className="small muted">Water content and EC against each day&apos;s targets</span>
              <span className="grow" />
              <div className="segmented" role="group" aria-label="Time range">
                {RANGES.map((r) => (
                  <Link key={r.h} href={`?h=${r.h}`} scroll={false} aria-current={hours === r.h ? 'true' : undefined}>{r.label}</Link>
                ))}
              </div>
            </div>
            {readings.length === 0 ? (
              <p className="subtle small" style={{ padding: '32px 0' }}>No readings yet. Turn the autopilot on (Shadow or Simulate) to start logging.</p>
            ) : (
              <SteeringChart
                points={readings.map((r) => ({ t: new Date(r.t).toISOString(), wc: r.wc, ec: r.ec, valve: r.valve }))}
                shots={shots.map((x) => ({ ts: new Date(x.ts).toISOString(), kind: x.data?.kind ?? '', seconds: x.data?.seconds ?? 0, pct: x.data?.pct ?? 0, shadow: x.type === 'shadow_shot' }))}
                hours={hours} timezone={cfg.timezone} lightsOn={cfg.lightsOn} photoperiodHours={cfg.photoperiodHours}
                wcBand={targets.dayWc} ecBand={targets.substrateEc} deadline={s?.lastShotDeadline ?? null} now={nowMs} phase={room.phase} phaseStartDate={room.phase_start_date}
              />
            )}
          </section>

          <section className="card stack gap-150" aria-label="Daily results">
            <Heading size="small" as="h2">Daily results</Heading>
            {days.length === 0 ? <p className="subtle small">The first cycle closes at tomorrow&apos;s first shot.</p> : (
              <div className="scroll-x">
                <table className="data">
                  <thead><tr><th>Cycle</th><th>Day</th><th>Shots</th><th>ml/block</th><th>Peak WC</th><th>P2 dry-back</th><th>Overnight</th><th>EC avg</th><th>Drain est.</th></tr></thead>
                  <tbody>
                    {days.map(({ cycle_key, summary: d }) => {
                      const t = resolveTargets(d.phase, d.dayInPhase);
                      const cls = (v: number | null, r: Range) => (v == null ? '' : v >= r.min - 0.5 && v <= r.max + 0.5 ? 'ok' : 'off');
                      return (
                        <tr key={cycle_key}>
                          <td>{cycle_key}</td><td>P{d.phase} · {d.dayInPhase}</td>
                          <td>{d.shots}{d.emergencyShots ? ` (+${d.emergencyShots}!)` : ''}</td><td>{d.irrigationMlPerBlock}</td>
                          <td className={cls(d.peakWc, t.dayWc)}>{fmt(d.peakWc)}%</td>
                          <td className={cls(d.avgP2Dryback, t.p2Dryback)}>{fmt(d.avgP2Dryback)}%</td>
                          <td className={cls(d.odb, t.odb)}>{fmt(d.odb)}% <span className="muted">/ {t.odb.min}–{t.odb.max}</span></td>
                          <td className={cls(d.avgEc, t.substrateEc)}>{fmt(d.avgEc, 2)}</td>
                          <td>{d.drainPctEst == null ? '—' : `${d.drainPctEst}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card stack gap-100" aria-label="Activity">
            <Heading size="small" as="h2">Activity</Heading>
            <div className="events">
              {events.length === 0 ? <p className="subtle small">Nothing yet.</p> : events.map((e) => (
                <div key={e.id} className="event">
                  <span className="event-time">{fmtTime(e.ts, cfg.timezone)}<br /><span style={{ fontSize: 11 }}>{DateTime.fromJSDate(new Date(e.ts)).setZone(cfg.timezone).toFormat('LLL d')}</span></span>
                  <span className="event-dot" data-sev={e.severity} data-kind={e.type === 'shot' ? 'shot' : undefined} aria-label={e.severity} />
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="stack gap-300">
          <RoomControls roomId={room.id} mode={room.mode} paused={room.paused} isDemo={room.conn_kind === 'demo'} valveCount={room.valve_ids.length} maxShotSeconds={cfg.maxShotSeconds} liveEnabled={process.env.LIVE_ENABLED === '1'} />
          <NovaPanel roomId={room.id} aiMode={room.ai_mode} reviews={reviews as any} generating={generating} aiConfigured={!!health?.info?.ai} />

          <section className="card stack gap-150" aria-label="Targets">
            <Heading size="small" as="h2">Targets · day {dip}</Heading>
            <table className="data kv">
              <tbody>
                <tr><td>Day-level WC</td><td>{targets.dayWc.min}–{targets.dayWc.max}%</td></tr>
                <tr><td>Overnight dry-back</td><td>{targets.odb.min}–{targets.odb.max}%</td></tr>
                <tr><td>P2 dry-back</td><td>{targets.p2Dryback.min}–{targets.p2Dryback.max}%</td></tr>
                <tr><td>Substrate EC</td><td>{targets.substrateEc.min}–{targets.substrateEc.max}</td></tr>
                <tr><td>Drip EC</td><td>{targets.dripEc.min}–{targets.dripEc.max}</td></tr>
                <tr><td>24 h drain</td><td>{targets.drainPct.min}–{targets.drainPct.max}%</td></tr>
              </tbody>
            </table>
            <ul className="small subtle" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {profile.guidance.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </section>

          <section className="card stack gap-150" aria-label="Steering parameters">
            <Heading size="small" as="h2">Steering parameters</Heading>
            <TuningPanel roomId={room.id} phase={room.phase} tuning={tuning} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function daySegments(cfg: typeof DEFAULT_ROOM_CONFIG, tuning: { startDelayHours: number; stopBeforeLightsOffHours: number }, s: { lightsOnAt: string; lightsOffAt: string; p1StartAt: string; lastShotDeadline: string } | null): DaySegment[] {
  const ci = cycleInfo(new Date(), cfg);
  const on = s ? Date.parse(s.lightsOnAt) : ci.lightsOnAt.toMillis();
  const off = s ? Date.parse(s.lightsOffAt) : ci.lightsOffAt.toMillis();
  const p1 = s ? Date.parse(s.p1StartAt) : on + tuning.startDelayHours * 3_600_000;
  const stop = s ? Date.parse(s.lastShotDeadline) : off - tuning.stopBeforeLightsOffHours * 3_600_000;
  const next = on + 24 * 3_600_000;
  return [
    { id: 'wait', label: 'Wait', from: on, to: p1 },
    { id: 'irrigate', label: 'P1 · P2 irrigate', from: p1, to: stop },
    { id: 'P3', label: 'P3 dry-back', from: stop, to: off },
    { id: 'night', label: 'Night', from: off, to: next },
  ];
}
