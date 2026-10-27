import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  DEFAULT_ROOM_CONFIG, initialState, step, StepInput, defaultTuning, resolveTargets, runHarness,
  aggregateReadings, clampTuning, applyChanges, parseReview, emergencyFloor, shotSeconds,
} from '../src/index';
import { seal, open } from '../src/vault';

const tz = 'America/Denver';
const at = (iso: string) => DateTime.fromISO(iso, { zone: tz }).toJSDate();

function input(over: Partial<StepInput> & { now: Date; wc?: number | null; ec?: number | null }): StepInput {
  const { wc = 60, ec = 5, ...rest } = over;
  return {
    config: { ...DEFAULT_ROOM_CONFIG, timezone: tz, lightsOn: '06:00', photoperiodHours: 12 },
    phase: 3, phaseStartDate: '2026-11-01', tuning: defaultTuning(3), state: initialState(),
    readings: { wc, ec, at: over.now }, mode: 'live', paused: false, valveBusy: false,
    ...rest,
  };
}

describe('phase targets', () => {
  it('ramps phase 3 overnight dry-back from ~10–15% to 22–25% by day 21', () => {
    expect(resolveTargets(3, 1).odb).toEqual({ min: 10, max: 15 });
    expect(resolveTargets(3, 21).odb).toEqual({ min: 22, max: 25 });
    expect(resolveTargets(3, 30).odb).toEqual({ min: 22, max: 25 });
  });
  it('steps phase 2 day-level WC from ~80% down to ~65% over the first days', () => {
    expect(resolveTargets(2, 1).dayWc.min).toBe(78);
    expect(resolveTargets(2, 4).dayWc).toEqual({ min: 63, max: 67 });
  });
});

describe('daily-cycle engine', () => {
  it('waits at night and before the P1 start delay', () => {
    const r = step(input({ now: at('2026-11-05T06:30') }));
    expect(r.actions).toHaveLength(0);
    expect(r.state.period).toBe('night');
    expect(r.status.nextShotHint).toMatch(/P1 starts/);
  });

  it('starts P1 after the start delay and fires a ramp shot', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    const r = step(input({ now: at('2026-11-05T07:30'), wc: 51.8, state: s }));
    expect(r.state.period).toBe('P1');
    expect(r.actions[0]).toMatchObject({ type: 'shot', kind: 'P1' });
    expect(r.actions[0].seconds).toBe(shotSeconds(defaultTuning(3).p1ShotPct, input({ now: new Date() }).config, 1));
  });

  it('starts P1 early when WC drops 1–2% after lights-on', () => {
    const s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    const r = step(input({ now: at('2026-11-05T06:20'), wc: 50.2, state: s }));
    expect(r.state.period).toBe('P1');
    expect(r.actions).toHaveLength(1);
  });

  it('moves P1 → P2 when WC reaches the day band, then fires on dry-back', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    s = step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s })).state;
    s = step(input({ now: at('2026-11-05T08:00'), wc: 61, state: s })).state;
    expect(s.period).toBe('P2');
    s = step(input({ now: at('2026-11-05T08:10'), wc: 63, state: s })).state; // post-shot peak
    const quiet = step(input({ now: at('2026-11-05T08:40'), wc: 60, state: s }));
    expect(quiet.actions).toHaveLength(0);
    const fire = step(input({ now: at('2026-11-05T09:00'), wc: 57.5, state: quiet.state }));
    expect(fire.actions[0]).toMatchObject({ kind: 'P2' });
  });

  it('stops irrigating at the last-shot deadline (P3)', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    s = step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s })).state;
    s = step(input({ now: at('2026-11-05T08:00'), wc: 62, state: s })).state;
    const late = step(input({ now: at('2026-11-05T16:00'), wc: 50, state: s }));
    expect(late.state.period).toBe('P3');
    expect(late.actions).toHaveLength(0);
  });

  it('holds irrigation on stale sensor data and raises an alert', () => {
    let s = initialState();
    let last;
    for (let i = 0; i < 5; i++) {
      last = step(input({ now: at(`2026-11-05T08:0${i}`), state: s, readings: { wc: 50, ec: 5, at: at('2026-11-05T07:00') } } as any));
      s = last.state;
    }
    expect(last!.actions).toHaveLength(0);
    expect(s.alerts).toContain('sensor_stale');
  });

  it('never fires (live or shadow) when the WC reading is missing', () => {
    for (const mode of ['live', 'shadow'] as const) {
      let s = initialState();
      for (const hhmm of ['06:01', '07:30', '08:00', '09:00', '10:30']) {
        const r = step(input({ now: at(`2026-11-05T${hhmm}`), wc: null, ec: 5, state: s, mode }));
        expect(r.actions).toHaveLength(0);
        expect(r.events.some((e) => e.type === 'shadow_shot' || e.type === 'shot')).toBe(false);
        s = r.state;
      }
    }
  });

  it('fires an emergency shot below the safety floor, even at night', () => {
    const floor = emergencyFloor(3);
    const r = step(input({ now: at('2026-11-05T22:00'), wc: floor - 2 }));
    expect(r.actions[0]).toMatchObject({ kind: 'emergency' });
    expect(r.events.some((e) => e.type === 'alert' && e.severity === 'critical')).toBe(true);
  });

  it('shadow mode decides but never actuates', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52, mode: 'shadow' })).state;
    const r = step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s, mode: 'shadow' }));
    expect(r.actions).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'shadow_shot')).toBe(true);
  });

  it('does nothing while paused or while a valve is still open', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    expect(step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s, paused: true })).actions).toHaveLength(0);
    expect(step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s, valveBusy: true })).actions).toHaveLength(0);
  });

  it('measures overnight dry-back at the next morning\'s first shot', () => {
    let s = step(input({ now: at('2026-11-05T06:01'), wc: 52 })).state;
    s = step(input({ now: at('2026-11-05T07:30'), wc: 52, state: s })).state;
    s = step(input({ now: at('2026-11-05T08:00'), wc: 62, state: s })).state;
    s = step(input({ now: at('2026-11-05T08:05'), wc: 64, state: s })).state;
    s = step(input({ now: at('2026-11-06T06:01'), wc: 51, state: s })).state;
    const r = step(input({ now: at('2026-11-06T07:30'), wc: 50, state: s }));
    const closed = r.events.find((e) => e.type === 'day_closed') as any;
    expect(closed.summary.odb).toBe(14);
    expect(closed.summary.cycleKey).toBe('2026-11-05');
  });
});

