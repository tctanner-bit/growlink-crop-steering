'use client';

import { useState, useTransition } from 'react';
import Button from '@atlaskit/button/new';
import { deleteRoom, deleteConnection } from '@/app/actions';

export function DeleteRoomButton({ roomId }: { roomId: string }) {
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="row gap-100">
      {err && <span className="small" style={{ color: 'var(--ds-text-danger)' }}>{err}</span>}
      {armed ? (
        <>
          <Button appearance="subtle" onClick={() => setArmed(false)}>Cancel</Button>
          <Button appearance="danger" isLoading={pending} onClick={() => start(async () => { const r = await deleteRoom(roomId); if (r && !r.ok) setErr(r.error); })}>Delete permanently</Button>
        </>
      ) : <Button appearance="danger" onClick={() => setArmed(true)}>Remove room</Button>}
    </div>
  );
}

export function DeleteConnectionButton({ connectionId }: { connectionId: string }) {
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="row gap-100">
      {err && <span className="small" style={{ color: 'var(--ds-text-danger)' }}>{err}</span>}
      {armed ? (
        <>
          <Button appearance="subtle" onClick={() => setArmed(false)}>Cancel</Button>
          <Button appearance="danger" isLoading={pending} onClick={() => start(async () => { const r = await deleteConnection(connectionId); if (r && !r.ok) setErr(r.error); })}>Remove connection and rooms</Button>
        </>
      ) : <Button appearance="danger" onClick={() => setArmed(true)}>Remove connection</Button>}
    </div>
  );
}
