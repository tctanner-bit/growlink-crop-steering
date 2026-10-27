import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Refreshes the Supabase session cookie and gates the app behind sign-in. */
export async function proxy(req: NextRequest) {
  if (process.env.DEV_AUTH_BYPASS === '1' || !process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const open = req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/auth');
  if (!data.user && !open) return NextResponse.redirect(new URL('/login', req.url));
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|svg|jpg|jpeg|webp|ico)$).*)'] };
