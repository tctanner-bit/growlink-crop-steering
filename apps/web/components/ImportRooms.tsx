'use client';

import { Button, Heading, Lozenge } from '@/components/ui';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importRooms, ActionResult } from '@/app/actions';

export function ImportRooms({ connectionId, rooms }: { connectionId: string; rooms: { id: string; name: string; type: string; imported: boolean }[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="card stack gap-200">
      <Heading size="small" as="h2">Rooms in this organization</Heading>
      <div className="checklist">
        {rooms.length === 0 && <span className="small muted">No production rooms found.</span>}
        {rooms.map((r) => (
          <label key={r.id} className="check" style={r.imported ? { opacity: 0.7, cursor: 'default' } : undefined}>
            <input type="checkbox" disabled={r.imported} checked={r.imported || sel.includes(r.id)}
              onChange={() => setSel((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} />
            <span>{r.name}</span>
            <span className="check-meta">{r.imported ? <Lozenge>Imported</Lozenge> : r.type}</span>
          </label>
        ))}
      </div>
      <div className="row gap-100">
        <Button appearance="primary" isDisabled={!sel.length} isLoading={pending} onClick={() => start(async () => {
          const r = await importRooms(connectionId, sel);
          setMsg(r); if (r.ok) { setSel([]); router.push('/'); }
        })}>Import {sel.length || ''} room{sel.length === 1 ? '' : 's'}</Button>
        {msg && <span className="small" style={{ color: msg.ok ? 'var(--ds-text-success)' : 'var(--ds-text-danger)' }}>{msg.ok ? msg.message : msg.error}</span>}
      </div>
    </div>
  );
}
