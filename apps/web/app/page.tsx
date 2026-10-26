import Link from 'next/link';
import { PHASES, resolveTargets, dayInPhase, cycleInfo, DEFAULT_ROOM_CONFIG } from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { listConnections, listRooms, Room } from '@/lib/data';
import { Heading, Lozenge, LinkButton, SectionMessage } from '@/components/ak';
import { BandBar } from '@/components/BandBar';
import { DemoFarmButton } from '@/components/DemoFarmButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { MODE_APPEARANCE, MODE_LABEL, PERIOD_LABEL, fmt, ago } from '@/lib/format';

export default async function RoomsPage() {
  const user = await requireUser();
  const [connections, rooms] = await Promise.all([listConnections(user.id), listRooms(user.id)]);

  if (!connections.length) {
    return (
      <div className="stack gap-300" style={{ maxWidth: 720 }}>
        <Heading size="xlarge">Crop Steering Autopilot</Heading>
        <p className="subtle" style={{ font: 'var(--ds-font-body-large)' }}>
          Grodan 5-Phase steering for stonewool blocks — P1 ramp, P2 maintenance and overnight dry-back — run against your
          Growlink sensors and valves, tuned every night by Nova.
        </p>
        <div className="row gap-150 wrap">
          <LinkButton appearance="primary" href="/connect">Connect Growlink</LinkButton>
          <DemoFarmButton />
        </div>
        <SectionMessage appearance="information" title="How it works">
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Paste your Growlink API key (Builder → Authentication). It is encrypted at rest and never sent back to the browser.</li>
            <li>Import rooms and map substrate WC/EC sensors and irrigation valves.</li>
            <li>Start in <b>Shadow</b> — the autopilot decides but your existing program irrigates. Go <b>Live</b> when the decisions look right.</li>
          </ol>
        </SectionMessage>
      </div>
    );
  }

  const byConn = connections.map((c) => ({ c, rooms: rooms.filter((r) => r.connection_id === c.id) }));
  return (
    <div className="stack gap-400">
      <AutoRefresh seconds={20} />
      <div className="row spread gap-200 wrap">
        <Heading size="xlarge">Rooms</Heading>
        <div className="row gap-100">
          {!connections.some((c) => c.kind === 'demo') && <DemoFarmButton subtle />}
          <LinkButton href="/connect">Add connection</LinkButton>
        </div>
      </div>
      {byConn.map(({ c, rooms }) => (
        <section key={c.id} className="stack gap-200">
          <div className="row gap-150 wrap">
            <Heading size="small" as="h2">{c.label}</Heading>
            <span className="muted small">{c.org_name}{c.key_last4 ? ` · key ••••${c.key_last4}` : ''}</span>
            {c.kind === 'demo' && <Lozenge appearance="new">Simulated</Lozenge>}
            {c.status === 'error' && <Lozenge appearance="removed">API error</Lozenge>}
            <span className="grow" />
            <Link href={`/connections/${c.id}`} className="small">Manage rooms</Link>
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
  return (
    <Link href={`/rooms/${room.id}`} className="card card-link">
      <div className="stack gap-150">
        <div className="row gap-100">
          <span style={{ font: 'var(--ds-font-heading-small)' }} className="grow">{room.name}</span>
          {room.paused && <Lozenge appearance="moved">Paused</Lozenge>}
          <Lozenge appearance={MODE_APPEARANCE[room.mode]} isBold={room.mode === 'live'}>{MODE_LABEL[room.mode]}</Lozenge>
        </div>
        <div className="subtle small">
          Phase {room.phase} · {PHASES[room.phase].name} · day {dip}
          {room.mode !== 'off' && s ? ` · ${PERIOD_LABEL[s.period] ?? s.period}` : ''}
        </div>
        {!configured ? (
          <div className="muted small">Not set up — map sensors and valves to start.</div>
        ) : room.mode === 'off' || !s ? (
          <div className="muted small">Autopilot off.</div>
        ) : (
          <>
            <div className="row gap-300">
              <div className="stack">
                <span className="eyebrow">Water content</span>
                <span><span className="metric">{fmt(s.wc)}</span><span className="metric-unit">%</span></span>
              </div>
              <div className="stack">
                <span className="eyebrow">Substrate EC</span>
                <span><span className="metric">{fmt(s.ec)}</span><span className="metric-unit">mS/cm</span></span>
              </div>
              <div className="stack">
                <span className="eyebrow">Shots today</span>
                <span className="metric">{s.shotsToday}</span>
              </div>
            </div>
            <div>
              <div className="row spread small subtle"><span>Day-level WC target {targets.dayWc.min}–{targets.dayWc.max}%</span>{s.valveOpen && <Lozenge appearance="inprogress">Irrigating</Lozenge>}</div>
              <BandBar value={s.wc} band={targets.dayWc} scale={{ min: 30, max: 90 }} />
            </div>
            <div className="small subtle">{s.nextShotHint}</div>
            {(room.last_error || !s.readingsFresh) && (
              <div className="small" style={{ color: 'var(--ds-text-warning)' }}>
                {room.last_error ?? 'Sensor data is stale.'} · last tick {ago(room.last_tick_at)}
              </div>
            )}
          </>
        )}
      </div>
    </Link>
  );
}
