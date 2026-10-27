'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'gl-theme';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Theme, string> = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
}

/** Cycles system → light → dark. Stored per browser; the panel accepts ?theme= too. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try { const t = localStorage.getItem(KEY) as Theme | null; if (t === 'light' || t === 'dark') setTheme(t); } catch {}
  }, []);
  const next = () => {
    const t = NEXT[theme];
    setTheme(t); applyTheme(t);
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch {}
  };
  return (
    <button type="button" className="theme-btn" onClick={next} aria-label={`${LABEL[theme]}. Change theme`} title={LABEL[theme]}>
      {theme === 'light' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : theme === 'dark' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
