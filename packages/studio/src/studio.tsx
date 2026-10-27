import { type AuthAdapter, type DeviasClient, resolveConfig, type StudioConfig } from '@devias/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { AuthProvider } from './providers/auth';
import { ClientFactoryProvider } from './providers/client';
import { StudioConfigProvider } from './providers/studio-config';
import { ThemeProvider } from './providers/theme';
import { createStudioRouter } from './router/create-router';

export interface StudioProps {
  config: StudioConfig;
  auth: AuthAdapter;
  /** Creates the data client for a workspace; called once per workspace the user opens. */
  createClient: (workspaceId: string) => DeviasClient;
  queryClient?: QueryClient;
}

export const createStudioQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });

/** The studio: resolves the config once, wires providers and renders the config-driven router. */
export function Studio({ config, auth, createClient, queryClient }: StudioProps) {
  const resolved = useMemo(() => resolveConfig(config), [config]);
  const client = useMemo(() => queryClient ?? createStudioQueryClient(), [queryClient]);
  const router = useMemo(
    () => createStudioRouter({ config: resolved, auth, queryClient: client }),
    [resolved, auth, client],
  );

  useEffect(() => {
    for (const diagnostic of resolved.diagnostics) {
      const log = diagnostic.level === 'error' ? console.error : console.warn;
      log(`[studio] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }, [resolved]);

  return (
    <StudioConfigProvider value={resolved}>
      <AuthProvider value={auth}>
        <ClientFactoryProvider value={createClient}>
          <QueryClientProvider client={client}>
            <ThemeProvider>
              <RouterProvider router={router} />
            </ThemeProvider>
          </QueryClientProvider>
        </ClientFactoryProvider>
      </AuthProvider>
    </StudioConfigProvider>
  );
}
