import { DateTime } from 'luxon';
import { aggregateReadings } from './aggregate';
import { DEFAULT_ROOM_CONFIG, EngineState, initialState, RoomConfig, step, EngineEvent, cycleInfo, dayInPhase, describeEvent, eventSeverity } from './engine';
import { PhaseId, resolveTargets } from './profiles';
import { BlockParams, phaseUptake, SimulatedGrowlinkClient, SimRoomSpec } from './simulator';
import { applyChanges, clampTuning, DaySummary, defaultTuning, ruleBasedAdjustments, Tuning, TuningChange } from './tuning';

/**
 * Accelerated closed-loop run: engine + simulated block, 30-second ticks, daily rule tuning.
 * Used by tests and `npm run sim` to prove the loop converges on Grodan targets.
 */
export interface HarnessOptions {
  phase: PhaseId;
  days: number;
  startDayInPhase?: number;
  config?: Partial<RoomConfig>;
  block?: Partial<BlockParams>;
  initialWc?: number;
  initialEc?: number;
  tuning?: Partial<Tuning>;
  dailyTuning?: boolean;
  start?: string;
}

export interface HarnessResult {
  days: (DaySummary & { tuningAfter: Tuning; changes: TuningChange[] })[];
  events: { at: string; e: EngineEvent }[];
  trace: { t: string; wc: number; ec: number; valve: boolean }[];
  finalTuning: Tuning;
  finalState: EngineState;
}

export async function runHarness(o: HarnessOptions): Promise<HarnessResult> {
  const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, ...o.config };
  const startLocal = DateTime.fromISO(o.start ?? '2026-11-02T00:00:00', { zone: cfg.timezone });
  const phaseStart = startLocal.minus({ days: (o.startDayInPhase ?? 1) - 1 }).toISODate()!;
  let now = startLocal.toMillis();
  const roomId = 'room-1', valveId = 'valve-1';
  const block: BlockParams = {
    blockVolumeL: cfg.blockVolumeL,
    flowMlPerSec: (cfg.emitterFlowMlPerMin * cfg.emittersPerBlock) / 60,
    fieldCapacityPct: 84,
    dripEc: 3.0,
    dayUptakePctPerHour: phaseUptake(o.phase, o.startDayInPhase ?? 1),
    nightUptakePctPerHour: 0.35,
    ...o.block,
  };
  const sim = new SimulatedGrowlinkClient({ id: 'org', name: 'Harness' }, [{
    roomId, name: 'Harness Room', timezone: cfg.timezone, lightsOn: cfg.lightsOn, photoperiodHours: cfg.photoperiodHours,
    phase: o.phase, phaseStartDate: phaseStart, wcSensorIds: ['wc-1', 'wc-2'], ecSensorIds: ['ec-1'], valveIds: [valveId],
    block, initial: { wc: o.initialWc ?? 55, ec: o.initialEc ?? 5 },
  }], () => new Date(now));

  let tuning = clampTuning(o.phase, { ...defaultTuning(o.phase), ...o.tuning });
  let state = initialState();
  let closeAt: number | null = null;
  const end = now + o.days * 86_400_000;
  const days: HarnessResult['days'] = [];
  const events: HarnessResult['events'] = [];
  const trace: HarnessResult['trace'] = [];

  while (now < end) {
    const next = now + 30_000;
    if (closeAt != null && closeAt <= next) {
      sim.advanceTo(closeAt);
      await sim.setDeviceState(roomId, valveId, false);
      closeAt = null;
    }
    now = next;
    sim.advanceTo(now);
    const live = await sim.liveSensors('org', ['wc-1', 'wc-2', 'ec-1']);
    const r = aggregateReadings({ wcSensorIds: ['wc-1', 'wc-2'], ecSensorIds: ['ec-1'] }, live);
    const res = step({
      now: new Date(now), config: cfg, phase: o.phase, phaseStartDate: phaseStart, tuning, state,
      readings: r, mode: 'simulate', paused: false, valveBusy: closeAt != null,
    });
    state = res.state;
    for (const e of res.events) {
      events.push({ at: new Date(now).toISOString(), e });
      if (e.type === 'day_closed') {
        let changes: TuningChange[] = [];
        if (o.dailyTuning !== false) {
          const targets = resolveTargets(o.phase, e.summary.dayInPhase);
          const out = applyChanges(o.phase, tuning, ruleBasedAdjustments(o.phase, tuning, e.summary, targets, state.dayRatePctPerHour));
          tuning = out.tuning; changes = out.applied;
        }
        days.push({ ...e.summary, tuningAfter: tuning, changes });
      }
    }
    for (const a of res.actions) {
      await sim.setDeviceState(roomId, valveId, true);
      closeAt = now + a.seconds * 1000;
    }
    if (now % 300_000 === 0) {
      const m = sim.roomModel(roomId)!.s;
      trace.push({ t: new Date(now).toISOString(), wc: Math.round(m.wc * 10) / 10, ec: Math.round(m.ec * 100) / 100, valve: closeAt != null });
    }
  }
  return { days, events, trace, finalTuning: tuning, finalState: state };
}

