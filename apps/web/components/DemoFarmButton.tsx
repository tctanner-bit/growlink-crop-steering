'use client';

import { Button } from '@/components/ui';
import { useTransition } from 'react';
import { createDemoFarm } from '@/app/actions';

export function DemoFarmButton({ subtle }: { subtle?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button appearance={subtle ? 'subtle' : 'default'} isLoading={pending} onClick={() => start(() => createDemoFarm())}>
      Try the demo farm
    </Button>
  );
}
