import type { Metadata } from 'next';
import Link from 'next/link';
import getThemeHtmlAttrs from '@atlaskit/tokens/get-theme-html-attrs';
import getThemeStyles from '@atlaskit/tokens/get-theme-styles';
import getSSRAutoScript from '@atlaskit/tokens/get-ssr-auto-script';
import '@atlaskit/css-reset';
import './globals.css';
import { Providers } from '@/components/Providers';
import { currentUser } from '@/lib/auth';
import { controllerHealth } from '@/lib/data';
import { ControllerBadge } from '@/components/ControllerBadge';

export const metadata: Metadata = {
  title: 'Crop Steering Autopilot — Growlink',
  description: 'Grodan 5-Phase crop steering with AI, on the Growlink Developer API.',
  icons: { icon: '/icon.svg' },
};

export const dynamic = 'force-dynamic';

const THEME = { colorMode: 'auto', light: 'light', dark: 'dark', spacing: 'spacing', typography: 'typography', shape: 'shape' } as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [themeStyles, user] = await Promise.all([getThemeStyles(THEME as any), currentUser()]);
  const health = user ? await controllerHealth().catch(() => null) : null;
  const attrs = getThemeHtmlAttrs(THEME as any);
  const ssrAuto = getSSRAutoScript('auto');
  return (
    <html lang="en" {...attrs} suppressHydrationWarning>
      <head>
        {ssrAuto && <script dangerouslySetInnerHTML={{ __html: ssrAuto }} />}
        {themeStyles.map((t: { id: string; attrs: Record<string, string>; css: string }) => (
          <style key={t.id} {...t.attrs} dangerouslySetInnerHTML={{ __html: t.css }} />
        ))}
      </head>
      <body>
        <Providers>
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 21c-4.5-2.5-7-6-7-10.5C5 7 8 4 12 3c4 1 7 4 7 7.5C19 15 16.5 18.5 12 21z" fill="var(--ds-icon-success)" />
                  <path d="M12 20V8" stroke="var(--ds-surface)" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="brand-name">Crop Steering</span>
                <span className="brand-sub">Growlink</span>
              </Link>
              {user && (
                <nav className="topnav">
                  <Link href="/">Rooms</Link>
                  <Link href="/connect">Add connection</Link>
                </nav>
              )}
              <div className="topbar-right">
                {user && <ControllerBadge health={health} />}
                {user && <span className="user-email">{user.email}</span>}
              </div>
            </div>
          </header>
          <main className="page">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
