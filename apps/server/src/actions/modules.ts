import { type Connection, moduleActions as mod } from '@devias/core';
import { type Action, type ActionDeps, implement } from './types';

/**
 * Module lifecycle (list, plan, apply, uninstall, the catalog) and what installed modules declare: connections to
 * their outside services (stored encrypted, tested when made), variables, actions and the events they delivered.
 */
export const moduleActions = ({ engine, registry, runtime, publicUrl }: ActionDeps): Action[] => {
  const origin = publicUrl.replace(/\/+$/, '');
  /** Connections travel with an absolute webhook URL, built from the server's public origin. */
  const withUrl = (connection: Connection): Connection => ({
    ...connection,
    webhookUrl: connection.webhookPath ? `${origin}${connection.webhookPath}` : null,
  });

  return [
    implement(mod.list, (_input, ctx) => engine.modules.list(ctx)),
    implement(mod.plan, ({ manifest }, ctx) => engine.modules.plan(ctx, manifest)),
    implement(mod.apply, ({ manifest, expectedPlanHash, allowDestructive }, ctx) =>
      engine.modules.apply(ctx, manifest, { expectedPlanHash, allowDestructive }),
    ),
    implement(mod.uninstall, ({ moduleId, allowDestructive }, ctx) =>
      engine.modules.uninstall(ctx, moduleId, { allowDestructive: allowDestructive === 'true' }),
    ),
    // Core modules are installed everywhere, so they are not offered.
    implement(mod.catalog, async () =>
      registry
        .list()
        .map((module) => module.manifest)
        .filter((m) => !m.core),
    ),
    implement(mod.listConnections, async (query, ctx) => {
      const list = await runtime.listConnections(ctx, query);

      return { ...list, connections: list.connections.map(withUrl) };
    }),
    implement(mod.getConnection, async ({ id }, ctx) => withUrl(await engine.connections.get(ctx, id))),
    implement(mod.createConnection, async (input, ctx) => withUrl(await runtime.connect(ctx, input))),
    implement(mod.updateConnection, async ({ id, ...patch }, ctx) => withUrl(await runtime.update(ctx, id, patch))),
    implement(mod.authorizeConnection, (input, ctx) => runtime.authorize(ctx, input)),
    implement(mod.testConnection, ({ id }, ctx) => runtime.testAs(ctx, id)),
    implement(mod.disconnect, ({ id }, ctx) => runtime.disconnect(ctx, id)),
    implement(mod.listVariables, ({ moduleId }, ctx) => runtime.variables(ctx, moduleId)),
    implement(mod.updateVariables, ({ moduleId, ...patch }, ctx) => runtime.updateVariables(ctx, moduleId, patch)),
    implement(mod.listEvents, ({ moduleId, ...query }, ctx) => engine.moduleEvents.list(ctx, moduleId, query)),
    implement(mod.listJobs, (query, ctx) => engine.jobs.list(ctx, query)),
    implement(mod.getJob, ({ id }, ctx) => engine.jobs.get(ctx, id)),
    implement(mod.retryJob, ({ id }, ctx) => engine.jobs.retry(ctx, id)),
  ];
};
