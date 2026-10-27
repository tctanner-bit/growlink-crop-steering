import { DateTime } from 'luxon';
import { PHASES, PhaseId, ResolvedTargets, resolveTargets, mid } from './profiles';
import { DaySummary, Tuning } from './tuning';

/**
 * Rock wool daily-cycle steering engine — a pure function of (time, config, readings, state).
 *
 *   night ──(lights on + delay, or WC drops 1–2%)──▶ P1 ramp ──(WC reaches day band)──▶ P2 maintain
 *   P2 ──(last-shot deadline: lights-off − stop hours)──▶ P3 overnight dry-back ──▶ next cycle
 *
 * The controller owns I/O; the engine only decides.
 */

export type DayPeriod = 'night' | 'P1' | 'P2' | 'P3';
export type ShotKind = 'P1' | 'P2' | 'catchup' | 'emergency' | 'test' | 'observed';

export interface RoomConfig {
  timezone: string;
  /** Local lights-on time, "HH:MM". */
  lightsOn: string;
  photoperiodHours: number;
  blockVolumeL: number;
  emitterFlowMlPerMin: number;
  emittersPerBlock: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  /** Absolute WC% floor that triggers an emergency shot at any time. Null = derived from targets. */
  emergencyWcFloor: number | null;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  timezone: 'America/Denver',
  lightsOn: '06:00',
  photoperiodHours: 12,
  blockVolumeL: 2.4,
  emitterFlowMlPerMin: 33,
  emittersPerBlock: 2,
  minShotSeconds: 5,
  maxShotSeconds: 300,
  emergencyWcFloor: null,
};

export interface Readings {
  /** Averaged water content across mapped WC sensors (%). */
  wc: number | null;
  /** Averaged substrate EC (mS/cm). */
  ec: number | null;
  /** Timestamp of the newest reading used. */
  at: Date | null;
}

export interface ShotRecord {
  at: string;
  seconds: number;
  pct: number;
  kind: ShotKind;
  preWc: number | null;
}

export interface EngineState {
  version: 1;
  cycleKey: string | null;
  period: DayPeriod;
  lightsOnWc: number | null;
  shots: ShotRecord[];
  p1Shots: number;
  emergencyShots: number;
  postShotPeakWc: number | null;
  dayPeakWc: number | null;
  dayMinWc: number | null;
  p2Drybacks: number[];
  ecSum: number;
  ecCount: number;
  ecMax: number | null;
  irrigatedMl: number;
  drainMlEst: number;
  staleTicks: number;
  alerts: string[];
  /** Calibrated ratio of observed WC rise to planned rise. */
  efficiency: number;
  /** Learned overnight dry-back rate (WC%/h). */
  overnightRatePctPerHour: number | null;
  /** Learned daytime (P2) dry-back rate (WC%/h) — the sensitivity of ODB to the last-shot time. */
  dayRatePctPerHour: number | null;
  /** Closed previous cycle awaiting its ODB measurement. */
  pending: DaySummary | null;
  lastShadowAt: string | null;
}

export function initialState(): EngineState {
  return {
    version: 1, cycleKey: null, period: 'night', lightsOnWc: null, shots: [], p1Shots: 0,
    emergencyShots: 0, postShotPeakWc: null, dayPeakWc: null, dayMinWc: null, p2Drybacks: [],
    ecSum: 0, ecCount: 0, ecMax: null, irrigatedMl: 0, drainMlEst: 0, staleTicks: 0, alerts: [],
    efficiency: 1, overnightRatePctPerHour: null, dayRatePctPerHour: null, pending: null, lastShadowAt: null,
  };
}

export interface ShotAction {
  type: 'shot';
  kind: ShotKind;
  seconds: number;
  pct: number;
  reason: string;
}

export type EngineEvent =
  | { type: 'cycle_started'; cycleKey: string }
  | { type: 'period'; from: DayPeriod; to: DayPeriod; reason: string }
  | { type: 'shot'; kind: ShotKind; seconds: number; pct: number; reason: string; wc: number | null }
  | { type: 'shadow_shot'; kind: ShotKind; seconds: number; pct: number; reason: string; wc: number | null }
  | { type: 'day_closed'; summary: DaySummary }
  | { type: 'alert'; key: string; severity: 'info' | 'warning' | 'critical'; message: string };

export type Mode = 'simulate' | 'shadow' | 'live';

