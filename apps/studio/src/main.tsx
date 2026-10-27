import '@devias/ui/fonts';
import './styles.css';

import { manifests } from 'virtual:devias/modules';
import type { AuthAdapter, DeviasClient } from '@devias/core';
import { createClient } from '@devias/sdk';
import { createMockAuthAdapter, createMockClient, MOCK_TEAMMATES } from '@devias/sdk/mock';
import { betterAuthAdapter, Studio } from '@devias/studio';
import { Toaster } from '@devias/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authClient } from './auth-client';
import { env } from './env';
import { studioConfig } from './studio.config';

/** Like the server, the mock backend starts workspaces with the core modules and offers the rest in its catalog. */
const installed = manifests.filter((manifest) => manifest.core);
const catalog = manifests.filter((manifest) => !manifest.core);

const auth: AuthAdapter = env.mock
  ? createMockAuthAdapter({ teammates: MOCK_TEAMMATES })
  : betterAuthAdapter(authClient, { baseUrl: env.apiUrl });

/** The mock workspace's people, so notifications to roles, users or everyone reach the teammates too. */
const members = [
  { id: 'user_dev', role: 'owner' as const },
  ...MOCK_TEAMMATES.map((teammate) => ({ id: teammate.id, role: 'member' as const })),
];

const clientFor = (workspaceId: string): DeviasClient =>
  env.mock
    ? createMockClient({ workspaceId, manifests: installed, catalog, members })
    : createClient({ baseUrl: env.apiUrl, workspaceId, credentials: 'include' });

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <Studio config={studioConfig} auth={auth} createClient={clientFor} />
    <Toaster />
  </StrictMode>,
);
