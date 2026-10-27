'use client';

import { useState, useTransition } from 'react';
import Modal, { Button, Textfield, SectionMessage, Segmented, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@/components/ui';
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
  const [labsAck, setLabsAck] = useState(false);
  const [testSecs, setTestSecs] = useState('10');

  const run = (fn: () => Promise<ActionResult>) => start(async () => setMsg(await fn()));
  const choose = (m: Mode) => {
    if (m === props.mode) return;
    if (m === 'live') { setAck(''); setLabsAck(false); setConfirmLive(true); return; }
    run(() => setMode(props.roomId, m));
  };
  const modes = props.isDemo ? MODES.filter((m) => m.id !== 'live' && m.id !== 'shadow') : MODES;
  const current = MODES.find((m) => m.id === props.mode)!;
  const canShoot = props.mode === 'live' || props.mode === 'simulate';

  return (
    <section className="control-card" aria-label="Autopilot control">
      <span className="eyebrow">Control</span>
      <div className="gl-seg gl-seg--fill" role="group" aria-label="Autopilot mode">
        {modes.map((m) => (
          <button key={m.id} type="button" aria-pressed={props.mode === m.id} disabled={pending} onClick={() => choose(m.id)}>{m.label}</button>
        ))}
      </div>
      <p className="small muted">{current.help}{props.paused ? ' Paused — no shots will fire.' : ''}</p>

      <div className="control-row">
        <Button isDisabled={pending || props.mode === 'off'} onClick={() => run(() => setPaused(props.roomId, !props.paused))}>
          {props.paused ? 'Resume' : 'Pause'}
        </Button>
        {canShoot && (
          <Button isDisabled={pending} onClick={() => run(() => sendCommand(props.roomId, 'test_shot', { seconds: Number(testSecs) }))}>Test shot</Button>
        )}
      </div>
      {canShoot && (
        <label className="row gap-150 small subtle">
          Test shot length
          <span style={{ width: 96 }}>
            <Textfield aria-label="Test shot seconds" isCompact type="number" min={1} max={props.maxShotSeconds} value={testSecs}
              onChange={(e) => setTestSecs((e.target as HTMLInputElement).value)} elemAfterInput="s" />
          </span>
        </label>
      )}
      {props.mode !== 'off' && (
        <Button appearance="danger" isDisabled={pending} onClick={() => run(() => sendCommand(props.roomId, 'all_off'))}>All valves off</Button>
      )}

      {msg && !msg.ok && <SectionMessage appearance="error">{msg.error}</SectionMessage>}
      {msg && msg.ok && msg.message && <p className="small ok-text">{msg.message}</p>}

      <ModalTransition>
        {confirmLive && (
          <Modal onClose={() => setConfirmLive(false)} width="medium">
            <ModalHeader><ModalTitle appearance="warning">Hand valve control to the autopilot</ModalTitle></ModalHeader>
            <ModalBody>
              <SectionMessage appearance="warning" title="Growlink Labs experiment">
                <p>This app is experimental. It has not completed Beta testing and is not covered by Growlink support. Software can fail: a missed OFF, a bad sensor or a network outage can over- or under-water a whole room.</p>
                <p>Watch this room closely, keep your own irrigation backup ready, and start with one room you can afford to lose.</p>
              </SectionMessage>
              <p>The autopilot will force {props.valveCount} valve{props.valveCount === 1 ? '' : 's'} ON and OFF to steer this room. While Live:</p>
              <ul>
                <li>Valves rest in forced OFF between shots, overriding Growlink irrigation programs on them.</li>
                <li>Every shot is capped and closed by a watchdog, even if the controller restarts.</li>
                <li>Leaving Live hands the valves back to Growlink automation (AUTO).</li>
              </ul>
              <p>Run in Shadow first and confirm the decisions match what you would do.</p>
              <label className="labs-ack">
                <input type="checkbox" checked={labsAck} onChange={(e) => setLabsAck(e.target.checked)} />
                <span>I understand this is a Growlink Labs experiment and I am responsible for monitoring this room while it controls real valves.</span>
              </label>
              <Textfield placeholder="Type LIVE to confirm" aria-label="Type LIVE to confirm" value={ack} onChange={(e) => setAck((e.target as HTMLInputElement).value)} />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirmLive(false)}>Cancel</Button>
              <Button appearance="primary" isDisabled={!labsAck || ack.trim().toUpperCase() !== 'LIVE' || pending}
                onClick={() => { setConfirmLive(false); run(() => setMode(props.roomId, 'live', true)); }}>Go live</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </section>
  );
}
