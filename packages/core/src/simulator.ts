import { DateTime } from 'luxon';
import type {
  DeviceCommand, GlDevice, GlDeviceReading, GlOrganization, GlRoom, GlSensor, GlSensorReading, GrowlinkApi,
} from './growlink/client';
import { idKey } from './growlink/client';
import type { PhaseId } from './profiles';

/**
 * Physically-motivated stonewool block model. Water content rises with absorbed irrigation,
 * falls with transpiration (diurnal, phase-dependent), drains above field capacity, and
 * substrate EC concentrates as water is taken up and refreshes toward drip EC with drain.
 */
export interface BlockParams {
  blockVolumeL: number;
  /** Total flow into one block while the valve is open (ml/s). */
  flowMlPerSec: number;
  fieldCapacityPct: number;
  dripEc: number;
  /** Peak daytime uptake (WC%/h) at this phase. */
  dayUptakePctPerHour: number;
  nightUptakePctPerHour: number;
}

export interface BlockState { wc: number; ec: number; drainedMl: number; irrigatedMl: number }

export function phaseUptake(phase: PhaseId, dayInPhase: number): number {
  switch (phase) {
    case 1: return 0.6;
    case 2: return 1.1 + Math.min(1, dayInPhase / 10) * 0.9;
    case 3: return 2.0 + Math.min(1, dayInPhase / 21) * 1.2;
    case 4: return 3.1;
    case 5: return 2.6;
  }
}

export class BlockModel {
  constructor(public p: BlockParams, public s: BlockState) {}

  /**
   * Advance dt seconds. `lightFactor` 0..1 scales transpiration. `valveOpen` is the fraction
   * of the room's zones currently irrigating (each valve feeds an equal share of the blocks).
   */
  advance(dtSec: number, valveOpen: number | boolean, lightFactor: number) {
    const { p, s } = this;
    const hours = dtSec / 3600;
    const uptake = (p.nightUptakePctPerHour + (p.dayUptakePctPerHour - p.nightUptakePctPerHour) * lightFactor) * hours;
    const wcBefore = s.wc;
    s.wc = Math.max(5, s.wc - uptake);
    // Salts stay behind as water leaves (plants take up some nutrients too).
    if (s.wc > 0) s.ec = s.ec * Math.pow(wcBefore / s.wc, 0.65);

    const share = typeof valveOpen === 'number' ? valveOpen : valveOpen ? 1 : 0;
    if (share > 0) {
      const ml = p.flowMlPerSec * dtSec * share;
      const addPct = (ml / (p.blockVolumeL * 1000)) * 100;
      s.irrigatedMl += ml;
      const fc = p.fieldCapacityPct;
      // Part of every shot channels straight through, rising steeply with saturation;
      // near field capacity almost nothing is retained.
      const x = Math.max(0, (s.wc / fc - 0.6) / 0.4);
      const absorbFrac = Math.max(0, Math.min(1, 1 - x * x));
      const absorbed = addPct * absorbFrac;
      const drained = addPct - absorbed;
      const salts = s.ec * s.wc + absorbed * p.dripEc;
      s.wc += absorbed;
      s.ec = salts / s.wc;
      if (drained > 0) {
        s.drainedMl += (drained / 100) * p.blockVolumeL * 1000;
        // Solution passing through refreshes the block toward drip EC.
        s.ec += (p.dripEc - s.ec) * Math.min(0.5, drained / s.wc * 0.9);
      }
    }
    // Free water above field capacity drains off.
    if (s.wc > p.fieldCapacityPct) {
      const excess = s.wc - p.fieldCapacityPct;
      const out = excess * Math.min(1, dtSec / 120);
      s.wc -= out;
      s.drainedMl += (out / 100) * p.blockVolumeL * 1000;
    }
    s.ec = Math.max(0.5, Math.min(15, s.ec));
  }
}

export interface SimRoomSpec {
  roomId: string;
  name: string;
  timezone: string;
  lightsOn: string;
  photoperiodHours: number;
  phase: PhaseId;
  phaseStartDate: string;
  wcSensorIds: string[];
  ecSensorIds: string[];
  valveIds: string[];
  block: BlockParams;
  initial?: Partial<BlockState>;
  /** Extra sensors/devices for realism in the setup screen. */
  extraSensors?: GlSensor[];
  extraDevices?: GlDevice[];
}

interface SimRoomRuntime {
  spec: SimRoomSpec;
  model: BlockModel;
  valves: Map<string, { open: boolean; isManual: boolean; changedAt: number }>;
  /** Fixed per-sensor calibration offsets so sensors disagree slightly, like real ones. */
  offsets: Map<string, number>;
}

export interface SimSnapshot { t: number; rooms: Record<string, { s: BlockState; valves: Record<string, { open: boolean; isManual: boolean; changedAt: number }> }> }

