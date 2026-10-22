import { type InstalledModule, ModuleVariablesPatchSchema } from '@devias/core';
import { sql } from 'drizzle-orm';
import { actorString, type EngineContext } from '../context';
import { type Db, runRaw } from '../db/exec';
import { EngineError, fromZodError, validationError } from '../errors';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';

/**
 * A workspace's values of its installed modules' workspace variables: plain configuration, never secrets (those
 * belong in a connection). Server variables are not stored here; the runtime reads them from the server's
 * environment and puts both together for the module's code.
 */
export interface ModuleVariablesService {
  /** This workspace's own values, by key. */
  values(workspaceId: string, moduleId: string): Promise<Record<string, string>>;
  /** Set some of them (owners and admins); an empty string goes back to the default. */
  update(ctx: EngineContext, moduleId: string, patch: unknown): Promise<InstalledModule>;
}

export const createModuleVariablesService = (deps: {
  db: Db;
  clock: () => Date;
  metadata: Pick<MetadataService, 'getSnapshot'>;
}): ModuleVariablesService => {
  const { db, clock, metadata } = deps;

  return {
    values: async (workspaceId, moduleId) => {
      const rows = await runRaw<{ key: string; value: string }>(
        db,
        sql`SELECT key, value FROM module_variable WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}`,
      );

      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },

    update: async (ctx, moduleId, patch) => {
      authorize(ctx, 'module.manage');
      const parsed = ModuleVariablesPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid variables');
      }

      const snapshot = await metadata.getSnapshot(ctx.workspaceId);
      const module = snapshot.schema.modules.find((candidate) => candidate.moduleId === moduleId);

      if (!module) {
        throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
      }

      for (const key of Object.keys(parsed.data.values)) {
        const variable = module.variables.find((candidate) => candidate.key === key);

        if (!variable) {
          throw validationError(`Unknown variable "${key}"`, { path: `values.${key}` });
        }

        if (variable.server) {
          throw validationError(`${variable.label} is set on the server, not per workspace`, { path: `values.${key}` });
        }
      }

      const now = clock().toISOString();
      await db.transaction(async (tx) => {
        for (const [key, value] of Object.entries(parsed.data.values)) {
          await runRaw(
            tx,
            value.trim() === ''
              ? sql`DELETE FROM module_variable WHERE workspace_id = ${ctx.workspaceId} AND module_id = ${moduleId}
                    AND key = ${key}`
              : sql`INSERT INTO module_variable (workspace_id, module_id, key, value, updated_by, updated_at)
                    VALUES (${ctx.workspaceId}, ${moduleId}, ${key}, ${value.trim()}, ${actorString(ctx.actor)},
                      ${now}::timestamptz)
                    ON CONFLICT (workspace_id, module_id, key) DO UPDATE SET value = EXCLUDED.value,
                      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          );
        }
      });

      return module;
    },
  };
};
