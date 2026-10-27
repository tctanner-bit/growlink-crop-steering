import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from '@/components/Providers';
import { ThemeToggle } from '@/components/ThemeToggle';
import { currentUser } from '@/lib/auth';
import { controllerHealth } from '@/lib/data';
import { ControllerBadge } from '@/components/ControllerBadge';

export const metadata: Metadata = {
  title: 'Rock Wool Crop Steering — Growlink',
  description: 'Growlink rock wool crop steering with AI.',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#08090a' }, { media: '(prefers-color-scheme: light)', color: '#f3f3f1' }],
};

export const dynamic = 'force-dynamic';

// Applies the saved theme before first paint (no flash). ?theme=light|dark wins, for wall panels.
const THEME_INIT = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('gl-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const health = user ? await controllerHealth().catch(() => null) : null;
  const chrome = (
    <>
      <div className="labs-strip" role="note">
        <strong>Growlink Labs experiment</strong> · Use caution before giving it control of real valves · <span className="labs-stage">Labs → Beta → General release</span>
      </div>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="Growlink Labs — Rock Wool Crop Steering, home">
            <span className="brand-logo" aria-hidden="true" />
            <span className="labs-tag">LABS</span>
            <span className="brand-app">Rock Wool Crop Steering</span>
          </Link>
          {user && (
            <nav className="topnav" aria-label="Main">
              <Link href="/">Rooms</Link>
              <Link href="/connect">Add connection</Link>
            </nav>
          )}
          <div className="topbar-right">
            {user && <ControllerBadge health={health} />}
            <ThemeToggle />
            {user && <span className="user-chip" title={user.email ?? ''} aria-label={`Signed in as ${user.email}`}>{(user.email ?? '?').slice(0, 1).toUpperCase()}</span>}
          </div>
        </div>
      </header>
    </>
  );
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" />
      </head>
      <body>
        <Providers chrome={chrome}>{children}</Providers>
      </body>
    </html>
  );
}
