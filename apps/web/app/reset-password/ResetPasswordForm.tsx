'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Button, Textfield, SectionMessage } from '@/components/ui';

export function ResetPasswordForm() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return (
    <form className="card stack gap-200" onSubmit={(e) => {
      e.preventDefault();
      if (pw.length < 8) return setErr('Use at least 8 characters.');
      if (pw !== pw2) return setErr('The passwords do not match.');
      start(async () => {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) setErr(error.message); else { router.replace('/'); router.refresh(); }
      });
    }}>
      <label className="field"><span className="field-label">New password</span><Textfield type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw((e.target as HTMLInputElement).value)} /></label>
      <label className="field"><span className="field-label">Repeat it</span><Textfield type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2((e.target as HTMLInputElement).value)} /></label>
      {err && <SectionMessage appearance="error">{err}</SectionMessage>}
      <Button type="submit" appearance="primary" isLoading={pending}>Save password</Button>
    </form>
  );
}
