import { type InstalledModule, ModuleVariablesPatchSchema } from '@devias/core';
import { sql } from 'drizzle-orm';
import { actorString, type EngineContext } from '../context';
import { type Db, runRaw } from '../db/exec';
import { EngineError, fromZodError, validationError } from '../errors';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import { isSealed, type SecretBox } from './secret-box';

/**
 * A workspace's values of its installed modules' variables, by the variable's id. A secret one is sealed in the
 * table, and opened only for the module's own code: what the API and the studio get back says whether it is set, never
 * what it is.
 */
export interface VariablesService {
  /** This workspace's own values by variable id, the secret ones opened: for the module's code, never for a response. */
  values(workspaceId: string, moduleId: string): Promise<Record<string, string>>;
  /**
   * Set some of them (owners and admins), by variable id; an empty string goes back to the default. A secret is not
   * set by an agent or a workflow: its value would pass through a chat or a workflow's steps.
   */
  update(ctx: EngineContext, moduleId: string, patch: unknown): Promise<InstalledModule>;
}

export const createVariablesService = (deps: {
  db: Db;
  clock: () => Date;
  secrets: SecretBox;
  metadata: Pick<MetadataService, 'getSnapshot'>;
}): VariablesService => {
  const { db, clock, secrets, metadata } = deps;

  return {
    values: async (workspaceId, moduleId) => {
      const rows = await runRaw<{ id: string; value: string }>(
        db,
        sql`SELECT id, value FROM variable WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}`,
      );

      return Object.fromEntries(rows.map((row) => [row.id, isSealed(row.value) ? secrets.open(row.value) : row.value]));
    },

    update: async (ctx, moduleId, patch) => {
      authorize(ctx, 'module.manage');
      const parsed = ModuleVariablesPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid variables');
      }

      const snapshot = await metadata.getSnapshot(ctx.workspaceId);
      const module = snapshot.schema.modules.find((candidate) => candidate.id === moduleId);

      if (!module) {
        throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
      }

      const typedByAMachine = ctx.actor.kind === 'agent' || ctx.actor.kind === 'workflow';

      for (const id of Object.keys(parsed.data.values)) {
        const variable = module.variables.find((candidate) => candidate.id === id);

        if (!variable) {
          throw validationError(`Unknown variable "${id}"`, { path: `values.${id}` });
        }

        if (variable.secret && typedByAMachine) {
          throw validationError(`${variable.label} is a secret: type it in Settings → Modules, not here`, {
            path: `values.${id}`,
          });
        }
      }

      const secret = new Set(module.variables.filter((variable) => variable.secret).map((variable) => variable.id));
      const now = clock().toISOString();
      await db.transaction(async (tx) => {
        for (const [id, value] of Object.entries(parsed.data.values)) {
          const trimmed = value.trim();

          await runRaw(
            tx,
            trimmed === ''
              ? sql`DELETE FROM variable WHERE workspace_id = ${ctx.workspaceId} AND module_id = ${moduleId}
                    AND id = ${id}`
              : sql`INSERT INTO variable (workspace_id, module_id, id, value, updated_by, updated_at)
                    VALUES (${ctx.workspaceId}, ${moduleId}, ${id}, ${secret.has(id) ? secrets.seal(trimmed) : trimmed},
                      ${actorString(ctx.actor)}, ${now}::timestamptz)
                    ON CONFLICT (workspace_id, module_id, id) DO UPDATE SET value = EXCLUDED.value,
                      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          );
        }
      });

      return module;
    },
  };
};
