import { PHASES, PhaseId, ResolvedTargets } from './profiles';
import { DaySummary, Tuning, TuningKey, TUNING_LABELS, tuningBounds, applyChanges, TuningChange, limitStep, MAX_STEP_PER_REVIEW } from './tuning';

/**
 * The nightly AI agronomist. It reads the closed cycle against Grodan's targets and the
 * recent trajectory, then proposes bounded tuning changes through a single tool call.
 */

export interface ReviewContext {
  roomName: string;
  phase: PhaseId;
  dayInPhase: number;
  targets: ResolvedTargets;
  tuning: Tuning;
  day: DaySummary;
  history: DaySummary[];
  efficiency: number;
  overnightRatePctPerHour: number | null;
  ruleChanges: TuningChange[];
  growerNotes?: string | null;
}

export interface AiReview {
  summary: string;
  assessment: 'on_track' | 'watch' | 'off_track';
  changes: { key: TuningKey; to: number; reason: string }[];
  phaseAdvance: { recommend: boolean; reason: string };
  alerts: string[];
}

const TUNING_KEYS = Object.keys(TUNING_LABELS) as TuningKey[];

export const REVIEW_TOOL = {
  name: 'submit_review',
  description: 'Submit the daily crop-steering review and any tuning changes for tomorrow.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: '2–4 plain sentences for the grower: what happened, how it compares to Grodan targets, what changes tomorrow. No preamble.' },
      assessment: { type: 'string', enum: ['on_track', 'watch', 'off_track'] },
      changes: {
        type: 'array',
        description: 'Tuning changes for the next cycle. Empty when no change is warranted. Prefer one or two moves.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', enum: TUNING_KEYS },
            to: { type: 'number' },
            reason: { type: 'string', description: 'One sentence citing the metric and the target.' },
          },
          required: ['key', 'to', 'reason'],
        },
      },
      phase_advance: {
        type: 'object',
        properties: { recommend: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['recommend', 'reason'],
      },
      alerts: { type: 'array', items: { type: 'string' }, description: 'Issues a person should check in the room (hardware, sensors, crop). Empty if none.' },
    },
    required: ['summary', 'assessment', 'changes', 'phase_advance', 'alerts'],
  },
};

