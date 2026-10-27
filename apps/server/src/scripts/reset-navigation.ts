import { createServer as createProbe } from 'node:net';
import { loadModules } from '@devias/server';
import deviasConfig from '../../../../devias.config';
import { createServer } from '../boot';
import { loadConfig } from '../config';

/**
 * Puts the sidebar of every workspace on this server back to its defaults: renames, hidden items and moves of a
 * module's items are dropped. Items a workspace created are kept. The same as "Reset navigation" in Settings → Navigation, for all workspaces at once.
 *
 *   pnpm --filter @devias/server-app navigation:reset          # every workspace
 *   pnpm --filter @devias/server-app navigation:reset <id> ... # only these workspaces
 *
 * With PGlite the dev server must be stopped first: it tolerates one process per data directory.
 */
const portTaken = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createProbe();
    probe.once('error', () => resolve(true));
    probe.listen(port, () => probe.close(() => resolve(false)));
  });

const main = async () => {
  const config = loadConfig();

  if (!config.databaseUrl && (await portTaken(config.port))) {
    console.error(
      `Port ${config.port} is in use: a server is probably running on the PGlite data directory. Stop it first.`,
    );
    process.exit(1);
  }

  const server = await createServer(config, { modules: await loadModules(deviasConfig, { from: import.meta.url }) });

  try {
    const only = process.argv.slice(2);
    const workspaces = only.length > 0 ? only : await server.engine.workspaces.list();

    for (const workspaceId of workspaces) {
      const ctx = { workspaceId, actor: { kind: 'system' as const, id: 'reset-navigation' }, role: null };
      const before = (await server.engine.metadata.getSchema(ctx)).navItems;
      await server.engine.metadata.navItems.resetAll(ctx);
      const changed = before.filter((item) => item.overrides !== null).length;
      console.log(`${workspaceId}: ${changed} item(s) reset`);
    }
  } finally {
    await server.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
