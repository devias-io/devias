import { fileURLToPath } from 'node:url';
import { manifest as fixtureManifest } from '@devias/fixtures';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createDataEngine, type DataEngine, type EngineContext, silentLogger } from '../../src';
import * as schema from '../../src/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../../../../apps/server/drizzle', import.meta.url));

export interface TestDb {
  client: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
  close(): Promise<void>;
}

/** Fresh in-memory PGlite with the generated migrations applied. */
export const createTestDb = async (): Promise<TestDb> => {
  const client = new PGlite('memory://');
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: MIGRATIONS });

  return { client, db, close: () => client.close() };
};

export interface TestEngine extends TestDb {
  engine: DataEngine;
  workspaceId: string;
  owner: EngineContext;
  member: EngineContext;
}

/** Engine on a fresh database with one initialized workspace (fixture applied). */
export const createTestEngine = async (options: { seed?: boolean } = {}): Promise<TestEngine> => {
  const testDb = await createTestDb();
  const engine = createDataEngine({
    db: testDb.db,
    logger: silentLogger,
    seedManifests: options.seed === false ? [] : [fixtureManifest],
  });
  const workspaceId = 'ws_test';
  await engine.workspaces.initialize(workspaceId);

  return {
    ...testDb,
    engine,
    workspaceId,
    owner: { workspaceId, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' },
    member: { workspaceId, actor: { kind: 'user', id: 'u_member' }, role: 'member' },
    close: async () => {
      await engine.close();
      await testDb.close();
    },
  };
};