export interface StepInput {
  now: Date;
  config: RoomConfig;
  phase: PhaseId;
  /** Local ISO date (yyyy-mm-dd) the current phase started. */
  phaseStartDate: string;
  tuning: Tuning;
  state: EngineState;
  readings: Readings;
  mode: Mode;
  paused: boolean;
  /** A valve is still open from the previous shot. */
  valveBusy: boolean;
  /** Shadow mode: an irrigation the existing Growlink program ran since the last tick. */
  observedShotSeconds?: number | null;
}

export interface EngineStatus {
  cycleKey: string;
  period: DayPeriod;
  lightsOnNow: boolean;
  lightsOnAt: string;
  lightsOffAt: string;
  p1StartAt: string;
  lastShotDeadline: string;
  targets: ResolvedTargets;
  wc: number | null;
  ec: number | null;
  shotsToday: number;
  drybackSinceShot: number | null;
  nextShotHint: string;
  readingsFresh: boolean;
}

export interface StepResult {
  state: EngineState;
  actions: ShotAction[];
  events: EngineEvent[];
  status: EngineStatus;
}

const STALE_AFTER_MS = 5 * 60_000;
const P1_MAX_SHOTS = 15;
const MAX_EMERGENCY_SHOTS = 2;

export function cycleInfo(now: Date, cfg: RoomConfig) {
  const local = DateTime.fromJSDate(now, { zone: cfg.timezone });
  const [h, m] = cfg.lightsOn.split(':').map(Number);
  let on = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (on > local) on = on.minus({ days: 1 });
  const off = on.plus({ minutes: Math.round(cfg.photoperiodHours * 60) });
  return { local, cycleKey: on.toISODate()!, lightsOnAt: on, lightsOffAt: off, lightsOnNow: local < off, nextLightsOn: on.plus({ days: 1 }) };
}

export function dayInPhase(cycleKey: string, phaseStartDate: string, tz: string): number {
  const a = DateTime.fromISO(phaseStartDate, { zone: tz }).startOf('day');
  const b = DateTime.fromISO(cycleKey, { zone: tz }).startOf('day');
  return Math.max(1, Math.floor(b.diff(a, 'days').days) + 1);
}

/** WC% one second of irrigation adds to a block (theoretical, before calibration). */
export function pctPerSecond(cfg: RoomConfig): number {
  const mlPerSec = (cfg.emitterFlowMlPerMin * cfg.emittersPerBlock) / 60;
  return (mlPerSec / (cfg.blockVolumeL * 1000)) * 100;
}

/** Default safety floor: the end-of-phase day band, minus the largest overnight dry-back, minus 8%. */
export function emergencyFloor(phase: PhaseId): number {
  const p = PHASES[phase];
  return Math.max(30, p.dayWcEnd.min - Math.max(p.odbStart.max, p.odbEnd.max) - 8);
}

export function shotSeconds(pct: number, cfg: RoomConfig, efficiency: number): number {
  const s = pct / (pctPerSecond(cfg) * Math.max(0.3, efficiency));
  return Math.round(Math.min(cfg.maxShotSeconds, Math.max(cfg.minShotSeconds, s)));
}

