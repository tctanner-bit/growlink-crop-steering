import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  PHASES, resolveTargets, dayInPhase, cycleInfo, DEFAULT_ROOM_CONFIG, defaultTuning, clampTuning, Range,
} from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { getRoom, roomReadings, roomShots, roomEvents, roomReviews, roomDays, pendingCommands, controllerHealth } from '@/lib/data';
import { Heading, Lozenge, LinkButton, SectionMessage, Tooltip } from '@/components/ak';
import { RoomControls } from '@/components/RoomControls';
import { PhaseControl } from '@/components/PhaseControl';
import { SteeringChart } from '@/components/SteeringChart';
import { TuningPanel } from '@/components/TuningPanel';
import { NovaPanel } from '@/components/NovaPanel';
import { AutoRefresh } from '@/components/AutoRefresh';
import { BandBar } from '@/components/BandBar';
import { MODE_APPEARANCE, MODE_LABEL, PERIOD_LABEL, fmt, fmtTime, ago } from '@/lib/format';

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
  const ci = cycleInfo(new Date(), cfg);
  const dip = dayInPhase(ci.cycleKey, room.phase_start_date, cfg.timezone);
  const targets = resolveTargets(room.phase, dip);
  const tuning = clampTuning(room.phase, { ...defaultTuning(room.phase), ...room.tuning });
  const s = room.status;
  const profile = PHASES[room.phase];
  const lastDay = days.find((d) => d.summary.odb != null)?.summary;
  const configured = room.wc_sensor_ids.length > 0 && room.valve_ids.length > 0;
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;
  const generating = pending.some((c) => c.type === 'run_review');

  return (
    <div className="stack gap-300">
      <AutoRefresh seconds={15} />
      <div className="stack gap-100">
        <Link href="/" className="small">← Rooms</Link>
        <div className="row gap-150 wrap">
          <Heading size="xlarge">{room.name}</Heading>
          <Lozenge appearance={MODE_APPEARANCE[room.mode]} isBold={room.mode === 'live'}>{MODE_LABEL[room.mode]}</Lozenge>
          {room.paused && <Lozenge appearance="moved">Paused</Lozenge>}
          {s?.valveOpen && <Lozenge appearance="inprogress">Irrigating</Lozenge>}
          <span className="grow" />
          <span className="small muted">{room.conn_label} · {room.org_name}</span>
          <LinkButton href={`/rooms/${room.id}/setup`}>Setup</LinkButton>
        </div>
      </div>

      {!configured && (
        <SectionMessage appearance="warning" title="Finish setup">
          Map at least one water-content sensor and one irrigation valve before turning the autopilot on. <Link href={`/rooms/${room.id}/setup`}>Open setup</Link>
        </SectionMessage>
      )}
      {room.mode === 'live' && (
        <SectionMessage appearance="warning" title="Live — Growlink Labs experiment">
          This app is controlling real valves in this room. It is experimental and not yet supported. Check the room in person, keep your Growlink irrigation program ready as a backup, and use <b>All valves off</b> if anything looks wrong.
        </SectionMessage>
      )}
      {room.last_error && room.mode !== 'off' && <SectionMessage appearance="error" title="Controller error">{room.last_error}</SectionMessage>}
      {!profile.autopilot && room.mode !== 'off' && (
        <SectionMessage appearance="information">Phase 1 cuttings are irrigated by tray weight (water at a 40–50% weight loss). The autopilot monitors only.</SectionMessage>
      )}

      <div className="card stack gap-250">
        <RoomControls roomId={room.id} mode={room.mode} paused={room.paused} isDemo={room.conn_kind === 'demo'} valveCount={room.valve_ids.length} maxShotSeconds={cfg.maxShotSeconds} />
        <PhaseControl roomId={room.id} phase={room.phase} dayInPhase={dip} today={today} />
      </div>

      <div className="room-layout">
        <div className="stack gap-300">
          <div className="grid-tiles">
            <Tile label="Water content" value={fmt(s?.wc)} unit="%" target={`Day band ${targets.dayWc.min}–${targets.dayWc.max}%`} band={targets.dayWc} scale={{ min: 30, max: 90 }} v={s?.wc ?? null} />
            <Tile label="Dry-back since shot" value={fmt(s?.drybackSinceShot)} unit="%" target={`Trigger ${tuning.p2TriggerPct}% · target ${targets.p2Dryback.min}–${targets.p2Dryback.max}%`} />
            <Tile label="Substrate EC" value={fmt(s?.ec, 2)} unit="mS/cm" target={`Target ${targets.substrateEc.min}–${targets.substrateEc.max}`} band={targets.substrateEc} scale={{ min: 0, max: 12 }} v={s?.ec ?? null} />
            <Tile label="Last overnight dry-back" value={fmt(lastDay?.odb)} unit="%" target={`Target ${targets.odb.min}–${targets.odb.max}%`} band={targets.odb} scale={{ min: 0, max: 35 }} v={lastDay?.odb ?? null} />
            <Tile label="Shots today" value={String(s?.shotsToday ?? 0)} unit="" target={`Max ${tuning.maxShotsPerDay}`} />
          </div>

          {s && room.mode !== 'off' && (
            <div className="card-flat row gap-200 wrap">
              <div className="stack"><span className="eyebrow">Period</span><b>{PERIOD_LABEL[s.period] ?? s.period}</b></div>
              <div className="stack"><span className="eyebrow">P1 start</span><span className="num">{fmtTime(s.p1StartAt, cfg.timezone)}</span></div>
              <div className="stack"><span className="eyebrow">Last shot by</span><span className="num">{fmtTime(s.lastShotDeadline, cfg.timezone)}</span></div>
              <div className="stack"><span className="eyebrow">Lights</span><span className="num">{fmtTime(s.lightsOnAt, cfg.timezone)}–{fmtTime(s.lightsOffAt, cfg.timezone)}</span></div>
              <div className="stack grow"><span className="eyebrow">Next</span><span>{s.nextShotHint || '—'}</span></div>
              <Tooltip content={`Shot calibration ${fmt(s.efficiency ?? 1, 2)} · daytime dry-back ${fmt(s.dayRate ?? null, 2)} %/h`}>
                <span className="small muted">tick {ago(room.last_tick_at)}</span>
              </Tooltip>
            </div>
          )}

          <div className="card stack gap-150">
            <div className="row gap-100 wrap">
              <Heading size="small" as="h2">Root zone</Heading>
              <span className="grow" />
              <div className="segmented" role="group" aria-label="Time range">
                {RANGES.map((r) => (
                  <Link key={r.h} href={`?h=${r.h}`} scroll={false} aria-current={hours === r.h ? 'true' : undefined}>{r.label}</Link>
                ))}
              </div>
            </div>
            {readings.length === 0 ? (
              <div className="subtle small" style={{ padding: 'var(--ds-space-400) 0' }}>No readings yet. Turn the autopilot on (Shadow or Simulate) to start logging.</div>
            ) : (
              <SteeringChart
                points={readings.map((r) => ({ t: new Date(r.t).toISOString(), wc: r.wc, ec: r.ec, valve: r.valve }))}
                shots={shots.map((x) => ({ ts: new Date(x.ts).toISOString(), kind: x.data?.kind ?? '', seconds: x.data?.seconds ?? 0, pct: x.data?.pct ?? 0, shadow: x.type === 'shadow_shot' }))}
                hours={hours} timezone={cfg.timezone} lightsOn={cfg.lightsOn} photoperiodHours={cfg.photoperiodHours}
                wcBand={targets.dayWc} ecBand={targets.substrateEc} deadline={s?.lastShotDeadline ?? null} now={Date.now()} phase={room.phase} phaseStartDate={room.phase_start_date}
              />
            )}
          </div>

          <div className="card stack gap-150">
            <Heading size="small" as="h2">Daily results</Heading>
            {days.length === 0 ? <div className="subtle small">The first cycle closes at tomorrow&apos;s first shot.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead><tr><th>Cycle</th><th>Day</th><th>Shots</th><th>ml/block</th><th>Peak WC</th><th>P2 dry-back</th><th>Overnight DB</th><th>EC avg</th><th>Drain (est.)</th></tr></thead>
                  <tbody>
                    {days.map(({ cycle_key, summary: d }) => {
                      const t = resolveTargets(d.phase, d.dayInPhase);
                      const cls = (v: number | null, r: Range) => (v == null ? '' : v >= r.min - 0.5 && v <= r.max + 0.5 ? 'ok' : 'off');
                      return (
                        <tr key={cycle_key}>
                          <td>{cycle_key}</td><td>P{d.phase}·{d.dayInPhase}</td>
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
          </div>

          <div className="card stack gap-100">
            <Heading size="small" as="h2">Activity</Heading>
            <div className="events">
              {events.length === 0 ? <div className="subtle small">Nothing yet.</div> : events.map((e) => (
                <div key={e.id} className="event">
                  <span className="event-time">{fmtTime(e.ts, cfg.timezone)}<br /><span style={{ fontSize: 10 }}>{DateTime.fromJSDate(new Date(e.ts)).setZone(cfg.timezone).toFormat('LLL d')}</span></span>
                  <span aria-label={e.severity} style={{ color: e.severity === 'critical' ? 'var(--ds-icon-danger)' : e.severity === 'warning' ? 'var(--ds-icon-warning)' : 'var(--ds-icon-subtle)' }}>
                    {e.severity === 'critical' ? '●' : e.severity === 'warning' ? '▲' : e.type === 'shot' ? '◆' : '·'}
                  </span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="stack gap-300">
          <NovaPanel roomId={room.id} aiMode={room.ai_mode} reviews={reviews as any} generating={generating} aiConfigured={!!health?.info?.ai} />

          <div className="card stack gap-150">
            <Heading size="small" as="h2">Targets · phase {room.phase}, day {dip}</Heading>
            <table className="data">
              <tbody>
                <tr><td>Day-level WC</td><td className="num">{targets.dayWc.min}–{targets.dayWc.max}%</td></tr>
                <tr><td>Overnight dry-back</td><td className="num">{targets.odb.min}–{targets.odb.max}%</td></tr>
                <tr><td>P2 dry-back</td><td className="num">{targets.p2Dryback.min}–{targets.p2Dryback.max}%</td></tr>
                <tr><td>Substrate EC</td><td className="num">{targets.substrateEc.min}–{targets.substrateEc.max}</td></tr>
                <tr><td>Drip EC</td><td className="num">{targets.dripEc.min}–{targets.dripEc.max}</td></tr>
                <tr><td>24 h drain</td><td className="num">{targets.drainPct.min}–{targets.drainPct.max}%</td></tr>
                <tr><td>Shots</td><td>{targets.shotStrategy === 'generative' ? 'Generative · large, infrequent' : 'Vegetative · small, frequent'}</td></tr>
              </tbody>
            </table>
            <ul className="small subtle" style={{ margin: 0, paddingLeft: 18 }}>
              {profile.guidance.map((g, i) => <li key={i} style={{ marginBottom: 4 }}>{g}</li>)}
            </ul>
          </div>

          <div className="card stack gap-150">
            <Heading size="small" as="h2">Steering parameters</Heading>
            <TuningPanel roomId={room.id} phase={room.phase} tuning={tuning} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, unit, target, band, scale, v }: { label: string; value: string; unit: string; target: string; band?: Range; scale?: Range; v?: number | null }) {
  return (
    <div className="tile">
      <span className="eyebrow">{label}</span>
      <span><span className="metric">{value}</span>{unit && <span className="metric-unit">{unit}</span>}</span>
      <span className="tile-target">{target}</span>
      {band && scale && <BandBar value={v ?? null} band={band} scale={scale} />}
    </div>
  );
}
