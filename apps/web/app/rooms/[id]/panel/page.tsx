import { notFound } from 'next/navigation';
import { DateTime } from 'luxon';
import { PHASES, resolveTargets, dayInPhase, cycleInfo, DEFAULT_ROOM_CONFIG, defaultTuning, clampTuning } from '@gl-steering/core';
import { requireUser } from '@/lib/auth';
import { getRoom, roomDays, roomReviews } from '@/lib/data';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Dial, DayBar, type DaySegment } from '@/components/RoomVisuals';
import { NovaMark } from '@/components/ui';
import { PanelActions } from '@/components/PanelActions';
import { MODE_LABEL, PERIOD_LABEL, fmt } from '@/lib/format';

export const metadata = { title: 'Room panel — Growlink' };

/**
 * displayLINK wall view: one room, readable from across a hallway. Load it in the panel's kiosk browser:
 *   /rooms/<id>/panel            (follows the system theme)
 *   /rooms/<id>/panel?theme=dark (or light)
 */
export default async function PanelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const room = await getRoom(user.id, id);
  if (!room) notFound();
  const [days, reviews] = await Promise.all([roomDays(room.id), roomReviews(room.id, 3)]);

  const cfg = { ...DEFAULT_ROOM_CONFIG, ...room.config };
  const cycle = cycleInfo(new Date(), cfg);
  const dip = dayInPhase(cycle.cycleKey, room.phase_start_date, cfg.timezone);
  const targets = resolveTargets(room.phase, dip);
  const tuning = clampTuning(room.phase, { ...defaultTuning(room.phase), ...room.tuning });
  const s = room.status;
  const profile = PHASES[room.phase];
  const lastDay = days.find((d) => d.summary.odb != null)?.summary;
  const nova = (reviews as any[]).find((r) => r.source === 'ai' && !r.error);
  const now = Date.now();

  const on = s ? Date.parse(s.lightsOnAt) : cycle.lightsOnAt.toMillis();
  const off = s ? Date.parse(s.lightsOffAt) : cycle.lightsOffAt.toMillis();
  const p1 = s ? Date.parse(s.p1StartAt) : on + tuning.startDelayHours * 3_600_000;
  const stop = s ? Date.parse(s.lastShotDeadline) : off - tuning.stopBeforeLightsOffHours * 3_600_000;
  const segs: DaySegment[] = [
    { id: 'wait', label: 'Wait', from: on, to: p1 },
    { id: 'irrigate', label: 'P1 · P2', from: p1, to: stop },
    { id: 'P3', label: 'P3', from: stop, to: off },
    { id: 'night', label: 'Night', from: off, to: on + 86_400_000 },
  ];
  const active = !s || room.mode === 'off' ? null : s.period === 'P1' || s.period === 'P2' ? 'irrigate' : s.period === 'P3' ? 'P3' : now < p1 && now >= on ? 'wait' : 'night';
  const clock = DateTime.now().setZone(cfg.timezone).toFormat('HH:mm');
  const alert = room.last_error || (s && room.mode !== 'off' && !s.readingsFresh);

  return (
    <div className="panel-root">
      <AutoRefresh seconds={15} />
      <header className="panel-head">
        <span className="panel-room">{room.name}</span>
        <span className="subtle" style={{ fontSize: 20 }}>Phase {room.phase} · {profile.shortName} · day {dip}</span>
        <span className="grow" />
        <span className="room-pill" data-mode={room.mode} style={{ fontSize: 17, height: 48 }}>
          {room.mode === 'off' ? 'Autopilot off' : `Autopilot · ${MODE_LABEL[room.mode]}`}
          {room.paused && <span className="muted">Paused</span>}
        </span>
        <span className="panel-time num">{clock}</span>
      </header>

      {alert && (
        <div className="gl-notice gl-notice--danger" role="alert" style={{ fontSize: 20 }}>
          <span className="gl-notice-dot" aria-hidden="true" />
          <span>{room.last_error ?? 'Sensor data is stale — irrigation is on hold.'}</span>
        </div>
      )}

      <div className="panel-main">
        <Dial value={s?.wc ?? null} band={targets.dayWc} scale={{ min: Math.min(40, targets.dayWc.min - 15), max: Math.max(85, targets.dayWc.max + 15) }} label="Water content" />
        <div className="stack gap-300">
          <div className="panel-stats">
            <div className="stat"><span className="eyebrow">EC</span><span className="stat-value">{fmt(s?.ec)}</span><span className="stat-note">mS/cm · {targets.substrateEc.min}–{targets.substrateEc.max}</span></div>
            <div className="stat"><span className="eyebrow">Dry-back</span><span className="stat-value">{fmt(lastDay?.odb, 0)}<small>%</small></span><span className="stat-note">overnight · {targets.odb.min}–{targets.odb.max}</span></div>
            <div className="stat"><span className="eyebrow">Shots</span><span className="stat-value">{s?.shotsToday ?? 0}</span><span className="stat-note">of {tuning.maxShotsPerDay} today</span></div>
          </div>
          <div className="stat" style={{ gap: 16 }}>
            <div className="row gap-150 wrap" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 26, fontWeight: 500 }}>{s && room.mode !== 'off' ? PERIOD_LABEL[s.period] ?? s.period : 'Idle'}</span>
              <span className="subtle" style={{ fontSize: 20 }}>{s?.nextShotHint ?? ''}</span>
            </div>
            <DayBar segments={segs} now={now} active={active} />
          </div>
          {nova?.summary && (
            <div className="panel-nova"><NovaMark size={24} /><p>{nova.summary}</p></div>
          )}
        </div>
      </div>

      <footer className="panel-foot">
        <span className="panel-brand"><span className="brand-logo" aria-label="Growlink" role="img" /><span className="labs-tag">LABS</span><span className="small muted">Experimental</span></span>
        <span className="grow" />
        <PanelActions roomId={room.id} paused={room.paused} mode={room.mode} />
      </footer>
    </div>
  );
}
