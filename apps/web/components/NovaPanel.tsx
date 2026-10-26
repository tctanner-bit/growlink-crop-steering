'use client';

import { useState, useTransition } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import AiSparkleIcon from '@atlaskit/icon/core/ai-sparkle';
import { TUNING_LABELS, TuningKey } from '@gl-steering/core';
import { applySuggestion, sendCommand, setAiMode } from '@/app/actions';

export interface ReviewView {
  id: number; cycle_key: string | null; created_at: string; source: 'rules' | 'ai'; assessment: string | null; summary: string | null;
  changes: { key: TuningKey; from: number; to: number; reason: string }[]; applied: boolean;
  phase_advance: { recommend: boolean; reason: string } | null; alerts: string[]; error: string | null;
}

const ASSESS: Record<string, { label: string; appearance: 'success' | 'moved' | 'removed' }> = {
  on_track: { label: 'On track', appearance: 'success' },
  watch: { label: 'Watch', appearance: 'moved' },
  off_track: { label: 'Off track', appearance: 'removed' },
};

/**
 * Nova — the AI agronomist. Rovo UI rules: one Rovo-appearance button in this region, and
 * the generative border only while a review is actually being generated.
 */
export function NovaPanel({ roomId, aiMode, reviews, generating, aiConfigured }: {
  roomId: string; aiMode: 'off' | 'suggest' | 'apply'; reviews: ReviewView[]; generating: boolean; aiConfigured: boolean;
}) {
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(false);
  const busy = generating || requested && pending;
  const ai = reviews.filter((r) => r.source === 'ai');
  const latest = ai[0];
  const rules = reviews.filter((r) => r.source === 'rules').slice(0, 3);

  const body = (
    <div className="stack gap-150">
      <div className="row gap-100">
        <span className="nova-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span style={{ font: 'var(--ds-font-heading-small)' }} className="grow">Nova review</span>
        <div className="segmented" role="group" aria-label="AI mode">
          {(['off', 'suggest', 'apply'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={aiMode === m} onClick={() => start(async () => { await setAiMode(roomId, m); })}>
              {m === 'off' ? 'Off' : m === 'suggest' ? 'Suggest' : 'Auto'}
            </button>
          ))}
        </div>
      </div>

      {busy ? (
        <div className="subtle">Reviewing the last cycle against the phase targets…</div>
      ) : latest ? (
        <ReviewBody r={latest} roomId={roomId} />
      ) : (
        <div className="subtle small">
          Nova reviews each cycle once its overnight dry-back is measured (at the next morning&apos;s first shot), then tunes tomorrow&apos;s irrigation within hard limits.
        </div>
      )}

      <div className="row gap-100">
        <Button appearance="rovo" iconBefore={AiSparkleIcon} isDisabled={aiMode === 'off' || !aiConfigured || busy}
          onClick={() => { setRequested(true); start(async () => { await sendCommand(roomId, 'run_review'); }); }}>
          Review last cycle
        </Button>
        {!aiConfigured && <span className="small muted">Nova needs an AI key on the controller (OPENAI_API_KEY as a Fly secret).</span>}
      </div>

      {rules.length > 0 && (
        <div className="stack gap-075">
          <span className="eyebrow">Rule engine</span>
          {rules.map((r) => (
            <div key={r.id} className="small subtle">{r.cycle_key}: {r.changes.map((c) => `${TUNING_LABELS[c.key]} ${c.from} → ${c.to}`).join('; ')}</div>
          ))}
        </div>
      )}

      {ai.length > 1 && (
        <details>
          <summary className="small subtle" style={{ cursor: 'pointer' }}>Earlier reviews ({ai.length - 1})</summary>
          {ai.slice(1).map((r) => <div key={r.id} className="review"><ReviewBody r={r} roomId={roomId} compact /></div>)}
        </details>
      )}
    </div>
  );

  return busy ? (
    <div className="gen-border" aria-busy="true"><div className="gen-inner">{body}</div></div>
  ) : (
    <div className="nova-panel">{body}</div>
  );
}

function ReviewBody({ r, roomId, compact }: { r: ReviewView; roomId: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  if (r.error) return <div className="small" style={{ color: 'var(--ds-text-warning)' }}>{r.cycle_key}: review failed — {r.error}</div>;
  const a = ASSESS[r.assessment ?? 'watch'] ?? ASSESS.watch;
  return (
    <div className="stack gap-100">
      <div className="row gap-100 small">
        <Lozenge appearance={a.appearance}>{a.label}</Lozenge>
        <span className="muted">Cycle {r.cycle_key}</span>
      </div>
      <p style={{ margin: 0 }}>{r.summary}</p>
      {!compact && r.changes.length > 0 && (
        <div className="stack gap-050">
          {r.changes.map((c, i) => (
            <div key={i} className="change">
              <b>{TUNING_LABELS[c.key]}</b> <span className="num">{c.from} → {c.to}</span>
              <div className="muted">{c.reason}</div>
            </div>
          ))}
          <div className="row gap-100">
            {r.applied ? <Lozenge appearance="success">Applied</Lozenge> : (
              <Button spacing="compact" isLoading={pending} onClick={() => start(async () => { await applySuggestion(roomId, r.id); })}>Apply suggestion</Button>
            )}
          </div>
        </div>
      )}
      {!compact && r.phase_advance?.recommend && <div className="small" style={{ color: 'var(--ds-text-discovery)' }}>Phase change suggested: {r.phase_advance.reason}</div>}
      {!compact && r.alerts.map((al, i) => <div key={i} className="small" style={{ color: 'var(--ds-text-warning)' }}>⚠ {al}</div>)}
    </div>
  );
}
