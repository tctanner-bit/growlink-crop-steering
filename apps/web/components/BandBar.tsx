import type { Range } from '@gl-steering/core';

/** A value against its target band on a fixed scale. Identity carried by text; the bar is secondary. */
export function BandBar({ value, band, scale }: { value: number | null; band: Range; scale: Range }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - scale.min) / (scale.max - scale.min)) * 100))}%`;
  return (
    <div className="bandbar" role="img" aria-label={`Target ${band.min}–${band.max}${value != null ? `, current ${value.toFixed(1)}` : ''}`}>
      <div className="bandbar-band" style={{ left: pct(band.min), width: `calc(${pct(band.max)} - ${pct(band.min)})` }} />
      {value != null && <div className="bandbar-dot" style={{ left: pct(value) }} />}
    </div>
  );
}
