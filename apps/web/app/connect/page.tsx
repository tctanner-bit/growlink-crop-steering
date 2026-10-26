import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { Heading } from '@/components/ak';
import { ConnectWizard } from '@/components/ConnectWizard';

export default async function ConnectPage() {
  await requireUser();
  return (
    <div className="stack gap-300" style={{ maxWidth: 640 }}>
      <div className="stack gap-100">
        <Link href="/" className="small">← Rooms</Link>
        <Heading size="xlarge">Connect Growlink</Heading>
        <p className="subtle">
          Paste an API key from the Growlink portal (Builder → Authentication). The key grants control of real hardware: it is
          encrypted with AES-256-GCM before it is stored and is never sent back to your browser.
        </p>
      </div>
      <ConnectWizard />
    </div>
  );
}
