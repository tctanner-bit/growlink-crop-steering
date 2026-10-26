import { PHASES, PhaseId, ResolvedTargets, Range, mid } from './profiles';

/** Per-room steering parameters. Seeded from the phase profile, then tuned daily (rules + AI). */
export interface Tuning {
  /** Target WC% rise per ramp (P1) shot. */
  p1ShotPct: number;
  /** Target WC% rise per maintenance (P2) shot. */
  p2ShotPct: number;
  /** Minimum minutes between P1 shots (lets WC settle). */
  p1IntervalMin: number;
  /** Minimum minutes between P2 shots. */
  p2IntervalMin: number;
  /** WC% drop from the post-shot peak that triggers the next P2 shot. */
  p2TriggerPct: number;
  /** Hours after lights-on to start P1 if the WC-drop trigger has not fired first. */
  startDelayHours: number;
  /** Hours before lights-off for the last shot (sets the overnight dry-back). */
  stopBeforeLightsOffHours: number;
  maxShotsPerDay: number;
}

export type TuningKey = keyof Tuning;

export const TUNING_LABELS: Record<TuningKey, string> = {
  p1ShotPct: 'P1 shot size (WC%)',
  p2ShotPct: 'P2 shot size (WC%)',
  p1IntervalMin: 'P1 min interval (min)',
  p2IntervalMin: 'P2 min interval (min)',
  p2TriggerPct: 'P2 dry-back trigger (WC%)',
  startDelayHours: 'P1 start after lights-on (h)',
  stopBeforeLightsOffHours: 'Last shot before lights-off (h)',
  maxShotsPerDay: 'Max shots per day',
};

export function defaultTuning(phase: PhaseId): Tuning {
  const p = PHASES[phase];
  const gen = p.shotStrategy === 'generative';
  return {
    p1ShotPct: gen ? 5 : 3,
    p2ShotPct: gen ? 4 : 2,
    p1IntervalMin: gen ? 20 : 15,
    p2IntervalMin: gen ? 30 : 15,
    p2TriggerPct: p.autopilot ? mid(p.p2Dryback) : 2,
    startDelayHours: p.autopilot ? mid(p.startDelayHours) : 1,
    stopBeforeLightsOffHours: p.autopilot ? mid(p.stopBeforeLightsOffHours) : 2,
    maxShotsPerDay: gen ? 16 : 30,
  };
}

