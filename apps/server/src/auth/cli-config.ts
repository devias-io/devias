import { drizzle } from 'drizzle-orm/pglite';
import { createAuth } from './auth';

/** Config consumed only by the Better Auth CLI (`pnpm --filter @devias/server-app auth:generate`). */
export const auth = createAuth({
  db: drizzle.mock(),
  schema: {},
  config: { baseURL: 'http://localhost:3000', secret: 'cli-only-secret-not-used-at-runtime-0000', trustedOrigins: [] },
});
