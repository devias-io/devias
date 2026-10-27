import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModules } from '@devias/server';
import deviasConfig from '../../../../devias.config';
import { createServer } from '../boot';
import { loadConfig } from '../config';
import { OPENAPI_CONFIG } from '../http/app';

/**
 * Writes the two OpenAPI documents from the route registry; no HTTP server needed.
 *
 * - `apps/server/openapi.json` is the core API alone: the SDK's types are generated from it, so the SDK (and the
 *   packages) know no module.
 * - `apps/server/openapi.with-modules.json` also includes the routes of the modules in `devias.config.ts`. It is the
 *   document the documentation publishes as the API reference.
 */
const documentOf = async (modules: Parameters<typeof createServer>[1]['modules']) => {
  const config = loadConfig({ BETTER_AUTH_SECRET: 'x'.repeat(40), MIGRATE_ON_BOOT: 'true' });
  const server = await createServer(config, { modules, pgliteDataDir: 'memory://' });

  try {
    return server.app.getOpenAPI31Document(OPENAPI_CONFIG);
  } finally {
    await server.close();
  }
};

const main = async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const core = await documentOf([]);
  const withModules = await documentOf(await loadModules(deviasConfig, { from: import.meta.url }));
  const targets: [string, typeof core][] = [
    [path.resolve(here, '../../openapi.json'), core],
    [path.resolve(here, '../../openapi.with-modules.json'), withModules],
  ];

  for (const [target, document] of targets) {
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`wrote ${target} (${Object.keys(document.paths ?? {}).length} paths)`);
  }

  // Keep the committed documents in the repo's Biome format so `pnpm lint` stays clean after an export.
  const biome = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
  execFileSync(process.execPath, [biome, 'format', '--write', ...targets.map(([target]) => target)], {
    stdio: 'inherit',
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
