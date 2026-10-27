import { createServer as createProbe } from 'node:net';
import { loadModules } from '@devias/server';
import { serve } from '@hono/node-server';
import deviasConfig from '../../../devias.config';
import { createServer } from './boot';
import { loadConfig } from './config';

/**
 * PGlite tolerates one process per data directory, and the database is opened before the HTTP port is bound:
 * a second server started by mistake would damage the first one's data before failing on the port. Check the port first.
 */
const assertPortFree = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      probe.close();
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use; is another devias server running? Not opening the database.`)
          : error,
      );
    });
    probe.listen(port, () => probe.close(() => resolve()));
  });

const main = async () => {
  const config = loadConfig();
  await assertPortFree(config.port);
  const server = await createServer(config, {
    modules: await loadModules(deviasConfig, { from: import.meta.url }),
    startTriggers: true,
  });
  const { logger } = server;
  const http = serve({ fetch: server.app.fetch, port: config.port }, (info) => {
    logger.info(`devias server listening on http://localhost:${info.port} (${server.db.kind})`);
  });
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received; shutting down`);
    http.close();
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
