'use client';

import { usePathname } from 'next/navigation';

/** Wall-panel routes (/rooms/:id/panel) render full-bleed, without the app chrome. */
export function Providers({ chrome, children }: { chrome: React.ReactNode; children: React.ReactNode }) {
  const panel = /\/panel(\/|$)/.test(usePathname() ?? '');
  if (panel) return <>{children}</>;
  return <>{chrome}<main className="page">{children}</main></>;
}
