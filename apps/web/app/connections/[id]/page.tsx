import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getConnection, listRooms } from '@/lib/data';
import { apiForConnection } from '@/lib/growlink';
import { Heading, SectionMessage, Lozenge } from '@/components/ui';
import { ImportRooms } from '@/components/ImportRooms';
import { DeleteConnectionButton } from '@/components/DeleteRoomButton';

const ROOM_TYPE = ['Production', 'Non-production', 'Fertigation'];

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const conn = await getConnection(user.id, id);
  if (!conn) notFound();
  const imported = (await listRooms(user.id)).filter((r) => r.connection_id === conn.id);

  let glRooms: { id: string; name: string; roomType: number }[] = [];
  let error: string | null = null;
  try { glRooms = await apiForConnection(conn).listRooms(conn.org_id); } catch (e: any) { error = e?.message ?? 'Could not list rooms.'; }
  const importedIds = new Set(imported.map((r) => r.gl_room_id.toLowerCase()));

  return (
    <div className="stack gap-300" style={{ maxWidth: 760 }}>
      <div className="stack gap-100">
        <Link href="/" className="small">← Rooms</Link>
        <div className="row gap-150">
          <Heading size="xlarge">{conn.label}</Heading>
          {conn.kind === 'demo' && <Lozenge appearance="new">Simulated</Lozenge>}
        </div>
        <span className="subtle">{conn.org_name}{conn.key_last4 ? ` · key ••••${conn.key_last4}` : ''}</span>
      </div>
      {error && <SectionMessage appearance="error" title="Growlink API">{error}</SectionMessage>}
      <ImportRooms
        connectionId={conn.id}
        rooms={glRooms.filter((r) => r.roomType !== 2).map((r) => ({ id: r.id, name: r.name, type: ROOM_TYPE[r.roomType] ?? '', imported: importedIds.has(r.id.toLowerCase()) }))}
      />
      <div className="card-flat row gap-200 spread wrap">
        <div className="stack"><b>Remove connection</b><span className="small subtle">Deletes the stored key and every room on it.</span></div>
        <DeleteConnectionButton connectionId={conn.id} />
      </div>
    </div>
  );
}
