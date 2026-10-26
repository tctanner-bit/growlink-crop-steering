import Anthropic from '@anthropic-ai/sdk';
import {
  applyChanges, buildReviewPrompt, clampTuning, DaySummary, defaultTuning, parseReview, REVIEW_TOOL,
  resolveTargets, ruleBasedAdjustments, TaskPriority, Tuning, TUNING_LABELS, PHASES,
} from '@gl-steering/core';
import { addEvent, loadRoom, q } from './db';
import { env } from './env';
import { apiFor, isSimulated } from './clients';

const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

export const roomTuning = (phase: any, t: Partial<Tuning>) => clampTuning(phase, { ...defaultTuning(phase), ...t });

/**
 * Daily review, run when a cycle closes (at the next morning's first shot, once ODB is known):
 * 1) deterministic rules move tuning toward Grodan targets (always on);
 * 2) the AI agronomist reviews the trajectory and proposes bounded refinements
 *    (applied in `apply` mode, recorded as suggestions in `suggest` mode).
 */
export async function runDailyReview(roomId: string, summary: DaySummary, opts: { rules?: boolean } = {}) {
  const room = await loadRoom(roomId);
  if (!room) return;
  await q(`insert into day_summaries (room_id, cycle_key, summary) values ($1, $2, $3)
           on conflict (room_id, cycle_key) do update set summary = excluded.summary`, [roomId, summary.cycleKey, JSON.stringify(summary)]);

  const phase = room.phase;
  if (!PHASES[phase].autopilot) return;
  const targets = resolveTargets(phase, summary.dayInPhase);
  let tuning = roomTuning(phase, room.tuning);
  const engine = room.state?.engine;

  // 1. Rules.
  let ruleApplied: ReturnType<typeof applyChanges>['applied'] = [];
  if (opts.rules !== false && summary.shots > 0) {
    const out = applyChanges(phase, tuning, ruleBasedAdjustments(phase, tuning, summary, targets, engine?.dayRatePctPerHour ?? null));
    ruleApplied = out.applied;
    if (ruleApplied.length) {
      tuning = out.tuning;
      await q(`update rooms set tuning = $2, updated_at = now() where id = $1`, [roomId, JSON.stringify(tuning)]);
      await q(`insert into reviews (room_id, cycle_key, source, assessment, summary, changes, applied) values ($1, $2, 'rules', null, $3, $4, true)`,
        [roomId, summary.cycleKey, ruleApplied.map((c) => c.reason).join(' '), JSON.stringify(ruleApplied)]);
      await addEvent(roomId, 'tuning', 'info', `Rules adjusted ${ruleApplied.map((c) => TUNING_LABELS[c.key]).join(', ')}.`, { changes: ruleApplied });
    }
  }

  // 2. AI.
  if (room.ai_mode === 'off') return;
  if (!anthropic) {
    await q(`insert into reviews (room_id, cycle_key, source, error) values ($1, $2, 'ai', 'ANTHROPIC_API_KEY not configured')`, [roomId, summary.cycleKey]);
    return;
  }
  const history = await q<{ summary: DaySummary }>(
    `select summary from day_summaries where room_id = $1 and cycle_key < $2 order by cycle_key desc limit 7`, [roomId, summary.cycleKey]);
  const { system, user } = buildReviewPrompt({
    roomName: room.name, phase, dayInPhase: summary.dayInPhase, targets, tuning, day: summary,
    history: history.map((h) => h.summary).reverse(), efficiency: engine?.efficiency ?? 1,
    overnightRatePctPerHour: engine?.overnightRatePctPerHour ?? null, ruleChanges: ruleApplied, growerNotes: room.grower_notes,
  });

  try {
    const msg = await anthropic.messages.create({
      model: env.aiModel,
      max_tokens: 1500,
      system,
      tools: [REVIEW_TOOL as any],
      tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
      messages: [{ role: 'user', content: user }],
    });
    const call = msg.content.find((b: any) => b.type === 'tool_use') as any;
    if (!call) throw new Error('Model did not call submit_review');
    const { review, tuning: next, applied } = parseReview(call.input, phase, tuning);
    const apply = room.ai_mode === 'apply';
    if (apply && applied.length) await q(`update rooms set tuning = $2, updated_at = now() where id = $1`, [roomId, JSON.stringify(next)]);
    await q(
      `insert into reviews (room_id, cycle_key, source, assessment, summary, changes, applied, phase_advance, alerts, model)
       values ($1, $2, 'ai', $3, $4, $5, $6, $7, $8, $9)`,
      [roomId, summary.cycleKey, review.assessment, review.summary, JSON.stringify(applied), apply && applied.length > 0,
        JSON.stringify(review.phaseAdvance), JSON.stringify(review.alerts), env.aiModel]);
    await addEvent(roomId, 'ai_review', review.assessment === 'off_track' ? 'warning' : 'info', review.summary,
      { assessment: review.assessment, changes: applied, applied: apply });
    for (const a of review.alerts) await addEvent(roomId, 'ai_alert', 'warning', a);

    if (room.post_to_tasks && !isSimulated(room, room.conn)) {
      const { api, orgId } = apiFor(room, room.conn, room.state);
      const lines = [review.summary, ...applied.map((c) => `• ${TUNING_LABELS[c.key]}: ${c.from} → ${c.to}${apply ? '' : ' (suggested)'} — ${c.reason}`)];
      await api.createTask?.(orgId, {
        title: `Crop steering review — ${room.name} — ${summary.cycleKey}`,
        description: lines.join('\n'), priority: review.assessment === 'off_track' ? TaskPriority.High : TaskPriority.Low,
        tags: ['crop-steering'], roomId: room.gl_room_id,
      }).catch((e: any) => addEvent(roomId, 'task_error', 'warning', `Could not post the review to Growlink tasks: ${e?.message ?? e}`));
    }
  } catch (e: any) {
    await q(`insert into reviews (room_id, cycle_key, source, error, model) values ($1, $2, 'ai', $3, $4)`, [roomId, summary.cycleKey, String(e?.message ?? e).slice(0, 500), env.aiModel]);
    await addEvent(roomId, 'ai_error', 'warning', `AI review failed: ${e?.message ?? e}`);
  }
}

/** On-demand review of the most recent closed cycle (UI button). AI only — rules already ran. */
export async function runReviewNow(roomId: string) {
  const [last] = await q<{ summary: DaySummary }>(`select summary from day_summaries where room_id = $1 order by cycle_key desc limit 1`, [roomId]);
  if (!last) throw new Error('No closed cycle yet — the first review runs after the first full day.');
  await runDailyReview(roomId, last.summary, { rules: false });
}
