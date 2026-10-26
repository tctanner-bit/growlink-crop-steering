'use client';

import { useTransition } from 'react';
import Button from '@atlaskit/button/new';
import { createDemoFarm } from '@/app/actions';

export function DemoFarmButton({ subtle }: { subtle?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button appearance={subtle ? 'subtle' : 'default'} isLoading={pending} onClick={() => start(() => createDemoFarm())}>
      Try the demo farm
    </Button>
  );
}
