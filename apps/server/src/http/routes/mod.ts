import { type DataEngine, EngineError, scopeEngine } from '@devias/data-engine';
import type { ModuleRouteEnv } from '@devias/server';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import type { ModuleRegistry } from '../../runtime/registry';
import type { AppEnv } from '../env';
import { HttpError } from '../errors';

/**
 * `/api/workspaces/:workspaceId/mod/:moduleId/*`: every registered server side gets a router that runs as the
 * caller (same EngineContext) and serves the module's `routes`.
 */
export const registerModuleRouters = (
  app: OpenAPIHono<AppEnv>,
  deps: { engine: DataEngine; registry: ModuleRegistry },
) => {
  for (const module of deps.registry.list()) {
    const moduleId = module.manifest.id;
    const router = new Hono<ModuleRouteEnv & AppEnv>();

    router.use('*', async (c, next) => {
      const ctx = c.get('ctx');
      const snapshot = await deps.engine.metadata.getSnapshot(ctx.workspaceId);

      if (!snapshot.schema.modules.some((e) => e.moduleId === moduleId)) {
        throw new HttpError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
      }

      c.set('workspaceId', ctx.workspaceId);
      c.set('actor', ctx.actor);
      c.set('engine', scopeEngine(deps.engine, ctx));
      await next();
    });

    module.routes?.(router as unknown as Hono<ModuleRouteEnv>);

    app.route(`/api/workspaces/:workspaceId/mod/${moduleId}`, router);
  }

  app.all('/api/workspaces/:workspaceId/mod/:moduleId/*', (c) => {
    throw new EngineError('NOT_FOUND', `Module "${c.req.param('moduleId')}" is not registered on this server`);
  });
  app.all('/api/workspaces/:workspaceId/mod/:moduleId', (c) => {
    throw new EngineError('NOT_FOUND', `Module "${c.req.param('moduleId')}" is not registered on this server`);
  });
};