function lightFactor(t: number, spec: SimRoomSpec): number {
  const local = DateTime.fromMillis(t, { zone: spec.timezone });
  const [h, m] = spec.lightsOn.split(':').map(Number);
  let on = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (on > local) on = on.minus({ days: 1 });
  const hrs = local.diff(on, 'hours').hours;
  if (hrs >= spec.photoperiodHours) return 0;
  // Ramp up over the first 2 h, taper over the last hour.
  return Math.min(1, hrs / 2, (spec.photoperiodHours - hrs) / 1 + 0.4);
}

function hashOffset(id: string, scale: number) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * scale;
}

/**
 * A GrowlinkApi backed entirely by block models. Time advances from `clock()`, so the same
 * class serves a wall-clock demo farm and an accelerated test harness.
 */
export class SimulatedGrowlinkClient implements GrowlinkApi {
  private rooms = new Map<string, SimRoomRuntime>();
  private t: number;

  constructor(
    public org: GlOrganization,
    specs: SimRoomSpec[],
    private clock: () => Date = () => new Date(),
    snapshot?: SimSnapshot,
  ) {
    this.t = snapshot?.t ?? clock().getTime();
    for (const spec of specs) {
      const snap = snapshot?.rooms[spec.roomId];
      const model = new BlockModel(spec.block, snap?.s ?? {
        wc: spec.initial?.wc ?? 62, ec: spec.initial?.ec ?? 4.5, drainedMl: 0, irrigatedMl: 0,
      });
      const valves = new Map<string, { open: boolean; isManual: boolean; changedAt: number }>();
      for (const v of spec.valveIds) valves.set(idKey(v), snap?.valves[idKey(v)] ?? { open: false, isManual: false, changedAt: this.t });
      const offsets = new Map<string, number>();
      for (const id of spec.wcSensorIds) offsets.set(idKey(id), hashOffset(id, 1.6));
      for (const id of spec.ecSensorIds) offsets.set(idKey(id), hashOffset(id, 0.3));
      this.rooms.set(idKey(spec.roomId), { spec, model, valves, offsets });
    }
    if (!snapshot) this.advanceTo(this.t);
  }

  /** Integrate every block up to time `t` in ≤10 s steps. */
  advanceTo(t: number) {
    while (this.t < t) {
      const dt = Math.min(10_000, t - this.t);
      for (const r of this.rooms.values()) {
        const vs = [...r.valves.values()];
        const share = vs.length ? vs.filter((v) => v.open).length / vs.length : 0;
        r.model.advance(dt / 1000, share, lightFactor(this.t, r.spec));
      }
      this.t += dt;
    }
  }

  private sync() { this.advanceTo(this.clock().getTime()); }

  snapshot(): SimSnapshot {
    const rooms: SimSnapshot['rooms'] = {};
    for (const [id, r] of this.rooms) rooms[id] = { s: { ...r.model.s }, valves: Object.fromEntries(r.valves) };
    return { t: this.t, rooms };
  }

  roomModel(roomId: string) { return this.rooms.get(idKey(roomId))?.model; }

  async listOrganizations() { return [this.org]; }
  async listRooms(orgId: string): Promise<GlRoom[]> {
    if (idKey(orgId) !== idKey(this.org.id)) return [];
    return [...this.rooms.values()].map((r) => ({ id: r.spec.roomId, name: r.spec.name, roomType: 0 }));
  }
  async listSensors(roomId: string): Promise<GlSensor[]> {
    const r = this.rooms.get(idKey(roomId));
    if (!r) return [];
    return [
      ...r.spec.wcSensorIds.map((id, i) => ({ id, name: `Substrate WC ${i + 1}`, sensorType: 30, unitOfMeasure: 4, metric: 9, moduleName: `TerraLink ${i + 1}` })),
      ...r.spec.ecSensorIds.map((id, i) => ({ id, name: `Substrate EC ${i + 1}`, sensorType: 31, unitOfMeasure: 6, metric: 10, moduleName: `TerraLink ${i + 1}` })),
      ...(r.spec.extraSensors ?? []),
    ];
  }
  async listDevices(roomId: string): Promise<GlDevice[]> {
    const r = this.rooms.get(idKey(roomId));
    if (!r) return [];
    return [
      ...r.spec.valveIds.map((id, i) => ({ id, name: `Irrigation Valve ${i + 1}`, deviceType: 24, interfaceType: 2 })),
      ...(r.spec.extraDevices ?? []),
    ];
  }

  async liveSensors(_orgId: string, sensorIds: string[]): Promise<GlSensorReading[]> {
    this.sync();
    const out: GlSensorReading[] = [];
    const ts = new Date(this.t).toISOString();
    const wanted = new Set(sensorIds.map(idKey));
    for (const r of this.rooms.values()) {
      for (const id of r.spec.wcSensorIds) if (wanted.has(idKey(id))) {
        const noise = (Math.random() - 0.5) * 0.3;
        out.push({ sensorId: id, metric: 9, unitOfMeasure: 4, value: Math.round((r.model.s.wc + (r.offsets.get(idKey(id)) ?? 0) + noise) * 10) / 10, timestamp: ts, suffix: '%' });
      }
      for (const id of r.spec.ecSensorIds) if (wanted.has(idKey(id))) {
        const noise = (Math.random() - 0.5) * 0.08;
        out.push({ sensorId: id, metric: 10, unitOfMeasure: 6, value: Math.round((r.model.s.ec + (r.offsets.get(idKey(id)) ?? 0) + noise) * 100) / 100, timestamp: ts, suffix: ' EC' });
      }
    }
    return out;
  }

