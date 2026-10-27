'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, SectionMessage } from '@/components/ui';
import { confirmEmail } from './actions';

export function ConfirmButton({ tokenHash, type, next, cta }: { tokenHash: string; type: string; next: string; cta: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card stack gap-200" action={(fd) => start(async () => { const r = await confirmEmail(fd); if (r?.error) setError(r.error); })}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      {error && <SectionMessage appearance="error">{error} <Link href="/login">Back to sign in</Link></SectionMessage>}
      <Button type="submit" appearance="primary" isLoading={pending} isDisabled={!tokenHash}>{cta}</Button>
    </form>
  );
}
