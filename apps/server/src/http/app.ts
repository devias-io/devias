import type { AiService } from '@devias/ai';
import { ActorSchema, ChatEventSchema, QuerySchema, WorkspaceEventSchema } from '@devias/core';
import type { DataEngine, Logger } from '@devias/data-engine';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import type { ActionRegistry } from '../actions/registry';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { DbHandle } from '../db/client';
import type { ModuleRuntime } from '../runtime/module-runtime';
import type { ModuleRegistry } from '../runtime/registry';
import { createSseHub } from '../sse/hub';
import type { AppEnv } from './env';
import { errorBody, toErrorResponse } from './errors';
import { createActorMiddleware } from './middleware/actor';
import { createWorkspaceMiddleware } from './middleware/workspace';
import { mountActions } from './mount-actions';
import { registerAiRoutes } from './routes/ai';
import { registerCoreRoutes } from './routes/core';
import { registerEventRoutes } from './routes/events';
import { registerLogoRoutes } from './routes/logos';
import { registerModuleRouters } from './routes/mod';
import { registerOAuthRoutes } from './routes/oauth';
import { registerWebhookRoutes } from './routes/webhooks';

export interface AppDeps {
  auth: Auth;
  engine: DataEngine;
  db: DbHandle;
  registry: ModuleRegistry;
  runtime: ModuleRuntime;
  ai: AiService;
  actions: ActionRegistry;
  config: Pick<ServerConfig, 'studioOrigin' | 'authUrl'>;
  logger: Logger;
}

export const OPENAPI_CONFIG: Parameters<OpenAPIHono['getOpenAPI31Document']>[0] = {
  openapi: '3.1.0',
  info: {
    title: 'Devias API',
    version: '0.0.0',
    description: 'Metadata-driven operations platform: records, metadata, modules, workflows and a change feed.',
  },
  security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
};

export const createApp = (deps: AppDeps) => {
  const { auth, engine, db, registry, runtime, ai, actions, config, logger } = deps;
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody('VALIDATION', `Invalid ${result.target}`, {
            issues: result.error.issues.map((i) => ({
              path: i.path.map(String).join('.'),
              code: i.code,
              message: i.message,
            })),
          }),
          400,
        );
      }
    },
  });

  // Canonical core schemas that routes reference only indirectly, so SDK codegen gets them by name.
  // `.meta()` returns a fresh clone: core's schemas predate the zod-openapi prototype module and
  // zod 4 copies prototype methods onto instances at construction time.
  app.openAPIRegistry.register('Query', QuerySchema.meta({ id: 'Query' }));
  app.openAPIRegistry.register('WorkspaceEvent', WorkspaceEventSchema.meta({ id: 'WorkspaceEvent' }));
  app.openAPIRegistry.register('Actor', ActorSchema.meta({ id: 'Actor' }));
  app.openAPIRegistry.register('ChatEvent', ChatEventSchema.meta({ id: 'ChatEvent' }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Better Auth session cookie',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
    description: 'Workspace api key',
  });

  app.use(
    '/api/*',
    cors({
      origin: config.studioOrigin,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'If-None-Match', 'Last-Event-ID'],
      exposeHeaders: ['ETag', 'Content-Length'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.onError((error, c) => {
    const { status, body } = toErrorResponse(error, (message, meta) => logger.error(message, meta));

    return c.json(body, status);
  });
  app.notFound((c) => c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404));

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.doc31('/api/openapi.json', OPENAPI_CONFIG);

  const actor = createActorMiddleware(auth);
  const workspace = createWorkspaceMiddleware(db, engine);
  app.use('/api/me', actor);
  app.use('/api/workspaces', actor);
  app.use('/api/workspaces/:workspaceId', actor, workspace);
  app.use('/api/workspaces/:workspaceId/*', actor, workspace);

  registerCoreRoutes(app, {
    auth,
    db,
    dbKind: db.kind,
    ensureWorkspace: (id) => engine.workspaces.ensureInitialized(id),
  });
  mountActions(app, actions);
  registerEventRoutes(app, engine, createSseHub({ engine, logger }));
  registerWebhookRoutes(app, { runtime });
  registerOAuthRoutes(app, {
    runtime,
    studioOrigin: config.studioOrigin,
    sessionUserId: async (headers) => (await auth.api.getSession({ headers }))?.user.id ?? null,
  });
  registerLogoRoutes(app, { registry });
  registerAiRoutes(app, { ai, logger });
  registerModuleRouters(app, { engine, registry });

  return app;
};

export type App = ReturnType<typeof createApp>;