describe('closed loop (engine + simulated blocks)', () => {
  it('holds phase 3 within its targets after the first days', async () => {
    const res = await runHarness({ phase: 3, days: 12 });
    const settled = res.days.filter((d) => d.dayInPhase >= 4 && d.odb != null);
    expect(settled.length).toBeGreaterThan(5);
    for (const d of settled) {
      const t = resolveTargets(3, d.dayInPhase);
      expect(d.peakWc!).toBeGreaterThanOrEqual(t.dayWc.min - 2);
      expect(d.peakWc!).toBeLessThanOrEqual(t.dayWc.max + 2);
      expect(d.odb!).toBeGreaterThanOrEqual(t.odb.min - 5);
      expect(d.odb!).toBeLessThanOrEqual(t.odb.max + 3);
      expect(d.emergencyShots).toBe(0);
    }
  }, 60_000);

  it('recovers a dry phase 2 block toward the ~80% transplant band', async () => {
    const res = await runHarness({ phase: 2, days: 3, initialWc: 55 });
    const day1 = res.days.find((d) => d.shots > 0)!;
    expect(day1.peakWc!).toBeGreaterThan(75);
  }, 60_000);
});

describe('tuning, aggregation, AI parsing, vault', () => {
  it('clamps tuning into hard bounds', () => {
    const t = clampTuning(3, { ...defaultTuning(3), p2ShotPct: 99, stopBeforeLightsOffHours: -4 });
    expect(t.p2ShotPct).toBe(8);
    expect(t.stopBeforeLightsOffHours).toBe(1); // phase 3 floor: the ~2 h stop minus 1 h
    const { applied } = applyChanges(3, defaultTuning(3), [{ key: 'p2TriggerPct', to: 20, reason: 'x' }]);
    expect(applied[0].to).toBe(7);
  });

  it('drops an outlier probe and normalizes µS/cm EC', () => {
    const now = new Date().toISOString();
    const r = aggregateReadings({ wcSensorIds: ['A', 'B', 'C'], ecSensorIds: ['E'] }, [
      { sensorId: 'a', metric: 9, unitOfMeasure: 4, value: 60, timestamp: now },
      { sensorId: 'B', metric: 9, unitOfMeasure: 4, value: 62, timestamp: now },
      { sensorId: 'C', metric: 9, unitOfMeasure: 4, value: 20, timestamp: now },
      { sensorId: 'E', metric: 10, unitOfMeasure: 33, value: 5400, timestamp: now },
    ]);
    expect(r.wc).toBe(61);
    expect(r.outliers).toEqual(['C']);
    expect(r.ec).toBe(5.4);
  });

  it('clamps AI changes and ignores unknown keys', () => {
    const { tuning, applied, review } = parseReview({
      summary: 'ok', assessment: 'bogus',
      changes: [{ key: 'p1ShotPct', to: 50, reason: 'x' }, { key: 'nope', to: 1, reason: 'y' }],
      phase_advance: { recommend: false, reason: '' }, alerts: [],
    }, 3, defaultTuning(3));
    expect(review.assessment).toBe('watch');
    expect(applied).toHaveLength(1);
    expect(tuning.p1ShotPct).toBe(defaultTuning(3).p1ShotPct + 1.5); // one review moves at most ±1.5
  });

  it('round-trips API keys through AES-256-GCM', () => {
    const k = Buffer.alloc(32, 7).toString('base64');
    const sealed = seal('gl_live_secret_ABCD', k);
    expect(sealed.last4).toBe('ABCD');
    expect(sealed.ciphertext).not.toContain('secret');
    expect(open(sealed, k)).toBe('gl_live_secret_ABCD');
  });
});
