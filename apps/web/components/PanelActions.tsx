'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { sendCommand, setPaused } from '@/app/actions';

/** Two large touch targets for a wall panel. All valves off asks once before sending. */
export function PanelActions({ roomId, paused, mode }: { roomId: string; paused: boolean; mode: string }) {
  const [pending, start] = useTransition();
  const [arm, setArm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (mode === 'off') return null;
  return (
    <>
      {msg && <span className="small subtle" role="status">{msg}</span>}
      <Button isDisabled={pending} onClick={() => start(async () => { const r = await setPaused(roomId, !paused); setMsg(r.ok ? (paused ? 'Resumed' : 'Paused') : r.error ?? 'Failed'); })}>
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button appearance="danger" isDisabled={pending}
        onClick={() => {
          if (!arm) { setArm(true); setTimeout(() => setArm(false), 5000); return; }
          setArm(false);
          start(async () => { const r = await sendCommand(roomId, 'all_off'); setMsg(r.ok ? 'All valves off sent' : r.error ?? 'Failed'); });
        }}>
        {arm ? 'Tap again to confirm' : 'All valves off'}
      </Button>
    </>
  );
}