  async liveDevices(_orgId: string, deviceIds: string[]): Promise<GlDeviceReading[]> {
    this.sync();
    const ts = new Date(this.t).toISOString();
    const wanted = new Set(deviceIds.map(idKey));
    const out: GlDeviceReading[] = [];
    for (const r of this.rooms.values()) for (const [id, v] of r.valves) if (wanted.has(id)) {
      const original = r.spec.valveIds.find((x) => idKey(x) === id)!;
      out.push({ deviceId: original, isActive: v.open, isManual: v.isManual, throttle: null, timestamp: ts });
    }
    return out;
  }

  async setDeviceState(roomId: string, deviceId: string, value: DeviceCommand) {
    this.sync();
    const r = this.rooms.get(idKey(roomId));
    const v = r?.valves.get(idKey(deviceId));
    if (!r || !v) throw new Error(`Simulator: unknown device ${deviceId} in room ${roomId}`);
    if (value === true) Object.assign(v, { open: true, isManual: true, changedAt: this.t });
    else if (value === false) Object.assign(v, { open: false, isManual: true, changedAt: this.t });
    else if (value === 'auto') Object.assign(v, { open: false, isManual: false, changedAt: this.t });
    else Object.assign(v, { open: Number(value) > 0, isManual: true, changedAt: this.t });
  }
}

// ── Demo farm ────────────────────────────────────────────────────────────────

export const DEMO_ORG: GlOrganization = { id: '0d3e6f10-0000-4000-8000-000000000001', name: 'Demo Farm (simulated)' };

const g = (n: number) => `0d3e6f10-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export function demoFarmSpecs(today: DateTime = DateTime.now().setZone('America/Denver')): SimRoomSpec[] {
  const tz = 'America/Denver';
  const start = (daysAgo: number) => today.minus({ days: daysAgo }).toISODate()!;
  const block = (dayUptake: number): BlockParams => ({
    blockVolumeL: 2.4, flowMlPerSec: (33 * 2) / 60, fieldCapacityPct: 84, dripEc: 3.0,
    dayUptakePctPerHour: dayUptake, nightUptakePctPerHour: 0.35,
  });
  const climate = (base: number): GlSensor[] => [
    { id: g(base + 1), name: 'Air Temp', sensorType: 1, unitOfMeasure: 0, metric: 0 },
    { id: g(base + 2), name: 'Humidity', sensorType: 2, unitOfMeasure: 4, metric: 1 },
    { id: g(base + 3), name: 'VPD', sensorType: 8, unitOfMeasure: 8, metric: 8 },
  ];
  const lights = (base: number): GlDevice[] => [
    { id: g(base + 50), name: 'LED Bank A', deviceType: 28, interfaceType: 3 },
    { id: g(base + 51), name: 'Dehumidifier', deviceType: 8, interfaceType: 2 },
  ];
  return [
    {
      roomId: g(100), name: 'Flower Room A', timezone: tz, lightsOn: '06:00', photoperiodHours: 12,
      phase: 3, phaseStartDate: start(8), wcSensorIds: [g(101), g(102), g(103)], ecSensorIds: [g(111), g(112), g(113)],
      valveIds: [g(121), g(122)], block: block(phaseUptake(3, 9)), initial: { wc: 58, ec: 5.6 },
      extraSensors: climate(130), extraDevices: lights(130),
    },
    {
      roomId: g(200), name: 'Flower Room B', timezone: tz, lightsOn: '07:00', photoperiodHours: 12,
      phase: 4, phaseStartDate: start(5), wcSensorIds: [g(201), g(202)], ecSensorIds: [g(211), g(212)],
      valveIds: [g(221)], block: block(phaseUptake(4, 6)), initial: { wc: 60, ec: 6.2 },
      extraSensors: climate(230), extraDevices: lights(230),
    },
    {
      roomId: g(300), name: 'Veg Room 1', timezone: tz, lightsOn: '05:00', photoperiodHours: 18,
      phase: 2, phaseStartDate: start(2), wcSensorIds: [g(301), g(302)], ecSensorIds: [g(311)],
      valveIds: [g(321), g(322)], block: block(phaseUptake(2, 3)), initial: { wc: 70, ec: 3.2 },
      extraSensors: climate(330), extraDevices: lights(330),
    },
  ];
}

export function createDemoFarm(clock?: () => Date, snapshot?: SimSnapshot) {
  return new SimulatedGrowlinkClient(DEMO_ORG, demoFarmSpecs(), clock, snapshot);
}
