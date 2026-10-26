'use client';

import { useState, useTransition } from 'react';
import Button from '@atlaskit/button/new';
import Toggle from '@atlaskit/toggle';
import Textfield from '@atlaskit/textfield';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import SectionMessage from '@atlaskit/section-message';
import { setMode, setPaused, sendCommand, ActionResult } from '@/app/actions';
import type { Mode } from '@/lib/data';

const MODES: { id: Mode; label: string; help: string }[] = [
  { id: 'off', label: 'Off', help: 'Autopilot idle.' },
  { id: 'shadow', label: 'Shadow', help: 'Reads real sensors and logs what it would do. Your Growlink program keeps irrigating.' },
  { id: 'simulate', label: 'Simulate', help: 'Steers a simulated block mapped to this room. No real valves move.' },
  { id: 'live', label: 'Live', help: 'Autopilot controls the mapped valves.' },
];

export function RoomControls(props: { roomId: string; mode: Mode; paused: boolean; isDemo: boolean; valveCount: number; maxShotSeconds: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [ack, setAck] = useState('');
  const [testSecs, setTestSecs] = useState('10');

  const run = (fn: () => Promise<ActionResult>) => start(async () => setMsg(await fn()));
  const choose = (m: Mode) => {
    if (m === 'live') { setAck(''); setConfirmLive(true); return; }
    run(() => setMode(props.roomId, m));
  };
  const modes = props.isDemo ? MODES.filter((m) => m.id !== 'live' && m.id !== 'shadow') : MODES;
  const current = MODES.find((m) => m.id === props.mode)!;

  return (
    <div className="stack gap-150">
      <div className="row gap-200 wrap">
        <div className="segmented" role="group" aria-label="Autopilot mode">
          {modes.map((m) => (
            <button key={m.id} type="button" aria-pressed={props.mode === m.id} data-live={m.id === 'live'} disabled={pending} onClick={() => choose(m.id)}>{m.label}</button>
          ))}
        </div>
        <label className="row gap-050 small subtle">
          <Toggle isChecked={props.paused} isDisabled={pending || props.mode === 'off'} onChange={() => run(() => setPaused(props.roomId, !props.paused))} label="Pause" />
          Pause
        </label>
        <span className="grow" />
        {(props.mode === 'live' || props.mode === 'simulate') && (
          <div className="row gap-050">
            <div style={{ width: 72 }}>
              <Textfield aria-label="Test shot seconds" isCompact type="number" min={1} max={props.maxShotSeconds} value={testSecs} onChange={(e) => setTestSecs((e.target as HTMLInputElement).value)} elemAfterInput={<span className="small muted" style={{ paddingRight: 8 }}>s</span>} />
            </div>
            <Button isDisabled={pending} onClick={() => run(() => sendCommand(props.roomId, 'test_shot', { seconds: Number(testSecs) }))}>Test shot</Button>
          </div>
        )}
        {props.mode !== 'off' && (
          <Button appearance="danger" isDisabled={pending} onClick={() => run(() => sendCommand(props.roomId, 'all_off'))}>All valves off</Button>
        )}
      </div>
      <div className="small subtle">{current.help}{props.paused ? ' Paused — no shots will fire.' : ''}</div>
      {msg && !msg.ok && <SectionMessage appearance="error">{msg.error}</SectionMessage>}
      {msg && msg.ok && msg.message && <div className="small" style={{ color: 'var(--ds-text-success)' }}>{msg.message}</div>}

      <ModalTransition>
        {confirmLive && (
          <Modal onClose={() => setConfirmLive(false)} width="medium">
            <ModalHeader><ModalTitle appearance="warning">Hand valve control to the autopilot</ModalTitle></ModalHeader>
            <ModalBody>
              <div className="stack gap-150">
                <p>The autopilot will force {props.valveCount} valve{props.valveCount === 1 ? '' : 's'} ON and OFF to steer this room. While Live:</p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Valves rest in forced OFF between shots, overriding Growlink irrigation programs on them.</li>
                  <li>Every shot is capped and closed by a watchdog, even if the controller restarts.</li>
                  <li>Leaving Live hands the valves back to Growlink automation (AUTO).</li>
                </ul>
                <p>Run in Shadow first and confirm the decisions match what you would do.</p>
                <Textfield placeholder="Type LIVE to confirm" value={ack} onChange={(e) => setAck((e.target as HTMLInputElement).value)} autoFocus />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirmLive(false)}>Cancel</Button>
              <Button appearance="warning" isDisabled={ack.trim().toUpperCase() !== 'LIVE' || pending}
                onClick={() => { setConfirmLive(false); run(() => setMode(props.roomId, 'live', true)); }}>Go live</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  );
}
