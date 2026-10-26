'use client';

import Lozenge from '@atlaskit/lozenge';
import Tooltip from '@atlaskit/tooltip';

export function ControllerBadge({ health }: { health: { age: number; is_leader: boolean; version: string; info: any } | null }) {
  if (!health) return <Tooltip content="No controller has reported in. Rooms are not being steered."><Lozenge appearance="removed" isBold>Controller offline</Lozenge></Tooltip>;
  const stale = health.age > 60;
  const tip = `Last heartbeat ${health.age}s ago · v${health.version} · AI ${health.info?.ai ? health.info.model : 'off'}`;
  return (
    <Tooltip content={tip}>
      {stale ? <Lozenge appearance="removed" isBold>Controller offline</Lozenge> : <Lozenge appearance="success">Controller online</Lozenge>}
    </Tooltip>
  );
}
