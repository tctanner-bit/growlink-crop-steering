import { PHASES, PhaseId, Range } from '@gl-steering/core';

export const MODE_LABEL = { off: 'Off', shadow: 'Shadow', simulate: 'Simulate', live: 'Live' } as const;
export const MODE_APPEARANCE = { off: 'default', shadow: 'moved', simulate: 'new', live: 'success' } as const;
export const PERIOD_LABEL: Record<string, string> = { night: 'Night', P1: 'P1 · ramp', P2: 'P2 · maintain', P3: 'P3 · dry-back' };

export const phaseLabel = (p: PhaseId) => `Phase ${p} · ${PHASES[p].shortName}`;
export const fmtRange = (r: Range, unit = '') => `${r.min}–${r.max}${unit}`;
export const fmt = (v: number | null | undefined, digits = 1, unit = '') => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}${unit}`);

export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
}

export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
