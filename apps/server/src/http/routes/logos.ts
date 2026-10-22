import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { moduleLogoType } from '@devias/core';
import { logoFileOf } from '@devias/server';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { ModuleRegistry } from '../../runtime/registry';
import type { AppEnv } from '../env';
import { errorResponses } from './schemas';

/** Asked again every time, so a replaced logo shows at once; the ETag makes that a cheap 304. */
const CACHE = 'public, no-cache';

/**
 * The logo of a module the server loaded, whether or not a workspace has installed it (the catalog shows logos before
 * an install). It needs no session: an `<img>` cannot send credentials across origins, and a module's brand image is
 * not workspace data. The file is found from the module's own manifest, never from the request, and is checked again
 * as it is read. Not an action: it is not a workspace route and has no agent counterpart.
 */
export const registerLogoRoutes = (app: OpenAPIHono<AppEnv>, deps: { registry: ModuleRegistry }) => {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/modules/{moduleId}/logo',
      summary: "A module's logo",
      description:
        'The image the module declares as its `logo`, served from its package. Public. 404 when the module is unknown or declares none. Not for clients to build: the studio shows it where a module is listed.',
      tags: ['modules'],
      request: { params: z.object({ moduleId: z.string() }) },
      responses: {
        200: {
          description: 'The image',
          content: {
            'image/svg+xml': { schema: z.string() },
            'image/png': { schema: z.string() },
            'image/webp': { schema: z.string() },
          },
        },
        304: { description: 'Unchanged since the ETag the request sent' },
        404: errorResponses[404],
      },
    }),
    (c) => {
      const module = deps.registry.get(c.req.valid('param').moduleId);
      const logo = module?.manifest.logo;
      const type = logo ? moduleLogoType(logo) : undefined;

      if (!module || !logo || !type || !module.directory) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'This module has no logo' } }, 404);
      }

      let bytes: Buffer;

      try {
        bytes = readFileSync(logoFileOf(module.manifest.id, module.directory, logo));
      } catch {
        return c.json({ error: { code: 'NOT_FOUND', message: 'This module has no logo' } }, 404);
      }

      const etag = `"${createHash('sha1').update(bytes).digest('hex')}"`;
      const headers = {
        'Content-Type': type,
        ETag: etag,
        'Cache-Control': CACHE,
        'X-Content-Type-Options': 'nosniff',
        // An SVG opened on its own runs nothing: no script, no outside request.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      };

      if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, headers);
      }

      return c.body(new Uint8Array(bytes), 200, headers);
    },
  );
};
