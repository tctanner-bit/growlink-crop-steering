import { DateTime } from 'luxon';

export interface LightSchedule {
  /** Local lights-on time in the room's time zone, "HH:MM" (rounded to 5 min). */
  lightsOn: string;
  /** Hours of light per cycle (rounded to 0.25 h). */
  photoperiodHours: number;
  /** When the most recent complete day period started (UTC ISO). */
  observedOnAt: string;
  /** Complete day periods the answer is based on. */
  periods: number;
}

/**
 * Infers the light schedule from Growlink's day/night markers (sensor chart `dayNight`:
 * y=1 starts a day period, the next y=0 ends it). Uses the most recent complete day,
 * so a veg → flower flip is picked up on the first full flower day. A marker that sits on the
 * window's start is a boundary, not a real lights-on, and is ignored.
 */
export function inferLightSchedule(dayNight: { x: string; y: number }[], timezone: string, windowStart?: string): LightSchedule | null {
  const pts = dayNight
    .map((p) => ({ t: Date.parse(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const startMs = windowStart ? Date.parse(windowStart) : -Infinity;
  const periods: { on: number; off: number }[] = [];
  let on: number | null = null;
  for (const p of pts) {
    if (p.y === 1) on = Math.abs(p.t - startMs) < 60_000 ? null : p.t;
    else if (p.y === 0 && on != null) { periods.push({ on, off: p.t }); on = null; }
  }
  const valid = periods.filter((p) => { const h = (p.off - p.on) / 3_600_000; return h >= 4 && h <= 23.5; });
  const last = valid[valid.length - 1];
  if (!last) return null;
  const local = DateTime.fromMillis(last.on, { zone: timezone });
  const mins = Math.round((local.hour * 60 + local.minute) / 5) * 5 % 1440;
  const lightsOn = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const photoperiodHours = Math.round(((last.off - last.on) / 3_600_000) * 4) / 4;
  return { lightsOn, photoperiodHours, observedOnAt: new Date(last.on).toISOString(), periods: valid.length };
}
