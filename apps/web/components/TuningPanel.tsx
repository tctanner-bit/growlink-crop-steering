'use client';

import { Button, Textfield } from '@/components/ui';
import { useState, useTransition } from 'react';
import { PhaseId, Tuning, TuningKey, TUNING_LABELS, tuningBounds, defaultTuning } from '@gl-steering/core';
import { saveTuning, resetTuning, ActionResult } from '@/app/actions';

const ORDER: TuningKey[] = ['p2TriggerPct', 'p2ShotPct', 'p1ShotPct', 'stopBeforeLightsOffHours', 'startDelayHours', 'p2IntervalMin', 'p1IntervalMin', 'maxShotsPerDay'];

export function TuningPanel({ roomId, phase, tuning }: { roomId: string; phase: PhaseId; tuning: Tuning }) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const bounds = tuningBounds(phase);
  const defs = defaultTuning(phase);

  return (
    <div className="stack gap-150">
      <table className="data">
        <thead><tr><th>Parameter</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Default</th></tr></thead>
        <tbody>
          {ORDER.map((k) => (
            <tr key={k}>
              <td>{TUNING_LABELS[k]}<div className="muted" style={{ fontSize: 11 }}>{bounds[k].min}–{bounds[k].max}</div></td>
              <td style={{ textAlign: 'right', width: 110 }}>
                {edit ? (
                  <Textfield isCompact type="number" step="any" aria-label={TUNING_LABELS[k]} defaultValue={String(tuning[k])}
                    onChange={(e) => setVals((v) => ({ ...v, [k]: (e.target as HTMLInputElement).value }))} />
                ) : (
                  <b className="num" style={{ color: tuning[k] !== defs[k] ? 'var(--ds-text-information)' : undefined }}>{tuning[k]}</b>
                )}
              </td>
              <td style={{ textAlign: 'right' }} className="muted num">{defs[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap-100">
        {edit ? (
          <>
            <Button appearance="primary" isLoading={pending} onClick={() => start(async () => {
              const values = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v)));
              const r = await saveTuning(roomId, values);
              setMsg(r); if (r.ok) { setEdit(false); setVals({}); }
            })}>Save</Button>
            <Button appearance="subtle" onClick={() => { setEdit(false); setVals({}); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEdit(true)}>Edit</Button>
            <Button appearance="subtle" isDisabled={pending} onClick={() => start(async () => setMsg(await resetTuning(roomId)))}>Reset to defaults</Button>
          </>
        )}
      </div>
      {msg && <div className="small" style={{ color: msg.ok ? 'var(--ds-text-success)' : 'var(--ds-text-danger)' }}>{msg.ok ? msg.message : msg.error}</div>}
      <div className="small muted">Highlighted values have moved off the phase default. Values outside the bounds are clamped.</div>
    </div>
  );
}
