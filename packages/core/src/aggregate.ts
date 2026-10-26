import { ecToMsCm, GlDeviceReading, GlSensorReading, idKey } from './growlink/client';
import type { Readings } from './engine';

export interface SensorMapping { wcSensorIds: string[]; ecSensorIds: string[] }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Room-level readings from live sensor data. WC uses the median (robust to one bad probe);
 * any probe more than 8 WC% from the median is dropped before averaging.
 */
export function aggregateReadings(map: SensorMapping, live: GlSensorReading[]): Readings & { wcSensors: number; ecSensors: number; outliers: string[] } {
  const byId = new Map(live.map((r) => [idKey(r.sensorId), r]));
  const wcVals: { id: string; v: number; t: number }[] = [];
  const ecVals: { v: number; t: number }[] = [];
  for (const id of map.wcSensorIds) {
    const r = byId.get(idKey(id));
    if (r && typeof r.value === 'number' && Number.isFinite(r.value)) wcVals.push({ id, v: r.value, t: Date.parse(r.timestamp) });
  }
  for (const id of map.ecSensorIds) {
    const r = byId.get(idKey(id));
    if (r && typeof r.value === 'number' && Number.isFinite(r.value)) ecVals.push({ v: ecToMsCm(r.value, r.unitOfMeasure), t: Date.parse(r.timestamp) });
  }
  let wc: number | null = null;
  const outliers: string[] = [];
  if (wcVals.length) {
    const m = median(wcVals.map((x) => x.v));
    const kept = wcVals.filter((x) => {
      const ok = Math.abs(x.v - m) <= 8;
      if (!ok) outliers.push(x.id);
      return ok;
    });
    wc = Math.round((kept.reduce((a, x) => a + x.v, 0) / kept.length) * 100) / 100;
  }
  const ec = ecVals.length ? Math.round((ecVals.reduce((a, x) => a + x.v, 0) / ecVals.length) * 100) / 100 : null;
  const times = [...wcVals.map((x) => x.t), ...ecVals.map((x) => x.t)].filter(Number.isFinite);
  return { wc, ec, at: times.length ? new Date(Math.max(...times)) : null, wcSensors: wcVals.length, ecSensors: ecVals.length, outliers };
}

/** Seconds any of the room's valves were seen running since the previous poll (shadow mode). */
export function detectObservedIrrigation(
  valveIds: string[],
  prev: Record<string, { active: boolean; since: string | null }>,
  live: GlDeviceReading[],
  now: Date,
): { seconds: number; next: Record<string, { active: boolean; since: string | null }> } {
  const byId = new Map(live.map((r) => [idKey(r.deviceId), r]));
  const next: Record<string, { active: boolean; since: string | null }> = {};
  let seconds = 0;
  for (const id of valveIds) {
    const k = idKey(id);
    const r = byId.get(k);
    const was = prev[k] ?? { active: false, since: null };
    const active = !!r?.isActive;
    if (active && !was.active) next[k] = { active: true, since: now.toISOString() };
    else if (!active && was.active && was.since) {
      seconds = Math.max(seconds, Math.round((now.getTime() - Date.parse(was.since)) / 1000));
      next[k] = { active: false, since: null };
    } else next[k] = was.active === active ? was : { active, since: null };
  }
  return { seconds, next };
}
