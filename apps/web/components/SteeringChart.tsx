'use client';

import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { DateTime } from 'luxon';
import { resolveTargets, dayInPhase, type Range, type PhaseId } from '@gl-steering/core';

export interface ChartPoint { t: string; wc: number | null; ec: number | null; valve: boolean }
export interface ChartShot { ts: string; kind: string; seconds: number; pct: number; shadow: boolean }

interface Props {
  points: ChartPoint[];
  shots: ChartShot[];
  hours: number;
  timezone: string;
  lightsOn: string;
  photoperiodHours: number;
  wcBand: Range;
  ecBand: Range;
  phase: PhaseId;
  phaseStartDate: string;
  deadline?: string | null;
  /** Server render time — keeps SSR and hydration identical. */
  now: number;
}

const H_WC = 220, H_EC = 120, GAP = 28, M = { l: 44, r: 16, t: 10, b: 24 };

/**
 * Two small multiples on one time axis — WC (with its day band) above EC (with its
 * substrate band). Never a dual axis. Night (lights-off) shaded; shots as ticks; crosshair tooltip.
 */
export function SteeringChart(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const now = p.now;
  const x0 = now - p.hours * 3_600_000, x1 = now;
  const iw = w - M.l - M.r;
  const x = (t: number) => M.l + ((t - x0) / (x1 - x0)) * iw;
  const pts = useMemo(() => p.points.map((d) => ({ ...d, ms: Date.parse(d.t) })).filter((d) => d.ms >= x0), [p.points, x0]);

  // Phase targets ramp day by day within a phase, so the band is drawn per light cycle.
  const bands = useMemo(() => {
    const out: { a: number; b: number; wc: Range; ec: Range }[] = [];
    const [h, m] = p.lightsOn.split(':').map(Number);
    let on = DateTime.fromMillis(x0, { zone: p.timezone }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).minus({ days: 1 });
    while (on.toMillis() < x1) {
      const next = on.plus({ days: 1 });
      const tg = resolveTargets(p.phase, dayInPhase(on.toISODate()!, p.phaseStartDate, p.timezone));
      const a = Math.max(on.toMillis(), x0), b = Math.min(next.toMillis(), x1);
      if (b > a) out.push({ a, b, wc: tg.dayWc, ec: tg.substrateEc });
      on = next;
    }
    return out;
  }, [p.lightsOn, p.timezone, p.phase, p.phaseStartDate, x0, x1]);

  const wcVals = pts.map((d) => d.wc).filter((v): v is number => v != null);
  const ecVals = pts.map((d) => d.ec).filter((v): v is number => v != null);
  const wcDom = niceDomain([...wcVals, ...bands.flatMap((b) => [b.wc.min, b.wc.max])], 2);
  const ecDom = niceDomain([...ecVals, ...bands.flatMap((b) => [b.ec.min, b.ec.max])], 0.5);
  const clampY = (v: number, d: { min: number; max: number }) => Math.max(d.min, Math.min(d.max, v));
  const top1 = M.t, top2 = M.t + H_WC + GAP;
  const yWc = (v: number) => top1 + H_WC - ((v - wcDom.min) / (wcDom.max - wcDom.min)) * H_WC;
  const yEc = (v: number) => top2 + H_EC - ((v - ecDom.min) / (ecDom.max - ecDom.min)) * H_EC;
  const height = top2 + H_EC + M.b;

  // Night bands from the light schedule.
  const nights = useMemo(() => {
    const out: [number, number][] = [];
    const [h, m] = p.lightsOn.split(':').map(Number);
    let on = DateTime.fromMillis(x0, { zone: p.timezone }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).minus({ days: 1 });
    while (on.toMillis() < x1) {
      const off = on.plus({ minutes: p.photoperiodHours * 60 });
      const next = on.plus({ days: 1 });
      out.push([Math.max(off.toMillis(), x0), Math.min(next.toMillis(), x1)]);
      on = next;
    }
    return out.filter(([a, b]) => b > a);
  }, [p.lightsOn, p.photoperiodHours, p.timezone, x0, x1]);

  const path = (key: 'wc' | 'ec', y: (v: number) => number) => {
    let d = '', pen = false, last = 0;
    for (const pt of pts) {
      const v = pt[key];
      // Break the line across gaps longer than 3 minutes (controller offline / stale data).
      if (v == null || (pen && pt.ms - last > Math.max(180_000, (p.hours * 3_600_000) / 300))) { pen = false; if (v == null) continue; }
      d += `${pen ? 'L' : 'M'}${x(pt.ms).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true; last = pt.ms;
    }
    return d;
  };

  const ticks = useMemo(() => {
    const n = Math.max(3, Math.min(8, Math.round(iw / 140)));
    const step = (x1 - x0) / n;
    return Array.from({ length: n + 1 }, (_, i) => x0 + i * step);
  }, [iw, x0, x1]);
  const tickLabel = (t: number) => {
    const d = DateTime.fromMillis(t, { zone: p.timezone });
    return p.hours > 30 ? d.toFormat('ccc HH:mm') : d.toFormat('HH:mm');
  };

  const hoverPt = hover == null ? null : nearest(pts, hover);
  const hoverShot = hover == null ? null : p.shots.find((s) => Math.abs(Date.parse(s.ts) - hover) < (x1 - x0) / iw * 6);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < M.l || px > w - M.r) return setHover(null);
    setHover(x0 + ((px - M.l) / iw) * (x1 - x0));
  };

  const deadlineMs = p.deadline ? Date.parse(p.deadline) : null;

  return (
    <div className="chart-wrap" ref={wrap} style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
      <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Water content and substrate EC, last ${p.hours} hours`} style={{ display: 'block', touchAction: 'none' }}>
        {/* Night shading spans both panels */}
        {nights.map(([a, b], i) => (
          <rect key={i} x={x(a)} y={top1} width={Math.max(0, x(b) - x(a))} height={top2 + H_EC - top1} fill="var(--ds-background-neutral)" opacity={0.55} />
        ))}

        {/* WC panel */}
        {bands.map((bd, i) => (
          <rect key={i} x={x(bd.a)} y={yWc(clampY(bd.wc.max, wcDom))} width={Math.max(0, x(bd.b) - x(bd.a))}
            height={Math.max(1, yWc(clampY(bd.wc.min, wcDom)) - yWc(clampY(bd.wc.max, wcDom)))} fill="var(--ds-background-accent-green-subtlest)" opacity={0.9} />
        ))}
        <Grid dom={wcDom} y={yWc} left={M.l} right={w - M.r} unit="%" />
        <text x={M.l} y={top1 - 0 + 12} dx={6} className="small" fill="var(--ds-text-subtle)" style={{ font: 'var(--ds-font-body-small)' }}>Water content (%) · today’s band {p.wcBand.min}–{p.wcBand.max}%</text>
        {deadlineMs && deadlineMs > x0 && deadlineMs < x1 && (
          <g>
            <line x1={x(deadlineMs)} x2={x(deadlineMs)} y1={top1} y2={top1 + H_WC} stroke="var(--ds-border-bold)" strokeDasharray="3 3" />
            <text x={x(deadlineMs)} y={top1 + H_WC - 6} dx={-4} textAnchor="end" style={{ font: 'var(--ds-font-body-small)' }} fill="var(--ds-text-subtlest)">last shot</text>
          </g>
        )}
        <path d={path('wc', yWc)} fill="none" stroke="var(--ds-chart-blue-bolder)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {p.shots.map((s, i) => {
          const sx = x(Date.parse(s.ts));
          if (sx < M.l || sx > w - M.r) return null;
          return <rect key={i} x={sx - 1.5} y={top1 + H_WC - 10} width={3} height={10} rx={1}
            fill={s.shadow ? 'none' : 'var(--ds-chart-gray-bolder)'} stroke={s.shadow ? 'var(--ds-chart-gray-bolder)' : 'none'} />;
        })}

        {/* EC panel */}
        {bands.map((bd, i) => (
          <rect key={i} x={x(bd.a)} y={yEc(clampY(bd.ec.max, ecDom))} width={Math.max(0, x(bd.b) - x(bd.a))}
            height={Math.max(1, yEc(clampY(bd.ec.min, ecDom)) - yEc(clampY(bd.ec.max, ecDom)))} fill="var(--ds-background-accent-green-subtlest)" opacity={0.9} />
        ))}
        <Grid dom={ecDom} y={yEc} left={M.l} right={w - M.r} unit="" />
        <text x={M.l} y={top2 + 12} dx={6} style={{ font: 'var(--ds-font-body-small)' }} fill="var(--ds-text-subtle)">Substrate EC (mS/cm) · target {p.ecBand.min}–{p.ecBand.max}</text>
        <path d={path('ec', yEc)} fill="none" stroke="var(--ds-chart-purple-bolder)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* X axis */}
        {ticks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
            style={{ font: 'var(--ds-font-body-small)' }} fill="var(--ds-text-subtlest)">{tickLabel(t)}</text>
        ))}

        {/* Crosshair */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={top1} y2={top2 + H_EC} stroke="var(--ds-border-bold)" />
            {hoverPt?.wc != null && <circle cx={x(hoverPt.ms)} cy={yWc(hoverPt.wc)} r={4} fill="var(--ds-chart-blue-bolder)" stroke="var(--ds-surface)" strokeWidth={2} />}
            {hoverPt?.ec != null && <circle cx={x(hoverPt.ms)} cy={yEc(hoverPt.ec)} r={4} fill="var(--ds-chart-purple-bolder)" stroke="var(--ds-surface)" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hover != null && hoverPt && (
        <div className="chart-tip" style={{ left: Math.min(w - 210, Math.max(0, x(hover) + 12)), top: 24 }}>
          <div className="muted">{DateTime.fromMillis(hoverPt.ms, { zone: p.timezone }).toFormat('ccc d LLL, HH:mm')}</div>
          <div><span className="legend-swatch" style={{ background: 'var(--ds-chart-blue-bolder)' }} />WC <b className="num">{hoverPt.wc?.toFixed(1) ?? '—'}%</b></div>
          <div><span className="legend-swatch" style={{ background: 'var(--ds-chart-purple-bolder)' }} />EC <b className="num">{hoverPt.ec?.toFixed(2) ?? '—'}</b> mS/cm</div>
          {hoverShot && <div style={{ marginTop: 4 }}>{hoverShot.shadow ? 'Would fire' : 'Shot'}: {hoverShot.kind} · {hoverShot.seconds}s · {hoverShot.pct}% WC</div>}
        </div>
      )}
      <div className="legend" style={{ marginTop: 8 }}>
        <span><span className="legend-swatch" style={{ background: 'var(--ds-background-accent-green-subtlest)', border: '1px solid var(--ds-border)' }} />Target band (per day)</span>
        <span><span className="legend-swatch" style={{ background: 'var(--ds-background-neutral)' }} />Lights off</span>
        <span><span className="legend-swatch" style={{ background: 'var(--ds-chart-gray-bolder)', width: 3 }} />Shot</span>
        {p.shots.some((s) => s.shadow) && <span><span className="legend-swatch" style={{ border: '1px solid var(--ds-chart-gray-bolder)', width: 3 }} />Shadow decision</span>}
      </div>
    </div>
  );
}

function Grid({ dom, y, left, right, unit }: { dom: { min: number; max: number; step: number }; y: (v: number) => number; left: number; right: number; unit: string }) {
  const lines: number[] = [];
  for (let v = dom.min; v <= dom.max + 1e-9; v += dom.step) lines.push(Math.round(v * 100) / 100);
  return (
    <g>
      {lines.map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--ds-border)" strokeWidth={1} />
          <text x={left - 6} y={y(v) + 4} textAnchor="end" style={{ font: 'var(--ds-font-body-small)' }} fill="var(--ds-text-subtlest)">{v}{unit}</text>
        </g>
      ))}
    </g>
  );
}

function niceDomain(vals: number[], minStep: number) {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, minStep * 2);
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

function nearest<T extends { ms: number }>(arr: T[], t: number): T | null {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].ms < t) lo = mid + 1; else hi = mid; }
  const a = arr[Math.max(0, lo - 1)], b = arr[lo];
  return Math.abs(a.ms - t) <= Math.abs(b.ms - t) ? a : b;
}