const fmt = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${v}${unit}`);

function dayLine(d: DaySummary) {
  return `${d.cycleKey} (day ${d.dayInPhase}): shots ${d.shots}${d.emergencyShots ? ` (+${d.emergencyShots} emergency)` : ''}, ` +
    `${d.irrigationMlPerBlock} ml/block, lights-on WC ${fmt(d.lightsOnWc, '%')}, peak ${fmt(d.peakWc, '%')}, min ${fmt(d.minWc, '%')}, ` +
    `avg P2 dry-back ${fmt(d.avgP2Dryback, '%')}, ODB ${fmt(d.odb, '%')} over ${fmt(d.odbHours, 'h')}, ` +
    `EC avg ${fmt(d.avgEc)} / max ${fmt(d.maxEc)} mS/cm, est. drain ${fmt(d.drainPctEst, '%')}, stale ${d.staleMinutes} min`;
}

export function buildReviewPrompt(ctx: ReviewContext) {
  const p = PHASES[ctx.phase];
  const t = ctx.targets;
  const bounds = tuningBounds(ctx.phase);
  const system = [
    'You are the crop-steering agronomist inside Growlink\'s Crop Steering Autopilot. You review one room\'s closed irrigation cycle on Grodan stonewool large blocks and tune tomorrow\'s irrigation.',
    'You steer with Grodan\'s 5-Phase Model and Day-Dynamic model: P1 ramps WC from the overnight low into the day band, P2 holds it with shots triggered by inter-irrigation dry-back, P3 is the overnight dry-back from the last shot to the next morning\'s first shot.',
    'Levers: shot size moves day-level WC and drain/EC; the P2 dry-back trigger sets steering intensity (larger = more generative); the last-shot time sets the overnight dry-back; the P1 start sets how early WC recovers.',
    'Rules: move toward the targets in small steps (one or two parameters per day); never chase a single noisy day when the trend is fine; explain each change by citing the metric and target; keep the summary short, concrete and assertive — written for a head grower.',
    'A deterministic rule engine has already applied safety adjustments, listed below. You may keep, refine or reverse them. Stay within the hard bounds; values outside are clamped.',
    'Always respond by calling submit_review.',
  ].join('\n');

  const user = [
    `Room: ${ctx.roomName}`,
    `Phase ${p.id} — ${p.name}, day ${ctx.dayInPhase} (typical ${p.durationDays.min}–${p.durationDays.max} days). Objective: ${p.objective}`,
    '',
    'Grodan targets for this day:',
    `- Day-level WC ${t.dayWc.min}–${t.dayWc.max}%`,
    `- Overnight dry-back ${t.odb.min}–${t.odb.max}%`,
    `- Inter-irrigation (P2) dry-back ${t.p2Dryback.min}–${t.p2Dryback.max}%`,
    `- Substrate EC ${t.substrateEc.min}–${t.substrateEc.max} mS/cm (drip ${t.dripEc.min}–${t.dripEc.max})`,
    `- 24 h drain ${t.drainPct.min}–${t.drainPct.max}%`,
    `- Shot strategy: ${t.shotStrategy === 'generative' ? 'generative — large, infrequent' : 'vegetative — small, frequent'}`,
    '',
    'Phase guidance:',
    ...p.guidance.map((g) => `- ${g}`),
    '',
    'Closed cycle:',
    `- ${dayLine(ctx.day)}`,
    '',
    'Recent history (oldest first):',
    ...(ctx.history.length ? ctx.history.map((d) => `- ${dayLine(d)}`) : ['- none yet']),
    '',
    `Calibration: observed/planned WC rise ${ctx.efficiency.toFixed(2)}; learned overnight dry-back rate ${fmt(ctx.overnightRatePctPerHour, ' %/h')}.`,
    '',
    'Current tuning (bounds):',
    ...TUNING_KEYS.map((k) => `- ${k} = ${ctx.tuning[k]} (bounds ${bounds[k].min}–${bounds[k].max}, max move ±${MAX_STEP_PER_REVIEW[k]} per review) — ${TUNING_LABELS[k]}`),
    '',
    'Rule-engine changes already applied:',
    ...(ctx.ruleChanges.length ? ctx.ruleChanges.map((c) => `- ${c.key}: ${c.from} → ${c.to} (${c.reason})`) : ['- none']),
    ...(ctx.growerNotes ? ['', `Grower notes: ${ctx.growerNotes}`] : []),
    '',
    'Estimated drain is inferred from WC response near field capacity, not measured — weight it lightly.',
  ].join('\n');
  return { system, user };
}

/** Validate the model's tool input and clamp its changes into bounds. */
export function parseReview(raw: any, phase: PhaseId, tuning: Tuning): { review: AiReview; tuning: Tuning; applied: TuningChange[] } {
  const changes = Array.isArray(raw?.changes) ? raw.changes : [];
  const clean = changes
    .filter((c: any) => TUNING_KEYS.includes(c?.key) && Number.isFinite(Number(c?.to)))
    .slice(0, 4)
    .map((c: any) => ({ key: c.key as TuningKey, to: limitStep(tuning, c.key as TuningKey, Number(c.to)), reason: String(c.reason ?? '').slice(0, 400) }));
  const review: AiReview = {
    summary: String(raw?.summary ?? '').slice(0, 1200),
    assessment: ['on_track', 'watch', 'off_track'].includes(raw?.assessment) ? raw.assessment : 'watch',
    changes: clean,
    phaseAdvance: { recommend: !!raw?.phase_advance?.recommend, reason: String(raw?.phase_advance?.reason ?? '').slice(0, 400) },
    alerts: Array.isArray(raw?.alerts) ? raw.alerts.map(String).slice(0, 5) : [],
  };
  const { tuning: next, applied } = applyChanges(phase, tuning, clean);
  return { review, tuning: next, applied };
}
