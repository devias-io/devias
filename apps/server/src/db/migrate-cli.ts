import { loadConfig } from '../config';
import { createDb } from './client';
import { runMigrations } from './migrate';

/** `pnpm --filter @devias/server-app db:migrate` — apply pending migrations to the configured database. */
const main = async () => {
  const config = loadConfig();
  const handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });

  try {
    await runMigrations(handle);
    console.log(`migrations applied (${handle.kind})`);
  } finally {
    await handle.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
