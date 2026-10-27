'use client';

import { Button, Textfield, SectionMessage } from '@/components/ui';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return <SectionMessage appearance="warning">Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or DEV_AUTH_BYPASS=1 for local development.</SectionMessage>;
  const sb = createBrowserClient(url, key);

  return (
    <form className="card stack gap-200" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setMsg(null);
        if (mode === 'in') {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) setMsg({ ok: false, text: error.message }); else { router.replace('/'); router.refresh(); }
        } else {
          const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
          setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Check your email to confirm your account.' });
        }
      });
    }}>
      <div className="field"><span className="field-label">Email</span><Textfield type="email" autoComplete="email" value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
      <div className="field"><span className="field-label">Password</span><Textfield type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword((e.target as HTMLInputElement).value)} /></div>
      {msg && <SectionMessage appearance={msg.ok ? 'success' : 'error'}>{msg.text}</SectionMessage>}
      <div className="row gap-100">
        <Button type="submit" appearance="primary" isLoading={pending}>{mode === 'in' ? 'Sign in' : 'Create account'}</Button>
        <Button appearance="subtle" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Create an account' : 'I have an account'}</Button>
      </div>
    </form>
  );
}
