'use client';

import { useEffect } from 'react';
import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';

/** Keeps ADS tokens following the OS color mode after hydration. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void setGlobalTheme({ colorMode: 'auto', light: 'light', dark: 'dark', spacing: 'spacing', typography: 'typography', shape: 'shape' } as any);
  }, []);
  return <>{children}</>;
}
