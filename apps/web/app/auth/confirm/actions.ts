'use server';

import { redirect } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/auth';

const TYPES: EmailOtpType[] = ['signup', 'email', 'magiclink', 'recovery', 'invite', 'email_change'];

/** Verifies an emailed token_hash. Runs only on a button press, so mail scanners that pre-open links can't spend it. */
export async function confirmEmail(form: FormData): Promise<{ error: string } | void> {
  const tokenHash = String(form.get('token_hash') ?? '');
  const type = String(form.get('type') ?? '') as EmailOtpType;
  const next = String(form.get('next') ?? '/');
  if (!tokenHash || !TYPES.includes(type)) return { error: 'This link is incomplete. Request a new email.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return { error: /expired|invalid/i.test(error.message) ? 'This link has expired or was already used. Request a new email from the sign-in page.' : error.message };
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}
