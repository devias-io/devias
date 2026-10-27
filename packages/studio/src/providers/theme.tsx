import { applyTheme, getTheme } from '@devias/ui';
import { type ReactNode, useEffect } from 'react';

/** Applies the persisted theme on mount (the app's inline script already avoided the flash). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme(getTheme());
  }, []);

  return <>{children}</>;
}
