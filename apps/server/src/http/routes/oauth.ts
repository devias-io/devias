import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { type ModuleRuntime, OAUTH_CALLBACK_PATH, type OAuthOutcome } from '../../runtime/module-runtime';
import type { AppEnv } from '../env';

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A page for consents started in a window of their own (the agent's card): it says how it went and closes. */
const page = (outcome: OAuthOutcome): string => {
  const title = outcome.ok ? 'Connected' : 'Not connected';
  const text = outcome.ok
    ? `${outcome.module.label} is connected${outcome.connection.account ? ` as ${outcome.connection.account}` : ''}. You can close this window.`
    : outcome.message;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}}</style></head>
<body><h1>${title}</h1><p>${escapeHtml(text)}</p>${outcome.ok ? '<script>setTimeout(()=>window.close(),1500)</script>' : ''}</body></html>`;
};

/**
 * Where OAuth providers send people back after consent. One fixed URL for every module and provider, since services
 * need the redirect URI registered as is; the stored state names the workspace, the module and the provider. The
 * person must be signed in as whoever started the consent. It ends on the studio page the consent started from, or on
 * a small page that closes itself.
 */
export const registerOAuthRoutes = (
  app: OpenAPIHono<AppEnv>,
  deps: { runtime: ModuleRuntime; studioOrigin: string; sessionUserId: (headers: Headers) => Promise<string | null> },
) => {
  app.openapi(
    createRoute({
      method: 'get',
      path: OAUTH_CALLBACK_PATH,
      summary: 'Finish connecting an account',
      description:
        'The redirect URI to register with an OAuth provider. It checks the state, exchanges the code, stores the connection and sends the person back to the studio. Not for clients.',
      tags: ['modules'],
      request: {
        query: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
          error_description: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'How it went, for a window that closes itself',
          content: { 'text/html': { schema: z.string() } },
        },
        302: { description: 'Back to the studio page the consent started from' },
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const outcome = await deps.runtime.completeOAuth({
        code: query.code,
        state: query.state,
        error: query.error,
        errorDescription: query.error_description,
        userId: await deps.sessionUserId(c.req.raw.headers),
      });
      const studio = new URL(deps.studioOrigin);
      const target = outcome.returnTo ? new URL(outcome.returnTo, studio) : null;

      // Only ever back to the studio, whatever the stored path says.
      if (target && target.origin === studio.origin) {
        target.searchParams.set('oauth', outcome.ok ? 'connected' : 'failed');

        if (outcome.ok) {
          target.searchParams.set('module', outcome.connection.moduleId);
        } else {
          target.searchParams.set('message', outcome.message);
        }

        return c.redirect(target.toString(), 302);
      }

      return c.html(page(outcome), 200);
    },
  );
};
