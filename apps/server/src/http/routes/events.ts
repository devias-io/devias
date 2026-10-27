import { authorize, type DataEngine } from '@devias/data-engine';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { SseHub } from '../../sse/hub';
import type { AppEnv } from '../env';

/** GET /api/workspaces/:workspaceId/events?after=<sequence> — SSE stream (documented, not generated: it is not JSON). */
export const registerEventRoutes = (app: OpenAPIHono<AppEnv>, engine: DataEngine, hub: SseHub) => {
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/api/workspaces/{workspaceId}/events',
    summary: 'Subscribe to the change feed',
    tags: ['events'],
    security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
    request: {},
    responses: {
      200: {
        description:
          'text/event-stream. First `event: ready` with `{"sequence"}`, then events after `after` (or `Last-Event-ID`), then live events; each has `id: <sequence>` and `event: <type>`.',
      },
    },
  });

  app.get('/api/workspaces/:workspaceId/events', (c) => {
    const ctx = c.get('ctx');
    authorize(ctx, 'event.read');
    const lastEventId = c.req.header('last-event-id');
    const raw = lastEventId ?? c.req.query('after');
    const after =
      raw !== undefined && raw !== '' && Number.isFinite(Number(raw))
        ? Math.max(0, Math.trunc(Number(raw)))
        : undefined;

    return hub.handle(c, ctx, after);
  });

  void engine;
};
