'use client';

import Modal, { Button, Textfield, SectionMessage, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@/components/ui';
import { useState, useTransition } from 'react';
import { PHASES, PHASE_ORDER, PhaseId } from '@gl-steering/core';
import { setPhase } from '@/app/actions';

export function PhaseControl({ roomId, phase, dayInPhase, today }: { roomId: string; phase: PhaseId; dayInPhase: number; today: string }) {
  const [target, setTarget] = useState<PhaseId | null>(null);
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const p = PHASES[phase];
  const overdue = dayInPhase > p.durationDays.max;
  const open = (id: PhaseId) => { setErr(null); setDate(today); setTarget(id); };
  const pct = (id: PhaseId) => id < phase ? 100 : id === phase ? Math.min(100, Math.round((dayInPhase / p.durationDays.max) * 100)) : 0;
  return (
    <div className="stack gap-100">
      <ol className="phase-steps" aria-label="Crop phases">
        {PHASE_ORDER.map((id) => {
          const state = id < phase ? 'done' : id === phase ? 'current' : 'next';
          return (
            <li key={id} data-state={state}>
              <button type="button" disabled={id === phase} aria-current={id === phase ? 'step' : undefined}
                onClick={() => open(id)} title={id === phase ? 'Current phase' : `Move to phase ${id}`}>
                <span className="phase-bar"><span style={{ width: `${pct(id)}%` }} /></span>
                <span className="phase-label">{id} · {PHASES[id].shortName}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="row gap-100 small subtle wrap">
        <span>Day {dayInPhase} of {p.durationDays.min === p.durationDays.max ? p.durationDays.max : `${p.durationDays.min}–${p.durationDays.max}`} · {p.objective}</span>
        <span className="grow" />
        {phase < 5 && (
          <Button spacing="compact" appearance={overdue ? 'primary' : 'default'} onClick={() => open((phase + 1) as PhaseId)}>
            Advance to phase {phase + 1}
          </Button>
        )}
      </div>
      <ModalTransition>
        {target && (
          <Modal onClose={() => setTarget(null)}>
            <ModalHeader><ModalTitle>Move to phase {target} — {PHASES[target].name}</ModalTitle></ModalHeader>
            <ModalBody>
              <div className="stack gap-150">
                <p>{PHASES[target].objective}</p>
                <p className="small subtle">Tuning resets to phase {target} defaults. Calibration (shot response, dry-back rates) carries over.</p>
                <div className="field">
                  <span className="field-label">Phase start date</span>
                  <Textfield type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
                </div>
                {err && <SectionMessage appearance="error">{err}</SectionMessage>}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setTarget(null)}>Cancel</Button>
              <Button appearance="primary" isLoading={pending} onClick={() => start(async () => {
                const r = await setPhase(roomId, target, date);
                if (r.ok) setTarget(null); else setErr(r.error);
              })}>Set phase</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  );
}
