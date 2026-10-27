import Link from 'next/link';
import { PHASES, resolveTargets, dayInPhase, cycleInfo, DEFAULT_ROOM_CONFIG } from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { listConnections, listRooms, Room } from '@/lib/data';
import { Heading, Lozenge, LinkButton, SectionMessage } from '@/components/ui';
import { BandBar } from '@/components/BandBar';
import { DemoFarmButton } from '@/components/DemoFarmButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { MODE_APPEARANCE, MODE_LABEL, PERIOD_LABEL, fmt, ago } from '@/lib/format';

export default async function RoomsPage() {
  const user = await requireUser();
  const [connections, rooms] = await Promise.all([listConnections(user.id), listRooms(user.id)]);

  if (!connections.length) {
    return (
      <div className="stack gap-500">
        <div className="hero-intro">
          <span className="eyebrow">Growlink Labs · Autosteer AI</span>
          <h1>Your rock wool program, steered every 30 seconds.</h1>
          <p>P1 ramp, P2 maintenance and overnight dry-back, run against your Growlink sensors and valves, and retuned every night by Nova.</p>
          <div className="row gap-150 wrap">
            <LinkButton appearance="primary" href="/connect">Connect Growlink</LinkButton>
            <DemoFarmButton />
          </div>
        </div>
        <div className="steps">
          <div className="step"><span className="step-n">01</span><b>Connect</b><span className="small subtle">Paste your Growlink API key (Builder → Authentication). It is encrypted at rest and never sent back to the browser.</span></div>
          <div className="step"><span className="step-n">02</span><b>Map the room</b><span className="small subtle">Import rooms, then pick substrate WC/EC sensors and irrigation valves.</span></div>
          <div className="step"><span className="step-n">03</span><b>Shadow, then Live</b><span className="small subtle">Shadow decides while your program irrigates. Go Live when the decisions look right.</span></div>
        </div>
      </div>
    );
  }

  const byConn = connections.map((c) => ({ c, rooms: rooms.filter((r) => r.connection_id === c.id) }));
  return (
    <div className="stack gap-500">
      <AutoRefresh seconds={20} />
      <div className="row gap-200 wrap">
        <Heading size="xlarge">Rooms</Heading>
        <span className="grow" />
        <div className="row gap-100 wrap">
          {!connections.some((c) => c.kind === 'demo') && <DemoFarmButton subtle />}
          <LinkButton href="/connect">Add connection</LinkButton>
        </div>
      </div>
      {byConn.map(({ c, rooms }) => (
        <section key={c.id} className="stack gap-200" aria-label={c.label}>
          <div className="row gap-150 wrap">
            <Heading size="small" as="h2">{c.label}</Heading>
            <span className="small muted">{c.org_name}{c.key_last4 ? ` · key ••••${c.key_last4}` : ''}</span>
            {c.kind === 'demo' && <Lozenge appearance="new">Simulated</Lozenge>}
            {c.status === 'error' && <Lozenge appearance="removed">API error</Lozenge>}
            <span className="grow" />
            <Link href={`/connections/${c.id}`} className="small subtle">Manage rooms</Link>
          </div>
          {c.status === 'error' && c.last_error && <SectionMessage appearance="error">{c.last_error}</SectionMessage>}
          {rooms.length === 0 ? (
            <div className="card-flat subtle">No rooms imported yet. <Link href={`/connections/${c.id}`}>Import rooms</Link>.</div>
          ) : (
            <div className="grid-rooms">{rooms.map((r) => <RoomCard key={r.id} room={r} />)}</div>
          )}
        </section>
      ))}
    </div>
  );
}

function RoomCard({ room }: { room: Room }) {
  const cfg = { ...DEFAULT_ROOM_CONFIG, ...room.config };
  const ci = cycleInfo(new Date(), cfg);
  const dip = dayInPhase(ci.cycleKey, room.phase_start_date, cfg.timezone);
  const targets = resolveTargets(room.phase, dip);
  const s = room.status;
  const configured = room.wc_sensor_ids.length > 0;
  const on = room.mode !== 'off' && !!s;
  return (
    <Link href={`/rooms/${room.id}`} className="room-card" aria-label={`${room.name}, ${MODE_LABEL[room.mode]}`}>
      <div className="row gap-100">
        <span className="gl-h3 grow">{room.name}</span>
        {room.paused && <Lozenge appearance="moved">Paused</Lozenge>}
        {s?.valveOpen && <Lozenge appearance="new">Irrigating</Lozenge>}
        <Lozenge appearance={MODE_APPEARANCE[room.mode]} isBold={room.mode === 'live'}>{MODE_LABEL[room.mode]}</Lozenge>
      </div>
      <span className="small muted">Phase {room.phase} · {PHASES[room.phase].shortName} · day {dip}{on ? ` · ${PERIOD_LABEL[s!.period] ?? s!.period}` : ''}</span>
      {!configured ? (
        <span className="subtle small">Not set up — map sensors and valves to start.</span>
      ) : !on ? (
        <span className="subtle small">Autopilot off.</span>
      ) : (
        <>
          <div className="row gap-300" style={{ alignItems: 'flex-end' }}>
            <div className="stack gap-050">
              <span className="eyebrow">Water content</span>
              <span className="room-card-big">{fmt(s!.wc)}<small>%</small></span>
            </div>
            <div className="stack gap-050">
              <span className="eyebrow">EC</span>
              <span className="stat-value" style={{ fontSize: 32 }}>{fmt(s!.ec)}</span>
            </div>
            <div className="stack gap-050">
              <span className="eyebrow">Shots</span>
              <span className="stat-value" style={{ fontSize: 32 }}>{s!.shotsToday}</span>
            </div>
          </div>
          <div>
            <BandBar value={s!.wc} band={targets.dayWc} scale={{ min: 30, max: 90 }} />
            <div className="row spread small muted" style={{ marginTop: 10 }}><span>Target {targets.dayWc.min}–{targets.dayWc.max}%</span><span>{s!.nextShotHint}</span></div>
          </div>
          {(room.last_error || !s!.readingsFresh) && (
            <span className="small warn-text">{room.last_error ?? 'Sensor data is stale.'} · last tick {ago(room.last_tick_at)}</span>
          )}
        </>
      )}
    </Link>
  );
}
