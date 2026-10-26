import {
  GrowlinkApi, HttpGrowlinkClient, SimulatedGrowlinkClient, SimRoomSpec, phaseUptake, dayInPhase,
  DEFAULT_ROOM_CONFIG, RoomConfig, cycleInfo,
} from '@gl-steering/core';
import { open } from '@gl-steering/core/vault';
import type { ConnectionRow, RoomRow, RoomStateRow } from './db';
import { env } from './env';

export function roomConfig(room: RoomRow): RoomConfig {
  return { ...DEFAULT_ROOM_CONFIG, ...room.config };
}

/** True when this room's sensors and valves are served by the simulator. */
export const isSimulated = (room: RoomRow, conn: ConnectionRow) => conn.kind === 'demo' || room.mode === 'simulate';

const httpClients = new Map<string, { client: HttpGrowlinkClient; fingerprint: string }>();
const sims = new Map<string, { sim: SimulatedGrowlinkClient; fingerprint: string }>();

export function httpClientFor(conn: ConnectionRow): HttpGrowlinkClient {
  const fingerprint = `${conn.key_ciphertext}`;
  const cached = httpClients.get(conn.id);
  if (cached && cached.fingerprint === fingerprint) return cached.client;
  if (!conn.key_ciphertext || !conn.key_iv || !conn.key_tag) throw new Error('Connection has no API key');
  const apiKey = open({ ciphertext: conn.key_ciphertext, iv: conn.key_iv, tag: conn.key_tag });
  const client = new HttpGrowlinkClient({ apiKey, baseUrl: env.growlinkBaseUrl });
  httpClients.set(conn.id, { client, fingerprint });
  return client;
}

function simSpec(room: RoomRow): SimRoomSpec {
  const cfg = roomConfig(room);
  const ci = cycleInfo(new Date(), cfg);
  const dip = dayInPhase(ci.cycleKey, room.phase_start_date, cfg.timezone);
  return {
    roomId: room.gl_room_id, name: room.name, timezone: cfg.timezone, lightsOn: cfg.lightsOn,
    photoperiodHours: cfg.photoperiodHours, phase: room.phase, phaseStartDate: room.phase_start_date,
    wcSensorIds: room.wc_sensor_ids, ecSensorIds: room.ec_sensor_ids, valveIds: room.valve_ids,
    block: {
      blockVolumeL: cfg.blockVolumeL,
      flowMlPerSec: (cfg.emitterFlowMlPerMin * cfg.emittersPerBlock) / 60,
      fieldCapacityPct: 84,
      dripEc: 3.0,
      dayUptakePctPerHour: phaseUptake(room.phase, dip),
      nightUptakePctPerHour: 0.35,
    },
    initial: { wc: 60, ec: room.phase === 2 ? 3.2 : 5.5 },
  };
}

/**
 * One simulator per simulated room, rebuilt when its mapping or schedule changes and
 * resumed from the snapshot persisted in room_state.sim across restarts.
 */
export function simFor(room: RoomRow, state: RoomStateRow | null): SimulatedGrowlinkClient {
  const spec = simSpec(room);
  const fingerprint = JSON.stringify([spec.wcSensorIds, spec.ecSensorIds, spec.valveIds, spec.timezone, spec.lightsOn, spec.photoperiodHours, spec.block.blockVolumeL, spec.block.flowMlPerSec]);
  const cached = sims.get(room.id);
  if (cached && cached.fingerprint === fingerprint) {
    // Keep transpiration in step with the phase/day the grower set.
    const m = cached.sim.roomModel(room.gl_room_id);
    if (m) m.p.dayUptakePctPerHour = spec.block.dayUptakePctPerHour;
    return cached.sim;
  }
  const snap = state?.sim && cached === undefined ? state.sim : undefined;
  const sim = new SimulatedGrowlinkClient({ id: 'sim', name: 'Simulator' }, [spec], () => new Date(), snap ?? undefined);
  sims.set(room.id, { sim, fingerprint });
  return sim;
}

export function apiFor(room: RoomRow, conn: ConnectionRow, state: RoomStateRow | null): { api: GrowlinkApi; orgId: string; sim: SimulatedGrowlinkClient | null } {
  if (isSimulated(room, conn)) {
    const sim = simFor(room, state);
    return { api: sim, orgId: 'sim', sim };
  }
  return { api: httpClientFor(conn), orgId: conn.org_id, sim: null };
}

export function forgetRoom(roomId: string) { sims.delete(roomId); }
