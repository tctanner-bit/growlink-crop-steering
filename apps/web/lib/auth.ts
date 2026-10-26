import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';

export const DEV_USER_ID = '00000000-0000-4000-8000-00000000d3a0';
export const devBypass = () => process.env.DEV_AUTH_BYPASS === '1';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component */ }
      },
    },
  });
}

export interface SessionUser { id: string; email: string }

export async function currentUser(): Promise<SessionUser | null> {
  if (devBypass()) return { id: DEV_USER_ID, email: 'grower@demo.local' };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? '' } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}
