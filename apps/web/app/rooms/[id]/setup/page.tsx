import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_ROOM_CONFIG, IRRIGATION_DEVICE_TYPES, COMMANDABLE_INTERFACES, SensorMetric, emergencyFloor } from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { getConnection, getRoom } from '@/lib/data';
import { apiForConnection } from '@/lib/growlink';
import { Heading, SectionMessage } from '@/components/ak';
import { SetupForm } from '@/components/SetupForm';
import { DeleteRoomButton } from '@/components/DeleteRoomButton';

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const room = await getRoom(user.id, id);
  if (!room) notFound();
  const conn = (await getConnection(user.id, room.connection_id))!;

  let sensors: { id: string; name: string; metric: number; moduleName?: string }[] = [];
  let devices: { id: string; name: string; deviceType: number; interfaceType: number }[] = [];
  let error: string | null = null;
  try {
    const api = apiForConnection(conn);
    [sensors, devices] = await Promise.all([api.listSensors(room.gl_room_id), api.listDevices(room.gl_room_id)]);
  } catch (e: any) {
    error = e?.message ?? 'Could not load sensors and devices from Growlink.';
  }

  const wc = sensors.filter((s) => s.metric === SensorMetric.WaterContent);
  const ec = sensors.filter((s) => s.metric === SensorMetric.EC);
  const valves = devices.filter((d) => COMMANDABLE_INTERFACES.has(d.interfaceType));
  const cfg = { ...DEFAULT_ROOM_CONFIG, ...room.config };

  return (
    <div className="stack gap-300" style={{ maxWidth: 980 }}>
      <div className="stack gap-100">
        <Link href={`/rooms/${room.id}`} className="small">← {room.name}</Link>
        <Heading size="xlarge">Setup · {room.name}</Heading>
      </div>
      {error && <SectionMessage appearance="error" title="Growlink API">{error}</SectionMessage>}
      <SetupForm
        roomId={room.id}
        mode={room.mode}
        wcSensors={wc.map((s) => ({ id: s.id, name: s.name, meta: s.moduleName ?? '' }))}
        ecSensors={ec.map((s) => ({ id: s.id, name: s.name, meta: s.moduleName ?? '' }))}
        devices={valves.map((d) => ({ id: d.id, name: d.name, meta: '', irrigation: IRRIGATION_DEVICE_TYPES.has(d.deviceType), deviceType: d.deviceType }))}
        initial={{
          wcSensorIds: room.wc_sensor_ids, ecSensorIds: room.ec_sensor_ids, valveIds: room.valve_ids,
          sequentialValves: room.sequential_valves, restState: room.rest_state,
          timezone: cfg.timezone, lightsOn: cfg.lightsOn, photoperiodHours: cfg.photoperiodHours,
          blockVolumeL: cfg.blockVolumeL, emitterFlowMlPerMin: cfg.emitterFlowMlPerMin, emittersPerBlock: cfg.emittersPerBlock,
          minShotSeconds: cfg.minShotSeconds, maxShotSeconds: cfg.maxShotSeconds, emergencyWcFloor: cfg.emergencyWcFloor,
          postToTasks: room.post_to_tasks, growerNotes: room.grower_notes ?? '',
        }}
        defaultFloor={emergencyFloor(room.phase)}
        isDemo={conn.kind === 'demo'}
      />
      <div className="card-flat row gap-200 spread wrap">
        <div className="stack"><b>Remove room</b><span className="small subtle">Deletes its history. Switch out of Live first.</span></div>
        <DeleteRoomButton roomId={room.id} />
      </div>
    </div>
  );
}
