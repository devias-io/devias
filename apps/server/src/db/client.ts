import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema';

export type DbKind = 'pg' | 'pglite';

export interface DbHandle {
  // biome-ignore lint/suspicious/noExplicitAny: driver-independent handle shared with the engine
  db: PgDatabase<PgQueryResultHKT, any, any>;
  kind: DbKind;
  /** Creates a dedicated pg Client for LISTEN (pg only). */
  createListenClient?: () => pg.Client;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  databaseUrl?: string | undefined;
  /** PGlite data directory; `memory://` for an in-memory database (tests, scripts). */
  pgliteDataDir?: string;
}

/** Postgres when DATABASE_URL is set, embedded PGlite otherwise. */
export const createDb = async (options: CreateDbOptions): Promise<DbHandle> => {
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl });
    const db = drizzleNodePg({ client: pool, schema, casing: 'snake_case' });

    return {
      db,
      kind: 'pg',
      createListenClient: () => new pg.Client({ connectionString: options.databaseUrl }),
      close: () => pool.end(),
    };
  }

  const dataDir = options.pgliteDataDir ?? 'memory://';

  if (!dataDir.startsWith('memory://')) {
    mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite({ client, schema, casing: 'snake_case' });

  return { db, kind: 'pglite', close: () => client.close() };
};