export function mlPerBlock(seconds: number, cfg: RoomConfig): number {
  return (seconds * cfg.emitterFlowMlPerMin * cfg.emittersPerBlock) / 60;
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

function summarize(s: EngineState, phase: PhaseId, dip: number, cfg: RoomConfig): DaySummary {
  const secs = s.shots.reduce((a, x) => a + x.seconds, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    cycleKey: s.cycleKey!, phase, dayInPhase: dip,
    shots: s.shots.length, emergencyShots: s.emergencyShots, irrigationSeconds: secs,
    irrigationMlPerBlock: Math.round(mlPerBlock(secs, cfg)),
    lightsOnWc: r1(s.lightsOnWc), peakWc: r1(s.dayPeakWc), minWc: r1(s.dayMinWc),
    firstShotAt: s.shots[0]?.at ?? null, lastShotAt: s.shots[s.shots.length - 1]?.at ?? null,
    lastShotPeakWc: r1(s.postShotPeakWc), avgP2Dryback: r1(avg(s.p2Drybacks)),
    avgEc: r1(s.ecCount ? s.ecSum / s.ecCount : null), maxEc: r1(s.ecMax),
    drainPctEst: s.irrigatedMl > 0 ? Math.round((s.drainMlEst / s.irrigatedMl) * 100) : null,
    staleMinutes: Math.round(s.staleTicks / 2), odb: null, odbHours: null,
  };
}

export function step(input: StepInput): StepResult {
  const { now, config: cfg, phase, tuning: t, readings } = input;
  const profile = PHASES[phase];
  let s: EngineState = structuredClone(input.state);
  const events: EngineEvent[] = [];
  const actions: ShotAction[] = [];
  const ci = cycleInfo(now, cfg);
  const dip = dayInPhase(ci.cycleKey, input.phaseStartDate, cfg.timezone);
  const targets = resolveTargets(phase, dip);
  const nowIso = now.toISOString();

  const alertOnce = (key: string, severity: 'info' | 'warning' | 'critical', message: string) => {
    if (s.alerts.includes(key)) return;
    s.alerts.push(key);
    events.push({ type: 'alert', key, severity, message });
  };
  const setPeriod = (to: DayPeriod, reason: string) => {
    if (s.period === to) return;
    events.push({ type: 'period', from: s.period, to, reason });
    s.period = to;
  };

  // ── 1. Cycle rollover ──────────────────────────────────────────────────────
  if (s.cycleKey !== ci.cycleKey) {
    if (s.cycleKey) {
      const prevDip = dayInPhase(s.cycleKey, input.phaseStartDate, cfg.timezone);
      s.pending = summarize(s, phase, prevDip, cfg);
      if (s.shots.length === 0) {
        // Nothing to measure an ODB against — close it immediately.
        events.push({ type: 'day_closed', summary: s.pending });
        s.pending = null;
      }
    }
    const keep = { efficiency: s.efficiency, overnightRatePctPerHour: s.overnightRatePctPerHour, dayRatePctPerHour: s.dayRatePctPerHour, pending: s.pending };
    s = { ...initialState(), ...keep, cycleKey: ci.cycleKey };
    events.push({ type: 'cycle_started', cycleKey: ci.cycleKey });
  }

  // ── 2. Readings ────────────────────────────────────────────────────────────
  const fresh = readings.wc != null && readings.at != null && now.getTime() - readings.at.getTime() <= STALE_AFTER_MS;
  const wc = fresh ? readings.wc : null;
  if (fresh && wc != null) {
    s.staleTicks = 0;
    if (ci.lightsOnNow && s.lightsOnWc == null) s.lightsOnWc = wc;
    s.dayPeakWc = s.dayPeakWc == null ? wc : Math.max(s.dayPeakWc, wc);
    s.dayMinWc = s.dayMinWc == null ? wc : Math.min(s.dayMinWc, wc);
    if (s.shots.length) s.postShotPeakWc = s.postShotPeakWc == null ? wc : Math.max(s.postShotPeakWc, wc);
  } else {
    s.staleTicks += 1;
    if (s.staleTicks >= 4 && profile.autopilot && !input.paused) {
      alertOnce('sensor_stale', 'warning', 'No fresh water-content reading for 2+ minutes. Irrigation is on hold until sensors report again.');
    }
  }
  if (readings.ec != null && fresh) {
    s.ecSum += readings.ec; s.ecCount += 1;
    s.ecMax = s.ecMax == null ? readings.ec : Math.max(s.ecMax, readings.ec);
  }

  const startDelayAt = ci.lightsOnAt.plus({ minutes: Math.round(t.startDelayHours * 60) });
  const deadline = ci.lightsOffAt.minus({ minutes: Math.round(t.stopBeforeLightsOffHours * 60) });
  const lastShot = s.shots[s.shots.length - 1];
  const minsSinceShot = lastShot ? (now.getTime() - Date.parse(lastShot.at)) / 60_000 : Infinity;
  const ref = s.postShotPeakWc ?? s.dayPeakWc;
  const dryback = ref != null && wc != null ? ref - wc : null;

  // ── 3. Shot bookkeeping (shared by real, simulated and observed shots) ───────
  const recordShot = (kind: ShotKind, seconds: number, pct: number) => {
    const prev = s.shots[s.shots.length - 1];
    if (prev && prev.preWc != null && s.postShotPeakWc != null && prev.pct > 0) {
      const observed = s.postShotPeakWc - prev.preWc;
      if (prev.preWc < targets.dayWc.min - 1 && observed > 0) {
        // Below saturation: rise ≈ absorbed volume → calibrate.
        const ratio = Math.min(1.6, Math.max(0.3, observed / prev.pct));
        s.efficiency = Math.round((s.efficiency * 0.7 + ratio * 0.3) * 1000) / 1000;
      } else if (prev.preWc >= targets.dayWc.min - 1) {
        // Near field capacity: shortfall ≈ drain.
        const expected = prev.pct * s.efficiency;
        const shortfall = Math.max(0, Math.min(1, (expected - Math.max(0, observed)) / expected));
        s.drainMlEst += shortfall * mlPerBlock(prev.seconds, cfg);
      }
    }
    if (prev && dryback != null && (kind === 'P2' || kind === 'observed') && s.period === 'P2') {
      s.p2Drybacks.push(Math.round(dryback * 10) / 10);
      if (minsSinceShot > 10 && dryback > 0) {
        const rate = dryback / (minsSinceShot / 60);
        s.dayRatePctPerHour = Math.round((s.dayRatePctPerHour == null ? rate : s.dayRatePctPerHour * 0.7 + rate * 0.3) * 100) / 100;
      }
    }

    // The first regular shot of the cycle closes the previous cycle's overnight dry-back.
    if (s.pending && kind !== 'emergency' && kind !== 'test') {
      const p = s.pending;
      if (p.lastShotPeakWc != null && wc != null && p.lastShotAt) {
        p.odb = Math.round((p.lastShotPeakWc - wc) * 10) / 10;
        p.odbHours = Math.round(((now.getTime() - Date.parse(p.lastShotAt)) / 3_600_000) * 10) / 10;
        if (p.odbHours > 2 && p.odb > 0) {
          const rate = p.odb / p.odbHours;
          s.overnightRatePctPerHour = Math.round((s.overnightRatePctPerHour == null ? rate : s.overnightRatePctPerHour * 0.6 + rate * 0.4) * 100) / 100;
        }
      }
      events.push({ type: 'day_closed', summary: p });
      s.pending = null;
    }

    s.shots.push({ at: nowIso, seconds, pct, kind, preWc: wc });
    s.irrigatedMl += mlPerBlock(seconds, cfg);
    if (kind === 'P1') s.p1Shots += 1;
    if (kind === 'emergency') s.emergencyShots += 1;
    s.postShotPeakWc = wc;
  };

  if (input.observedShotSeconds && input.observedShotSeconds > 0) {
    const pct = input.observedShotSeconds * pctPerSecond(cfg) * s.efficiency;
    recordShot('observed', input.observedShotSeconds, Math.round(pct * 10) / 10);
    events.push({ type: 'shot', kind: 'observed', seconds: input.observedShotSeconds, pct: Math.round(pct * 10) / 10, reason: 'Irrigation observed from the existing Growlink program.', wc });
  }

  // ── 4. Decide ──────────────────────────────────────────────────────────────
  let hint = '';
  let decision: { kind: ShotKind; pct: number; reason: string } | null = null;
  const nowDt = ci.local;

  if (!ci.lightsOnNow && s.period !== 'night') setPeriod('P3', 'Lights off.');

  if (!profile.autopilot) {
    hint = 'Phase 1 is tray-weight driven — monitoring only.';
  } else if (input.paused) {
    hint = 'Paused.';
  } else if (ci.lightsOnNow) {
    if (s.period === 'night') {
      const drop = s.lightsOnWc != null && wc != null ? s.lightsOnWc - wc : 0;
      const dropTrigger = drop >= mid(targets.startWcDropPct);
      if (nowDt >= deadline) {
        setPeriod('P3', 'Past the last-shot deadline before P1 could start.');
      } else if (nowDt >= startDelayAt || dropTrigger) {
        if (wc != null && wc >= targets.dayWc.max) {
          setPeriod('P2', `WC ${wc.toFixed(1)}% already in the day band; skipping the P1 ramp.`);
          s.postShotPeakWc = wc;
        } else {
          setPeriod('P1', dropTrigger ? `WC dropped ${drop.toFixed(1)}% since lights-on.` : `${t.startDelayHours} h after lights-on.`);
        }
      } else {
        hint = `P1 starts at ${startDelayAt.toFormat('HH:mm')} or after a ${mid(targets.startWcDropPct)}% WC drop.`;
      }
    }

    if (s.period === 'P1') {
      if (nowDt >= deadline) setPeriod('P3', 'Last-shot deadline reached.');
      else if (wc != null && wc >= targets.dayWc.min) setPeriod('P2', `WC ${wc.toFixed(1)}% reached the ${targets.dayWc.min}–${targets.dayWc.max}% day band.`);
      else if (s.p1Shots >= P1_MAX_SHOTS) {
        setPeriod('P2', 'P1 shot cap reached.');
        alertOnce('p1_cap', 'warning', `P1 took ${P1_MAX_SHOTS} shots without reaching ${targets.dayWc.min}% WC. Check emitters, flow and sensor placement.`);
      } else if (minsSinceShot >= t.p1IntervalMin) {
        decision = { kind: 'P1', pct: t.p1ShotPct, reason: `P1 ramp: WC ${wc?.toFixed(1) ?? '—'}% → target ${targets.dayWc.min}%.` };
      } else hint = `Next P1 shot in ${Math.ceil(t.p1IntervalMin - minsSinceShot)} min.`;
    }

    if (s.period === 'P2') {
      if (nowDt >= deadline) setPeriod('P3', `Last shot at ${deadline.toFormat('HH:mm')} to build a ${targets.odb.min}–${targets.odb.max}% overnight dry-back.`);
      else if (wc != null && dryback != null) {
        if (wc < targets.dayWc.min - t.p2TriggerPct * 1.5 && minsSinceShot >= t.p2IntervalMin) {
          decision = { kind: 'catchup', pct: t.p1ShotPct, reason: `Catch-up: WC ${wc.toFixed(1)}% fell well below the ${targets.dayWc.min}% band.` };
        } else if (dryback >= t.p2TriggerPct && minsSinceShot >= t.p2IntervalMin && wc < targets.dayWc.max) {
          // Refill toward the top of the day band; p2ShotPct is the ceiling, not a fixed dose.
          // When substrate EC is high the full dose runs — refresh needs drain.
          const ecNow = readings.ec ?? (s.ecCount ? s.ecSum / s.ecCount : null);
          const ecHigh = ecNow != null && ecNow > targets.substrateEc.max;
          const room = targets.dayWc.max + 1 - wc;
          const pct = ecHigh ? t.p2ShotPct : Math.min(t.p2ShotPct, Math.max(t.p2ShotPct * 0.4, room));
          decision = { kind: 'P2', pct, reason: `P2: dry-back ${dryback.toFixed(1)}% ≥ ${t.p2TriggerPct}% trigger.` };
        } else if (wc >= targets.dayWc.max) {
          hint = `WC ${wc.toFixed(1)}% at the top of the band — holding.`;
        } else {
          hint = dryback < t.p2TriggerPct
            ? `Next P2 shot after ${(t.p2TriggerPct - dryback).toFixed(1)}% more dry-back.`
            : `Next P2 shot in ${Math.ceil(t.p2IntervalMin - minsSinceShot)} min.`;
        }
      }
    }
    if (s.period === 'P3') hint = hint || 'Overnight dry-back — no irrigation until next cycle.';
  } else {
    hint = s.period === 'P3' ? 'Overnight dry-back.' : `Lights on at ${ci.nextLightsOn.toFormat('HH:mm')}.`;
  }

  // Emergency floor (any period, autopilot phases).
  if (!decision && profile.autopilot && !input.paused && wc != null) {
    const floor = cfg.emergencyWcFloor ?? emergencyFloor(phase);
    if (wc < floor) {
      if (s.emergencyShots < MAX_EMERGENCY_SHOTS && minsSinceShot >= 30) {
        decision = { kind: 'emergency', pct: t.p2ShotPct, reason: `Emergency: WC ${wc.toFixed(1)}% below the ${floor.toFixed(0)}% floor.` };
        alertOnce(`emergency_${s.emergencyShots}`, 'critical', `WC ${wc.toFixed(1)}% fell below the ${floor.toFixed(0)}% safety floor. Emergency shot fired.`);
      } else {
        alertOnce('emergency_exhausted', 'critical', `WC ${wc.toFixed(1)}% is below the safety floor and emergency shots are used up. Check the room now.`);
      }
    }
  }

  // Blind = hold. No shot of any kind without a fresh water-content reading.
  if (decision && wc == null) {
    decision = null;
    hint = 'Holding: no fresh water-content reading from the mapped sensors.';
  }

  if (decision && s.shots.length >= t.maxShotsPerDay && decision.kind !== 'emergency') {
    alertOnce('max_shots', 'warning', `Daily shot cap (${t.maxShotsPerDay}) reached.`);
    decision = null;
  }
  if (decision && input.valveBusy) { hint = 'Valve still open from the previous shot.'; decision = null; }

  // EC modulation of maintenance shot size.
  if (decision && (decision.kind === 'P2' || decision.kind === 'catchup') && s.ecCount > 0) {
    const ecNow = readings.ec ?? s.ecSum / s.ecCount;
    if (ecNow > targets.substrateEc.max) {
      decision.pct *= 1.25;
      decision.reason += ` EC ${ecNow.toFixed(1)} high → +25% volume.`;
      alertOnce('ec_high', 'info', `Substrate EC ${ecNow.toFixed(1)} mS/cm above the ${targets.substrateEc.max} target. Shots enlarged to drive refresh.`);
    } else if (ecNow < targets.substrateEc.min) {
      decision.pct *= 0.8;
      decision.reason += ` EC ${ecNow.toFixed(1)} low → −20% volume.`;
      alertOnce('ec_low', 'info', `Substrate EC ${ecNow.toFixed(1)} mS/cm below the ${targets.substrateEc.min} target. Shots trimmed to limit drain.`);
    }
  }

  if (decision) {
    const pct = Math.round(decision.pct * 10) / 10;
    const seconds = shotSeconds(pct, cfg, s.efficiency);
    if (input.mode === 'shadow') {
      const lastShadow = s.lastShadowAt ? (now.getTime() - Date.parse(s.lastShadowAt)) / 60_000 : Infinity;
      if (lastShadow >= Math.min(t.p1IntervalMin, t.p2IntervalMin)) {
        s.lastShadowAt = nowIso;
        events.push({ type: 'shadow_shot', kind: decision.kind, seconds, pct, reason: decision.reason, wc });
      }
      hint = `Shadow: would fire a ${seconds}s ${decision.kind} shot.`;
    } else {
      actions.push({ type: 'shot', kind: decision.kind, seconds, pct, reason: decision.reason });
      recordShot(decision.kind, seconds, pct);
      events.push({ type: 'shot', kind: decision.kind, seconds, pct, reason: decision.reason, wc });
      hint = `Fired a ${seconds}s ${decision.kind} shot.`;
    }
  }

  return {
    state: s,
    actions,
    events,
    status: {
      cycleKey: ci.cycleKey, period: s.period, lightsOnNow: ci.lightsOnNow,
      lightsOnAt: ci.lightsOnAt.toISO()!, lightsOffAt: ci.lightsOffAt.toISO()!,
      p1StartAt: startDelayAt.toISO()!, lastShotDeadline: deadline.toISO()!,
      targets, wc, ec: fresh ? readings.ec : null, shotsToday: s.shots.length,
      drybackSinceShot: dryback == null ? null : Math.round(dryback * 10) / 10,
      nextShotHint: hint, readingsFresh: fresh,
    },
  };
}

/** Record a manual/test shot fired outside the engine's decision (e.g. from the UI). */
export function recordManualShot(state: EngineState, now: Date, seconds: number, cfg: RoomConfig, wc: number | null): EngineState {
  const s = structuredClone(state);
  const pct = Math.round(seconds * pctPerSecond(cfg) * s.efficiency * 10) / 10;
  s.shots.push({ at: now.toISOString(), seconds, pct, kind: 'test', preWc: wc });
  s.irrigatedMl += mlPerBlock(seconds, cfg);
  s.postShotPeakWc = wc;
  return s;
}

export function describeEvent(e: EngineEvent): string {
  switch (e.type) {
    case 'shot': return `${e.kind} shot ${e.seconds}s (${e.pct}% WC). ${e.reason}`;
    case 'shadow_shot': return `Would fire ${e.kind} shot ${e.seconds}s (${e.pct}% WC). ${e.reason}`;
    case 'period': return `${e.from} → ${e.to}. ${e.reason}`;
    case 'alert': return e.message;
    case 'day_closed': return `Cycle ${e.summary.cycleKey} closed: ${e.summary.shots} shots, peak ${e.summary.peakWc ?? '—'}%, ODB ${e.summary.odb ?? '—'}%.`;
    case 'cycle_started': return `Cycle ${e.cycleKey} started.`;
  }
}

export const eventSeverity = (e: EngineEvent): 'info' | 'warning' | 'critical' => (e.type === 'alert' ? e.severity : 'info');
