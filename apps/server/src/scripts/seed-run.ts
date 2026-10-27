import { createServer as createProbe } from 'node:net';
import { loadModules } from '@devias/server';
import { sql } from 'drizzle-orm';
import deviasConfig from '../../../../devias.config';
import { createServer } from '../boot';
import { loadConfig } from '../config';
import type { Db, SqlFragment } from './seed-sql';

export interface SeedSpec {
  /** The object to fill: its `nameSingular`. */
  object: string;
  /** What the rows are called in messages. */
  label: string;
  /** Marks the rows (`created_by`) so `--remove` takes out exactly them. */
  tag: string;
  defaultCount: number;
  /** Other objects whose rows this seed also adds (invoice lines, payments): `--remove` clears them too. */
  alsoRemove?: string[];
  /** The command, for messages. */
  command: string;
  /** Adds the rows numbered `from` to `to`. `objects` maps every object's `nameSingular` to its id. */
  insert: (
    db: Db,
    options: {
      workspaceId: string;
      objectId: string;
      objects: Map<string, string>;
      idSql: SqlFragment;
      run: string;
      from: number;
      to: number;
    },
  ) => Promise<void>;
}

const portTaken = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createProbe();
    probe.once('error', () => resolve(true));
    probe.listen(port, () => probe.close(() => resolve(false)));
  });

const argOf = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
};
const intArg = (name: string, fallback: number): number => {
  const raw = argOf(name);

  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw.replaceAll('_', '').replaceAll(',', ''));

  if (!Number.isInteger(value) || value <= 0) {
    console.error(`--${name} must be a positive whole number (got "${raw}").`);
    process.exit(1);
  }

  return value;
};

const countOf = async (db: Db, query: SqlFragment): Promise<number> => {
  const result = (await db.execute(query)) as { rows?: { n: number }[] };

  return result.rows?.[0]?.n ?? 0;
};

/**
 * Runs a seed: picks the workspace, then either removes what an earlier run added (`--remove`) or adds `--count` rows in
 * batches generated inside the database. The rows go straight into the `record` table, so no record events, workflows
 * or notifications fire.
 */
export const runSeed = async (spec: SeedSpec) => {
  const config = loadConfig();

  if (!config.databaseUrl && (await portTaken(config.port))) {
    console.error(
      `Port ${config.port} is in use: a server is probably running on the PGlite data directory. Stop it first, or set DATABASE_URL.`,
    );
    process.exit(1);
  }

  const server = await createServer(config, {
    modules: await loadModules(deviasConfig, { from: import.meta.url }),
  }).catch((error: unknown) => {
    // 42P01: the database has no tables yet, so it was never migrated.
    const code = (error as { cause?: { code?: string } }).cause?.code;

    if (code === '42P01') {
      console.error(
        'The database has no tables yet. Run `pnpm db:migrate`, start the dev server once and create a workspace in the studio, then run this again.',
      );
      process.exit(1);
    }

    throw error;
  });

  try {
    const workspaces = await server.engine.workspaces.list();
    const workspaceId = argOf('workspace') ?? (workspaces.length === 1 ? workspaces[0] : undefined);

    if (!workspaceId) {
      console.error(
        workspaces.length === 0
          ? 'There is no workspace yet: create one in the studio first.'
          : `Pick a workspace with --workspace <id>. Found: ${workspaces.join(', ')}`,
      );
      process.exit(1);
    }

    const ctx = { workspaceId, actor: { kind: 'system' as const, id: spec.tag }, role: null };
    const objects = new Map(
      (await server.engine.metadata.getSchema(ctx)).objects.map((o) => [o.nameSingular, o.id] as const),
    );
    const objectId = objects.get(spec.object);

    if (!objectId) {
      console.error(`This workspace has no ${spec.object} object: install the CRM module first.`);
      process.exit(1);
    }

    const { db } = server.db;

    if (process.argv.includes('--remove')) {
      const removed = await countOf(
        db,
        sql`
          with gone as (
            delete from record
            where workspace_id = ${workspaceId} and object_id = ${objectId} and created_by = ${spec.tag}
            returning 1
          )
          select count(*)::int as n from gone
        `,
      );

      for (const name of spec.alsoRemove ?? []) {
        const other = objects.get(name);

        if (!other) {
          continue;
        }

        await db.execute(
          sql`delete from record where workspace_id = ${workspaceId} and object_id = ${other} and created_by = ${spec.tag}`,
        );
      }

      console.log(`${workspaceId}: removed ${removed.toLocaleString('en')} seeded ${spec.label}`);

      return;
    }

    const count = intArg('count', spec.defaultCount);
    const batch = Math.min(intArg('batch', 25_000), count);
    // Rows are numbered on from what earlier runs added, so names and emails stay unique when it is run again.
    const existing = await countOf(
      db,
      sql`select count(*)::int as n from record where workspace_id = ${workspaceId} and object_id = ${objectId} and created_by = ${spec.tag}`,
    );
    // Postgres 18 has time-ordered ids (what the engine generates); older ones fall back to random ids.
    const idSql = await db
      .execute(sql`select uuidv7()`)
      .then(() => sql`uuidv7()`)
      .catch(() => sql`gen_random_uuid()`);
    const run = Date.now().toString(36);
    const started = Date.now();
    console.log(
      `${workspaceId}: adding ${count.toLocaleString('en')} ${spec.label} in batches of ${batch.toLocaleString('en')}` +
        `${server.db.kind === 'pglite' ? ' (PGlite: this will be slow, use DATABASE_URL for large runs)' : ''}…`,
    );

    for (let done = 0; done < count; done += batch) {
      const to = Math.min(done + batch, count);
      await spec.insert(db, {
        workspaceId,
        objectId,
        objects,
        idSql,
        run,
        from: existing + done + 1,
        to: existing + to,
      });
      const rate = to / ((Date.now() - started) / 1000);
      console.log(
        `  ${to.toLocaleString('en')} / ${count.toLocaleString('en')}  (${Math.round(rate).toLocaleString('en')} rows/s, ~${Math.ceil((count - to) / rate)}s left)`,
      );
    }

    await db.execute(sql`analyze record`);
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Remove them again with --remove.`);
  } finally {
    await server.close();
  }
};
