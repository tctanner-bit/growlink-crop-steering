export function ControllerBadge({ health }: { health: { age: number; is_leader: boolean; version: string; info: any } | null }) {
  const online = !!health && health.age <= 60;
  const tip = !health
    ? 'No controller has reported in. Rooms are not being steered.'
    : `Last heartbeat ${health.age}s ago · v${health.version} · AI ${health.info?.ai ? `${health.info.aiProvider ?? ''} ${health.info.model}`.trim() : 'off'}`;
  return (
    <span className="status-dot" data-tone={online ? undefined : 'danger'} title={tip} role="status">
      <span className="label">{online ? 'Controller online' : 'Controller offline'}</span>
    </span>
  );
}
