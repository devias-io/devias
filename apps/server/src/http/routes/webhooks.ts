import { WebhookResultSchema } from '@devias/core';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { ModuleRuntime } from '../../runtime/module-runtime';
import type { AppEnv } from '../env';
import { errorResponses, jsonResponse } from './schemas';

/**
 * Where outside services deliver a module's events. There is no session: the signature in the headers, checked
 * with the stored webhook secret, authenticates the delivery, so this is a route and not an action.
 */
export const registerWebhookRoutes = (app: OpenAPIHono<AppEnv>, deps: { runtime: ModuleRuntime }) => {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/webhooks/{token}',
      summary: 'Receive a webhook',
      description:
        "The URL a module's connection shows as `webhookUrl`. The signature is checked with that connection's webhook secret; the body is stored as the event payload. Unknown tokens answer 404, failed checks 400. Not for clients.",
      tags: ['modules'],
      request: { params: z.object({ token: z.string() }) },
      responses: {
        200: jsonResponse(WebhookResultSchema, 'Stored'),
        400: errorResponses[400],
        404: errorResponses[404],
      },
    }),
    async (c) => {
      const body = await c.req.text();

      return c.json(
        await deps.runtime.receiveWebhook(c.req.valid('param').token, { headers: c.req.raw.headers, body }),
        200,
      );
    },
  );
};
