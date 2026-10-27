import type { MiddlewareHandler } from 'hono';
import type { Auth } from '../../auth/auth';
import type { AppEnv, Principal } from '../env';
import { HttpError } from '../errors';

const DEFAULT_PERMISSIONS: Record<string, string[]> = { record: ['read'] };

/**
 * Establishes the caller: `x-api-key` header → organization-owned api key; otherwise the Better Auth
 * session cookie. Anything else is 401.
 */
export const createActorMiddleware =
  (auth: Auth): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const apiKey = c.req.header('x-api-key');

    if (apiKey) {
      let result: Awaited<ReturnType<typeof auth.api.verifyApiKey>>;

      try {
        result = await auth.api.verifyApiKey({ body: { key: apiKey } });
      } catch (error) {
        throw new HttpError('UNAUTHORIZED', error instanceof Error ? error.message : 'Invalid api key');
      }

      if (!result.valid || !result.key) {
        const code = result.error?.code;

        if (code === 'RATE_LIMITED') {
          throw new HttpError('RATE_LIMITED', 'Api key rate limit exceeded');
        }

        const message = result.error?.message;

        throw new HttpError('UNAUTHORIZED', typeof message === 'string' && message ? message : 'Invalid api key');
      }

      const key = result.key;
      const principal: Principal = {
        kind: 'api_key',
        keyId: key.id,
        workspaceId: key.referenceId,
        permissions: key.permissions ?? DEFAULT_PERMISSIONS,
      };
      c.set('principal', principal);

      return next();
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      throw new HttpError('UNAUTHORIZED', 'Sign in or provide an api key');
    }

    const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    const principal: Principal = {
      kind: 'user',
      userId: session.user.id,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      activeOrganizationId: active,
    };
    c.set('principal', principal);

    return next();
  };
