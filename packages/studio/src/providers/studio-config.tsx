import type { ResolvedStudioConfig } from '@devias/core';
import { createContext, useContext } from 'react';

const StudioConfigContext = createContext<ResolvedStudioConfig | null>(null);

export const StudioConfigProvider = StudioConfigContext.Provider;

/** The resolved studio config (registries, structure, manifests, diagnostics). Resolved once at boot. */
export const useStudioConfig = (): ResolvedStudioConfig => {
  const value = useContext(StudioConfigContext);

  if (!value) {
    throw new Error('useStudioConfig must be used inside <Studio>');
  }

  return value;
};