// ── Demo backfill ────────────────────────────────────────────────────────────

export interface BackfillResult {
  readings: { ts: string; wc: number | null; ec: number | null; valve: boolean }[];
  events: { ts: string; type: string; severity: 'info' | 'warning' | 'critical'; message: string; data: unknown }[];
  summaries: DaySummary[];
  ruleReviews: { cycleKey: string; changes: TuningChange[] }[];
  state: EngineState;
  tuning: Tuning;
  snapshot: ReturnType<SimulatedGrowlinkClient['snapshot']>;
}

/**
 * Run a simulated room through the last `days` days up to `now`, so a new demo farm opens
 * with real steering history. Same engine, simulator and rule tuning as production.
 */
export async function backfillRoom(spec: SimRoomSpec, days: number, now: Date = new Date()): Promise<BackfillResult> {
  const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, timezone: spec.timezone, lightsOn: spec.lightsOn, photoperiodHours: spec.photoperiodHours };
  const end = Math.floor(now.getTime() / 30_000) * 30_000;
  let t = end - days * 86_400_000;
  const sim = new SimulatedGrowlinkClient({ id: 'sim', name: 'Simulator' }, [spec], () => new Date(t));
  let tuning = clampTuning(spec.phase, defaultTuning(spec.phase));
  let state = initialState();
  let closeAt: number | null = null;
  const sensorIds = [...spec.wcSensorIds, ...spec.ecSensorIds];
  const out: Omit<BackfillResult, 'state' | 'tuning' | 'snapshot'> = { readings: [], events: [], summaries: [], ruleReviews: [] };

  while (t < end) {
    const next = t + 30_000;
    if (closeAt != null && closeAt <= next) {
      sim.advanceTo(closeAt);
      for (const v of spec.valveIds) await sim.setDeviceState(spec.roomId, v, false);
      closeAt = null;
    }
    t = next;
    sim.advanceTo(t);
    // Keep transpiration in step with the day in phase.
    const m = sim.roomModel(spec.roomId)!;
    const ci = cycleInfo(new Date(t), cfg);
    m.p.dayUptakePctPerHour = phaseUptake(spec.phase, dayInPhase(ci.cycleKey, spec.phaseStartDate, cfg.timezone));

    const r = aggregateReadings({ wcSensorIds: spec.wcSensorIds, ecSensorIds: spec.ecSensorIds }, await sim.liveSensors('sim', sensorIds));
    const res = step({ now: new Date(t), config: cfg, phase: spec.phase, phaseStartDate: spec.phaseStartDate, tuning, state, readings: r, mode: 'simulate', paused: false, valveBusy: closeAt != null });
    state = res.state;
    const ts = new Date(t).toISOString();
    for (const e of res.events) {
      if (e.type === 'cycle_started') continue;
      out.events.push({ ts, type: e.type === 'alert' ? `alert_${e.key}` : e.type, severity: eventSeverity(e), message: describeEvent(e), data: e });
      if (e.type === 'day_closed') {
        out.summaries.push(e.summary);
        if (e.summary.shots > 0) {
          const targets = resolveTargets(spec.phase, e.summary.dayInPhase);
          const adj = applyChanges(spec.phase, tuning, ruleBasedAdjustments(spec.phase, tuning, e.summary, targets, state.dayRatePctPerHour));
          if (adj.applied.length) { tuning = adj.tuning; out.ruleReviews.push({ cycleKey: e.summary.cycleKey, changes: adj.applied }); }
        }
      }
    }
    for (const a of res.actions) {
      for (const v of spec.valveIds) await sim.setDeviceState(spec.roomId, v, true);
      closeAt = t + a.seconds * 1000;
    }
    if ((t / 30_000) % 2 === 0) out.readings.push({ ts, wc: r.wc, ec: r.ec, valve: closeAt != null });
  }
  if (closeAt != null) for (const v of spec.valveIds) await sim.setDeviceState(spec.roomId, v, false);
  return { ...out, state, tuning, snapshot: sim.snapshot() };
}
