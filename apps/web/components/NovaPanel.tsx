'use client';

import { useState, useTransition } from 'react';
import { Button, Lozenge, NovaMark, Segmented } from '@/components/ui';
import { TUNING_LABELS, TuningKey } from '@gl-steering/core';
import { applySuggestion, sendCommand, setAiMode } from '@/app/actions';

export interface ReviewView {
  id: number; cycle_key: string | null; created_at: string; source: 'rules' | 'ai'; assessment: string | null; summary: string | null;
  changes: { key: TuningKey; from: number; to: number; reason: string }[]; applied: boolean;
  phase_advance: { recommend: boolean; reason: string } | null; alerts: string[]; error: string | null;
}

const ASSESS: Record<string, { label: string; cls: string }> = {
  on_track: { label: 'On track', cls: 'ok-text' },
  watch: { label: 'Watch', cls: 'warn-text' },
  off_track: { label: 'Off track', cls: 'danger-text' },
};

const MODES = [{ id: 'off', label: 'Off' }, { id: 'suggest', label: 'Suggest' }, { id: 'apply', label: 'Auto' }] as const;

/** Nova — one plain sentence, the changes behind it, one action. Accent border only while generating. */
export function NovaPanel({ roomId, aiMode, reviews, generating, aiConfigured }: {
  roomId: string; aiMode: 'off' | 'suggest' | 'apply'; reviews: ReviewView[]; generating: boolean; aiConfigured: boolean;
}) {
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(false);
  const busy = generating || (requested && pending);
  const ai = reviews.filter((r) => r.source === 'ai');
  const latest = ai[0];
  const rules = reviews.filter((r) => r.source === 'rules').slice(0, 3);

  const body = (
    <div className="stack gap-200">
      <div className="nova-head">
        <NovaMark />
        <span className="eyebrow grow">Nova{latest?.cycle_key ? ` · cycle ${latest.cycle_key}` : ''}</span>
        {latest && !latest.error && !busy && (
          <span className={`small ${ASSESS[latest.assessment ?? 'watch']?.cls ?? ''}`}>{ASSESS[latest.assessment ?? 'watch']?.label}</span>
        )}
      </div>

      {busy ? (
        <p className="nova-summary subtle">Reviewing the last cycle against the phase targets…</p>
      ) : latest ? (
        <ReviewBody r={latest} roomId={roomId} />
      ) : (
        <p className="nova-summary subtle">Nova reviews each cycle once last night&apos;s dry-back is measured, then tunes tomorrow within hard limits.</p>
      )}

      <div className="row gap-150 wrap">
        <Segmented label="Nova mode" value={aiMode} options={MODES as any} onChange={(m) => start(async () => { await setAiMode(roomId, m as any); })} />
        <span className="grow" />
        <Button appearance="subtle" isDisabled={aiMode === 'off' || !aiConfigured || busy}
          onClick={() => { setRequested(true); start(async () => { await sendCommand(roomId, 'run_review'); }); }}>
          Review now
        </Button>
      </div>
      <div className="small muted">
        {!aiConfigured ? 'Nova needs an AI key on the controller (OPENAI_API_KEY as a Fly secret).'
          : aiMode === 'apply' ? 'Auto: Nova applies its changes each morning, within hard limits.'
          : aiMode === 'suggest' ? 'Suggest: nothing changes until you apply it.'
          : 'Off: only the nightly rules adjust this room.'}
      </div>

      {rules.length > 0 && (
        <div className="stack gap-075">
          <span className="eyebrow">Nightly rules</span>
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
    <section className="nova-panel" aria-label="Nova review">{body}</section>
  );
}

function ReviewBody({ r, roomId, compact }: { r: ReviewView; roomId: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  if (r.error) return <p className="small warn-text">{r.cycle_key}: review failed — {r.error}</p>;
  if (compact) {
    const a = ASSESS[r.assessment ?? 'watch'] ?? ASSESS.watch;
    return <div className="stack gap-050"><span className={`small ${a.cls}`}>{r.cycle_key} · {a.label}</span><p className="small subtle">{r.summary}</p></div>;
  }
  return (
    <div className="stack gap-200">
      <p className="nova-summary">{r.summary}</p>
      {r.phase_advance?.recommend && <p className="small accent-text">Phase change suggested: {r.phase_advance.reason}</p>}
      {r.alerts.map((al, i) => <p key={i} className="small warn-text">Check: {al}</p>)}
      {r.changes.length > 0 && (
        <>
          <div className="row gap-100 wrap">
            {r.applied ? <Lozenge appearance="success">Applied</Lozenge> : (
              <Button appearance="primary" isLoading={pending} onClick={() => start(async () => { await applySuggestion(roomId, r.id); })}>
                Apply {r.changes.length === 1 ? 'change' : `${r.changes.length} changes`}
              </Button>
            )}
            <Button appearance="default" onClick={() => setOpen((o) => !o)}>{open ? 'Hide reasoning' : 'See reasoning'}</Button>
          </div>
          {open && (
            <div className="stack gap-075">
              {r.changes.map((c, i) => (
                <div key={i} className="change">
                  <span><b>{TUNING_LABELS[c.key]}</b> <span className="num subtle">{c.from} → {c.to}</span></span>
                  <span className="muted">{c.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
