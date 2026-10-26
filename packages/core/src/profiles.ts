// Growlink Rock Wool Crop Steering — phase profiles for large rock wool blocks.
// Root-zone & irrigation targets per phase.
// Guidance strings are short paraphrases used to brief the AI reviewer.

export type PhaseId = 1 | 2 | 3 | 4 | 5;
export type ShotStrategy = 'vegetative' | 'generative';

export interface Range { min: number; max: number }

export interface PhaseProfile {
  id: PhaseId;
  name: string;
  shortName: string;
  durationDays: Range;
  /** Phase 1 (propagation) is tray-weight driven, so the autopilot only monitors it. */
  autopilot: boolean;
  startDelayHours: Range;
  startWcDropPct: Range;
  stopBeforeLightsOffHours: Range;
  /** Day-level WC% band at the start and end of the phase (linear ramp across the phase). */
  dayWcStart: Range;
  dayWcEnd: Range;
  /** Days over which the day-level WC ramps from start to end band. */
  dayWcRampDays: number;
  /** Overnight dry-back (P3) band at phase start and end. */
  odbStart: Range;
  odbEnd: Range;
  odbRampDays: number;
  /** Inter-irrigation dry-back between P2 shots. */
  p2Dryback: Range;
  dripEc: Range;
  substrateEc: Range;
  drainPct: Range;
  shotStrategy: ShotStrategy;
  objective: string;
  guidance: string[];
}

export const PHASES: Record<PhaseId, PhaseProfile> = {
  1: {
    id: 1, name: 'Propagation of Cuttings', shortName: 'Propagation',
    durationDays: { min: 10, max: 18 }, autopilot: false,
    startDelayHours: { min: 0, max: 0 }, startWcDropPct: { min: 0, max: 0 },
    stopBeforeLightsOffHours: { min: 0, max: 0 },
    dayWcStart: { min: 60, max: 75 }, dayWcEnd: { min: 60, max: 75 }, dayWcRampDays: 1,
    odbStart: { min: 0, max: 0 }, odbEnd: { min: 0, max: 0 }, odbRampDays: 1,
    p2Dryback: { min: 0, max: 0 },
    dripEc: { min: 1.5, max: 2.5 }, substrateEc: { min: 1.5, max: 2.5 }, drainPct: { min: 0, max: 0 },
    shotStrategy: 'vegetative',
    objective: 'Fast, disease-free callus formation and root initiation in propagation plugs.',
    guidance: [
      'Irrigate by tray weight: water when the tray has lost 40–50% of its starting weight.',
      'Saturate plugs at EC 1.5–2.5 mS/cm, pH 5.5; keep WC moderate to avoid stem rot.',
      'Step RH down from 80–90% (days 1–4) to ~72% by days 11–18; 18–20 h photoperiod at 150–200 µmol/m²/s.',
    ],
  },
  2: {
    id: 2, name: 'Vegetative Growth', shortName: 'Veg',
    durationDays: { min: 7, max: 14 }, autopilot: true,
    startDelayHours: { min: 1, max: 1 }, startWcDropPct: { min: 1, max: 2 },
    stopBeforeLightsOffHours: { min: 1, max: 4 },
    dayWcStart: { min: 78, max: 82 }, dayWcEnd: { min: 63, max: 67 }, dayWcRampDays: 4,
    odbStart: { min: 8, max: 12 }, odbEnd: { min: 8, max: 12 }, odbRampDays: 1,
    p2Dryback: { min: 2, max: 3 },
    dripEc: { min: 2.5, max: 3.5 }, substrateEc: { min: 2.5, max: 4.5 }, drainPct: { min: 0, max: 10 },
    shotStrategy: 'vegetative',
    objective: 'Fast, uniform rooting into the large block and a compact, well-branched canopy.',
    guidance: [
      'Day-level WC starts near field capacity (80%+) at transplant and steps down to ~65% within the first few days to drive horizontal rooting.',
      'Target ~10% overnight dry-back and 2–3% between shots; small, frequent (vegetative) shots.',
      'Keep drain low (0–10%) so block EC climbs naturally toward 3.5–4.5 mS/cm by flower induction.',
      'For the first 1–3 days after transplant, small daily irrigations (~1% of substrate volume) keep the plug–block interface wet.',
    ],
  },
  3: {
    id: 3, name: 'Flower Setting', shortName: 'Flower set',
    durationDays: { min: 21, max: 21 }, autopilot: true,
    startDelayHours: { min: 0.5, max: 2 }, startWcDropPct: { min: 1, max: 2 },
    stopBeforeLightsOffHours: { min: 2, max: 5 },
    dayWcStart: { min: 60, max: 65 }, dayWcEnd: { min: 60, max: 65 }, dayWcRampDays: 1,
    odbStart: { min: 10, max: 15 }, odbEnd: { min: 22, max: 25 }, odbRampDays: 21,
    p2Dryback: { min: 4, max: 6 },
    dripEc: { min: 2.5, max: 3.5 }, substrateEc: { min: 4, max: 9 }, drainPct: { min: 10, max: 20 },
    shotStrategy: 'generative',
    objective: 'Shift energy to reproductive growth, control stretch and set uniform bud sites.',
    guidance: [
      'Generative steering: large, infrequent shots; 4–6% dry-back between shots; stop ~2 h before lights-off.',
      'Overnight dry-back should grow from ~10–15% to a consistent ~25% by day 21 of flower.',
      'Let substrate EC rise gradually (4–9 mS/cm) as controlled stress; drain 10–20% to refresh.',
      'If peak daytime WC trends down across consecutive days, the block is not re-saturating — increase shot volume or start earlier.',
      'Drain at low WC indicates channeling: switch to smaller, more frequent shots until daytime WC recovers.',
    ],
  },
  4: {
    id: 4, name: 'Flower Swelling & Bulking', shortName: 'Bulking',
    durationDays: { min: 21, max: 21 }, autopilot: true,
    startDelayHours: { min: 0.5, max: 1 }, startWcDropPct: { min: 1, max: 2 },
    stopBeforeLightsOffHours: { min: 1, max: 3 },
    dayWcStart: { min: 60, max: 65 }, dayWcEnd: { min: 60, max: 65 }, dayWcRampDays: 1,
    odbStart: { min: 10, max: 15 }, odbEnd: { min: 10, max: 15 }, odbRampDays: 1,
    p2Dryback: { min: 2, max: 3 },
    dripEc: { min: 2.5, max: 3.5 }, substrateEc: { min: 4, max: 7 }, drainPct: { min: 20, max: 30 },
    shotStrategy: 'vegetative',
    objective: 'Maximize flower swelling and biomass with easily available water and balanced nutrition.',
    guidance: [
      'Steer back toward vegetative: small, frequent shots, higher daytime WC (60–65%) and a reduced 10–15% overnight dry-back.',
      'Bring substrate EC down slowly (4–7 mS/cm) through consistent daily drain (20–30%), not sharp drip-EC cuts or big flushes.',
      'Start irrigating early enough that WC rises through the morning.',
    ],
  },
  5: {
    id: 5, name: 'Flower Ripening', shortName: 'Ripening',
    durationDays: { min: 14, max: 21 }, autopilot: true,
    startDelayHours: { min: 1, max: 2 }, startWcDropPct: { min: 1, max: 2 },
    stopBeforeLightsOffHours: { min: 2, max: 6 },
    dayWcStart: { min: 60, max: 65 }, dayWcEnd: { min: 55, max: 60 }, dayWcRampDays: 14,
    odbStart: { min: 20, max: 25 }, odbEnd: { min: 20, max: 25 }, odbRampDays: 1,
    p2Dryback: { min: 4, max: 6 },
    dripEc: { min: 1.8, max: 3.0 }, substrateEc: { min: 5, max: 8 }, drainPct: { min: 10, max: 25 },
    shotStrategy: 'generative',
    objective: 'Ripen flowers and drive peak cannabinoid accumulation while protecting the crop.',
    guidance: [
      'Gradually lower day-level WC from ~60–65% to 55–60% — a trajectory, not an abrupt dry-down.',
      'Larger, less frequent shots; 4–6% inter-irrigation dry-back; 20–25% overnight dry-back.',
      'Avoid low substrate EC with chronically high WC (water pushed into flower tissue); a mild drip-EC reduction is fine, excessive runoff is not.',
      'Keep VPD stable at ~1.1–1.3 kPa day and night; irrigate after plants are transpiring, not near lights-off.',
    ],
  },
};

