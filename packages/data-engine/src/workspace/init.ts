import { type ApplyOptions, type ApplyResult, hashManifest, type ModuleManifest } from '@devias/core';
import { sql } from 'drizzle-orm';
import { type EngineContext, systemContext } from '../context';
import type { DataSource } from '../datasource/interface';
import { type Db, runRaw } from '../db/exec';
import { isEngineError } from '../errors';
import type { Logger } from '../logger';
import type { SnapshotCache } from '../metadata/snapshot';

export interface WorkspaceService {
  /**
   * Create the workspace state row and apply the seed manifests (idempotent, safe to call often): core ones always,
   * the others to a new workspace, then kept current while installed.
   */
  initialize(workspaceId: string): Promise<void>;
  /** Same as `initialize` but memoized per process; the request path calls this. */
  ensureInitialized(workspaceId: string): Promise<void>;
  /** Delete everything the engine stores for a workspace. */
  purge(workspaceId: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface WorkspaceServiceDeps {
  db: Db;
  cache: SnapshotCache;
  dataSource: DataSource;
  logger: Logger;
  seedManifests: ModuleManifest[];
  apply: (ctx: EngineContext, manifest: ModuleManifest, options: ApplyOptions) => Promise<ApplyResult>;
}

export const createWorkspaceService = (deps: WorkspaceServiceDeps): WorkspaceService => {
  const { db, cache, dataSource, logger, seedManifests, apply } = deps;
  const ready = new Set<string>();
  const inflight = new Map<string, Promise<void>>();

  const initialize = async (workspaceId: string): Promise<void> => {
    const created = await runRaw(
      db,
      sql`INSERT INTO workspace_state (workspace_id) VALUES (${workspaceId}) ON CONFLICT DO NOTHING RETURNING workspace_id`,
    );
    const isNew = created.length > 0;

    for (const manifest of seedManifests) {
      const snapshot = await cache.get(db, workspaceId);
      const installed = snapshot.schema.modules.find((e) => e.moduleId === manifest.id);

      if (installed && installed.manifestHash === hashManifest(manifest)) {
        continue;
      }

      // Core modules are always there; the other seeds are a new workspace's starting set, kept current while
      // installed, so uninstalling one sticks.
      if (!installed && !manifest.core && !isNew) {
        continue;
      }

      try {
        await apply(systemContext(workspaceId), manifest, { allowDestructive: false });
        logger.info(`applied seed module "${manifest.id}@${manifest.version}" to workspace ${workspaceId}`);
      } catch (error) {
        if (isEngineError(error) && error.code === 'DESTRUCTIVE_CHANGE') {
          logger.warn(
            `seed module "${manifest.id}" has destructive changes for workspace ${workspaceId}; skipped`,
            error.details,
          );
          continue;
        }

        // A name the workspace already uses (an older module's object a core module now owns) must not take the
        // whole workspace down: it loads without the module until the clash is resolved from Settings → Modules.
        if (isEngineError(error) && error.code === 'CONFLICT') {
          logger.warn(
            `seed module "${manifest.id}" conflicts with existing metadata in workspace ${workspaceId}; skipped`,
            error.details,
          );
          continue;
        }

        throw error;
      }
    }

    ready.add(workspaceId);
  };

  const ensureInitialized = (workspaceId: string): Promise<void> => {
    if (ready.has(workspaceId)) {
      return Promise.resolve();
    }

    const pending = inflight.get(workspaceId);

    if (pending) {
      return pending;
    }

    const run = initialize(workspaceId).finally(() => inflight.delete(workspaceId));
    inflight.set(workspaceId, run);

    return run;
  };

  const purge = async (workspaceId: string): Promise<void> => {
    await db.transaction(async (tx) => {
      await dataSource.purgeWorkspace(tx, workspaceId);

      for (const table of [
        'notification',
        'module_event',
        'module_connection',
        'module_variable',
        'oauth_state',
        'job',
        'module_kv',
        'workflow_run',
        'workflow',
        'document',
        'comment',
        'mention',
        'task',
        'event',
        'object_permission',
        'module',
        'command_item',
        'nav_item',
        'layout',
        'view',
        'field_metadata',
        'object_metadata',
        'workspace_state',
      ]) {
        await runRaw(tx, sql`DELETE FROM ${sql.raw(`"${table}"`)} WHERE workspace_id = ${workspaceId}`);
      }
    });
    cache.invalidate(workspaceId);
    ready.delete(workspaceId);
  };

  const list = async (): Promise<string[]> => {
    const rows = await runRaw<{ workspace_id: string }>(
      db,
      sql`SELECT workspace_id FROM workspace_state ORDER BY workspace_id`,
    );

    return rows.map((r) => r.workspace_id);
  };

  return { initialize, ensureInitialized, purge, list };
};