/** Hard limits. Neither the rules nor the AI can move a parameter outside these. */
export function tuningBounds(phase: PhaseId): Record<TuningKey, Range> {
  const p = PHASES[phase];
  return {
    p1ShotPct: { min: 1, max: 8 },
    p2ShotPct: { min: 0.5, max: 8 },
    p1IntervalMin: { min: 8, max: 90 },
    p2IntervalMin: { min: 8, max: 180 },
    p2TriggerPct: p.autopilot
      ? { min: Math.max(0.5, p.p2Dryback.min - 0.5), max: p.p2Dryback.max + 1 }
      : { min: 0.5, max: 8 },
    startDelayHours: { min: 0, max: 3 },
    stopBeforeLightsOffHours: p.autopilot
      ? { min: Math.max(0, p.stopBeforeLightsOffHours.min - 1), max: p.stopBeforeLightsOffHours.max + 2 }
      : { min: 0, max: 8 },
    maxShotsPerDay: { min: 2, max: 40 },
  };
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const STEP: Record<TuningKey, number> = {
  p1ShotPct: 0.1, p2ShotPct: 0.1, p1IntervalMin: 1, p2IntervalMin: 1,
  p2TriggerPct: 0.1, startDelayHours: 0.05, stopBeforeLightsOffHours: 0.05, maxShotsPerDay: 1,
};

export function clampTuning(phase: PhaseId, t: Tuning): Tuning {
  const b = tuningBounds(phase);
  const out = { ...t };
  for (const k of Object.keys(b) as TuningKey[]) {
    const v = Number(out[k]);
    const safe = Number.isFinite(v) ? v : defaultTuning(phase)[k];
    out[k] = Math.round(round(Math.min(b[k].max, Math.max(b[k].min, safe)), STEP[k]) * 100) / 100;
  }
  return out;
}

export interface TuningChange { key: TuningKey; from: number; to: number; reason: string }

/** Largest move one AI review may make to a parameter — big shifts take several nights. */
export const MAX_STEP_PER_REVIEW: Record<TuningKey, number> = {
  p1ShotPct: 1.5, p2ShotPct: 1.5, p1IntervalMin: 15, p2IntervalMin: 30,
  p2TriggerPct: 1, startDelayHours: 0.5, stopBeforeLightsOffHours: 1, maxShotsPerDay: 4,
};

export function limitStep(t: Tuning, key: TuningKey, to: number): number {
  const d = MAX_STEP_PER_REVIEW[key];
  return Math.min(t[key] + d, Math.max(t[key] - d, to));
}

/** Apply a set of proposed changes with clamping; drops no-ops. */
export function applyChanges(phase: PhaseId, t: Tuning, changes: { key: TuningKey; to: number; reason: string }[]) {
  let next = { ...t };
  const applied: TuningChange[] = [];
  for (const c of changes) {
    if (!(c.key in next)) continue;
    const candidate = clampTuning(phase, { ...next, [c.key]: c.to });
    if (candidate[c.key] !== next[c.key]) {
      applied.push({ key: c.key, from: next[c.key], to: candidate[c.key], reason: c.reason });
      next = candidate;
    }
  }
  return { tuning: next, applied };
}

/** One closed light-cycle, with its overnight dry-back measured at the next cycle's first shot. */
export interface DaySummary {
  cycleKey: string;
  phase: PhaseId;
  dayInPhase: number;
  shots: number;
  emergencyShots: number;
  irrigationSeconds: number;
  irrigationMlPerBlock: number;
  lightsOnWc: number | null;
  peakWc: number | null;
  minWc: number | null;
  firstShotAt: string | null;
  lastShotAt: string | null;
  lastShotPeakWc: number | null;
  avgP2Dryback: number | null;
  avgEc: number | null;
  maxEc: number | null;
  drainPctEst: number | null;
  staleMinutes: number;
  /** Overnight dry-back into the following morning (filled in at the next first shot). */
  odb: number | null;
  odbHours: number | null;
}

/**
 * Deterministic daily tuning — the safety net that steers even with the AI disabled.
 * Small, bounded moves toward the Grodan targets.
 */
export function ruleBasedAdjustments(
  phase: PhaseId,
  t: Tuning,
  day: DaySummary,
  targets: ResolvedTargets,
  dayRatePctPerHour: number | null,
): { key: TuningKey; to: number; reason: string }[] {
  if (!PHASES[phase].autopilot || day.shots === 0) return [];
  const out: { key: TuningKey; to: number; reason: string }[] = [];

  // 1. Overnight dry-back → move the last-shot time.
  if (day.odb != null) {
    // Aim for the middle of the band; a dead-band of a quarter of its width avoids hunting.
    const target = mid(targets.odb);
    const deadband = Math.max(0.75, (targets.odb.max - targets.odb.min) / 4);
    // Moving the last shot by 1 h changes ODB by roughly the daytime dry-back rate.
    const rate = dayRatePctPerHour && dayRatePctPerHour > 0.3 ? dayRatePctPerHour : 2;
    if (Math.abs(day.odb - target) > deadband) {
      const hours = Math.max(-0.75, Math.min(0.75, ((target - day.odb) / rate) * 0.5));
      out.push({
        key: 'stopBeforeLightsOffHours', to: t.stopBeforeLightsOffHours + hours,
        reason: `Overnight dry-back ${day.odb.toFixed(1)}% vs ${targets.odb.min}–${targets.odb.max}% target (aiming ${target.toFixed(1)}%); moving the last shot ${hours > 0 ? 'earlier' : 'later'} by ${Math.abs(hours * 60).toFixed(0)} min.`,
      });
    }
  }

  // 2. Day-level WC → shot volume. The WC band outranks EC.
  let wcInBand = true;
  if (day.peakWc != null) {
    wcInBand = day.peakWc >= targets.dayWc.min - 1 && day.peakWc <= targets.dayWc.max + 2;
    if (day.peakWc < targets.dayWc.min - 1) {
      out.push({ key: 'p1ShotPct', to: t.p1ShotPct + 0.5, reason: `Peak WC ${day.peakWc.toFixed(1)}% below the ${targets.dayWc.min}–${targets.dayWc.max}% band; larger ramp shots.` });
      out.push({ key: 'startDelayHours', to: t.startDelayHours - 0.25, reason: 'Start P1 15 min earlier so WC reaches the band sooner.' });
    } else if (day.peakWc > targets.dayWc.max + 2) {
      out.push({ key: 'p2ShotPct', to: t.p2ShotPct - 0.3, reason: `Peak WC ${day.peakWc.toFixed(1)}% above the band; trimming maintenance shots.` });
    }
  }

  // 3. Substrate EC → refresh volume.
  if (day.avgEc != null && wcInBand) {
    const ecCap = defaultTuning(phase).p2ShotPct * 1.75;
    if (day.avgEc > targets.substrateEc.max && t.p2ShotPct < ecCap) {
      out.push({ key: 'p2ShotPct', to: Math.min(ecCap, t.p2ShotPct + 0.4), reason: `Substrate EC ${day.avgEc.toFixed(1)} above ${targets.substrateEc.max} mS/cm; more volume for drain and refresh.` });
    } else if (day.avgEc < targets.substrateEc.min) {
      out.push({ key: 'p2ShotPct', to: t.p2ShotPct - 0.3, reason: `Substrate EC ${day.avgEc.toFixed(1)} below ${targets.substrateEc.min} mS/cm; less drain to let EC build.` });
    }
  }

  // 4. Estimated drain (only without an EC signal).
  if (day.drainPctEst != null && day.avgEc == null && wcInBand) {
    if (day.drainPctEst > targets.drainPct.max + 5) {
      out.push({ key: 'p2ShotPct', to: t.p2ShotPct - 0.3, reason: `Estimated drain ${day.drainPctEst.toFixed(0)}% above target; smaller shots.` });
    }
  }
  // One move per parameter per day — the first (highest-priority) rule wins.
  const seen = new Set<TuningKey>();
  return out.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}