export const PHASE_ORDER: PhaseId[] = [1, 2, 3, 4, 5];

export interface ResolvedTargets {
  phase: PhaseId;
  dayInPhase: number;
  dayWc: Range;
  odb: Range;
  p2Dryback: Range;
  substrateEc: Range;
  dripEc: Range;
  drainPct: Range;
  startDelayHours: Range;
  startWcDropPct: Range;
  stopBeforeLightsOffHours: Range;
  shotStrategy: ShotStrategy;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRange = (a: Range, b: Range, t: number): Range => ({
  min: Math.round(lerp(a.min, b.min, t) * 10) / 10,
  max: Math.round(lerp(a.max, b.max, t) * 10) / 10,
});

/** Targets for a given day in a phase (day 1 = first day). Ramps are linear and clamp at the end. */
export function resolveTargets(phase: PhaseId, dayInPhase: number): ResolvedTargets {
  const p = PHASES[phase];
  const d = Math.max(1, dayInPhase);
  const wcT = p.dayWcRampDays <= 1 ? 1 : Math.min(1, (d - 1) / (p.dayWcRampDays - 1));
  const odbT = p.odbRampDays <= 1 ? 1 : Math.min(1, (d - 1) / (p.odbRampDays - 1));
  return {
    phase,
    dayInPhase: d,
    dayWc: lerpRange(p.dayWcStart, p.dayWcEnd, wcT),
    odb: lerpRange(p.odbStart, p.odbEnd, odbT),
    p2Dryback: p.p2Dryback,
    substrateEc: p.substrateEc,
    dripEc: p.dripEc,
    drainPct: p.drainPct,
    startDelayHours: p.startDelayHours,
    startWcDropPct: p.startWcDropPct,
    stopBeforeLightsOffHours: p.stopBeforeLightsOffHours,
    shotStrategy: p.shotStrategy,
  };
}

export const mid = (r: Range) => (r.min + r.max) / 2;
export const inRange = (v: number, r: Range) => v >= r.min && v <= r.max;
