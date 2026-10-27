import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { DbHandle } from './client';

/** `apps/server/drizzle`, resolved relative to this file so it works from any cwd. */
export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export const runMigrations = async ({ db, kind }: DbHandle): Promise<void> => {
  const config = { migrationsFolder: MIGRATIONS_FOLDER };

  if (kind === 'pg') {
    await migrateNodePg(db as Parameters<typeof migrateNodePg>[0], config);
  } else {
    await migratePglite(db as Parameters<typeof migratePglite>[0], config);
  }
};
