import type { DeviasClient } from '@devias/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type ClientFactory = (workspaceId: string) => DeviasClient;

const ClientFactoryContext = createContext<ClientFactory | null>(null);
const ClientContext = createContext<DeviasClient | null>(null);

export const ClientFactoryProvider = ClientFactoryContext.Provider;

/** One `DeviasClient` per workspace, memoized on the workspace id. */
export function ClientProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const factory = useContext(ClientFactoryContext);

  if (!factory) {
    throw new Error('ClientProvider must be used inside <Studio>');
  }

  const client = useMemo(() => factory(workspaceId), [factory, workspaceId]);

  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** Provide an already-created client (tests, embedded usage). */
export const ClientValueProvider = ClientContext.Provider;

export const useClient = (): DeviasClient => {
  const value = useContext(ClientContext);

  if (!value) {
    throw new Error('useClient must be used inside a workspace route');
  }

  return value;
};
