'use client';

import { Button, Textfield, SectionMessage } from '@/components/ui';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

type Mode = 'in' | 'up' | 'reset';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('in');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return <SectionMessage appearance="warning">Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or DEV_AUTH_BYPASS=1 for local development.</SectionMessage>;
  const sb = createBrowserClient(url, key);
  const go = (m: Mode) => { setMode(m); setMsg(null); };

  return (
    <form className="card stack gap-200" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setMsg(null);
        if (mode === 'in') {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) setMsg({ ok: false, text: /confirm/i.test(error.message) ? 'Confirm your email first — check your inbox for the link.' : error.message });
          else { router.replace('/'); router.refresh(); }
        } else if (mode === 'up') {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
          if (error) setMsg({ ok: false, text: error.message });
          // Supabase answers an existing address with success and no email; an empty identities list gives it away.
          else if (data.user && (data.user.identities?.length ?? 0) === 0) { setMode('in'); setMsg({ ok: false, text: 'An account already exists for this email. Sign in, or use “Forgot password?”.' }); }
          else setMsg({ ok: true, text: `We sent a confirmation email to ${email}. Open it and press Confirm email. Check spam if it isn't there in a minute.` });
        } else {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
          setMsg(error ? { ok: false, text: error.message } : { ok: true, text: `If ${email} has an account, a reset link is on its way.` });
        }
      });
    }}>
      <div className="field"><span className="field-label">Email</span><Textfield type="email" autoComplete="email" required value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
      {mode !== 'reset' && (
        <div className="field"><span className="field-label">Password</span><Textfield type="password" required minLength={mode === 'up' ? 8 : undefined} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword((e.target as HTMLInputElement).value)} /></div>
      )}
      {msg && <SectionMessage appearance={msg.ok ? 'success' : 'error'}>{msg.text}</SectionMessage>}
      <div className="row gap-100 wrap">
        <Button type="submit" appearance="primary" isLoading={pending}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
        {mode === 'in' ? <Button appearance="subtle" onClick={() => go('up')}>Create an account</Button> : <Button appearance="subtle" onClick={() => go('in')}>Back to sign in</Button>}
      </div>
      {mode === 'in' && <button type="button" className="gl-btn gl-btn--subtle gl-btn--compact" style={{ alignSelf: 'flex-start' }} onClick={() => go('reset')}>Forgot password?</button>}
    </form>
  );
}
