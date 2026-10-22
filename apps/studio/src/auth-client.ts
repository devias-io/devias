import { apiKeyClient } from '@better-auth/api-key/client';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { env } from './env';

/** The Better Auth client; the studio only sees it through `betterAuthAdapter`. */
export const authClient = createAuthClient({
  baseURL: env.apiUrl || window.location.origin,
  plugins: [organizationClient(), apiKeyClient()],
});
