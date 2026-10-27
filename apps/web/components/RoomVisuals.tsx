import type { Range } from '@gl-steering/core';

const R = 150, C = 180;
const pt = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return `${(C + R * Math.cos(r)).toFixed(2)} ${(C + R * Math.sin(r)).toFixed(2)}`;
};
const arc = (a: number, b: number) => `M${pt(a)} A${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${pt(b)}`;

/** A 270° dial: the value as a solid arc, the target band as a wide accent arc. */
export function Dial({ value, band, scale, label, unit = '%', digits = 1, children }: {
  value: number | null; band: Range; scale: Range; label: string; unit?: string; digits?: number; children?: React.ReactNode;
}) {
  const ang = (v: number) => 135 + ((Math.max(scale.min, Math.min(scale.max, v)) - scale.min) / (scale.max - scale.min)) * 270;
  const v = value == null ? null : ang(value);
  return (
    <div className="dial">
      <svg viewBox="0 0 360 360" role="img" aria-label={`${label} ${value == null ? 'no reading' : `${value.toFixed(digits)}${unit}`}, target ${band.min} to ${band.max}${unit}`}>
        <path d={arc(135, 405)} fill="none" stroke="var(--gl-surface-3)" strokeWidth="13" strokeLinecap="round" />
        {v != null && v > 135.5 && <path d={arc(135, v)} fill="none" stroke="var(--gl-text)" strokeWidth="13" strokeLinecap="round" />}
        <path d={arc(ang(band.min), ang(band.max))} fill="none" stroke="var(--gl-accent)" strokeOpacity="0.5" strokeWidth="25" />
        {v != null && (() => {
          const r = (v * Math.PI) / 180;
          return <circle cx={C + R * Math.cos(r)} cy={C + R * Math.sin(r)} r="9" fill="var(--gl-bg)" stroke="var(--gl-accent)" strokeWidth="4" />;
        })()}
      </svg>
      <div className="dial-center">
        <span className="eyebrow">{label}</span>
        <span className="dial-value">{value == null ? '—' : value.toFixed(digits)}<small>{unit}</small></span>
        <span className="small muted">Target {band.min}–{band.max}{unit}</span>
        {children}
      </div>
    </div>
  );
}

export interface DaySegment { id: 'wait' | 'irrigate' | 'P3' | 'night'; label: string; from: number; to: number }

/** The light cycle as one bar: wait · irrigation · dry-back · night, with a now marker. */
export function DayBar({ segments, now, active }: { segments: DaySegment[]; now: number; active: string | null }) {
  const start = segments[0]?.from ?? now, end = segments[segments.length - 1]?.to ?? now;
  const span = Math.max(1, end - start);
  const nowPct = Math.max(0, Math.min(100, ((now - start) / span) * 100));
  const isActive = (s: DaySegment) => s.id === active;
  return (
    <div className="daybar">
      <div className="daybar-track" role="img" aria-label={`Light cycle: ${segments.map((s) => s.label).join(', ')}. Now in ${segments.find(isActive)?.label ?? 'cycle'}.`}>
        {segments.map((s) => (
          <div key={s.id} className="daybar-seg" data-period={s.id} data-active={isActive(s) || undefined} style={{ flex: `${Math.max(0.5, s.to - s.from)} 1 0` }} />
        ))}
        <span className="daybar-now" style={{ left: `${nowPct}%` }} />
      </div>
      <div className="daybar-labels" aria-hidden="true">
        {segments.map((s) => (
          <span key={s.id} data-active={isActive(s) || undefined} style={{ flex: `${Math.max(0.5, s.to - s.from)} 1 0` }}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}
