import { sql } from 'drizzle-orm';
import { type Db, parseJson, runRaw } from '../db/exec';
import { validationError } from '../errors';

/**
 * A module's own small state in one workspace, by key: sync cursors, the last id seen, a cached profile. Module code
 * reaches it as `ctx.kv`, always scoped to its own module and the workspace it runs for. Values are JSON; an entry
 * past its `expiresAt` reads as absent.
 */
export interface KvService {
  get(workspaceId: string, moduleId: string, key: string): Promise<unknown>;
  set(workspaceId: string, moduleId: string, key: string, value: unknown, options?: { ttlMs?: number }): Promise<void>;
  delete(workspaceId: string, moduleId: string, key: string): Promise<void>;
}

const KEY_MAX = 200;
/** Small state, not storage: records are where data goes. */
export const KV_VALUE_MAX_BYTES = 64 * 1024;

export const createKvService = (deps: { db: Db; clock: () => Date }): KvService => {
  const { db, clock } = deps;
  const checkKey = (key: string) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > KEY_MAX) {
      throw validationError(`Keys are 1 to ${KEY_MAX} characters`, { key });
    }
  };

  return {
    get: async (workspaceId, moduleId, key) => {
      checkKey(key);
      const rows = await runRaw<{ value: unknown }>(
        db,
        sql`SELECT value FROM kv WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId} AND key = ${key}
            AND (expires_at IS NULL OR expires_at > ${clock().toISOString()}::timestamptz)`,
      );

      return rows[0] ? parseJson(rows[0].value) : undefined;
    },
    set: async (workspaceId, moduleId, key, value, options = {}) => {
      checkKey(key);
      const json = JSON.stringify(value ?? null);

      if (Buffer.byteLength(json) > KV_VALUE_MAX_BYTES) {
        throw validationError(`A value is at most ${KV_VALUE_MAX_BYTES / 1024} KB of JSON`, { key });
      }

      const now = clock();
      const expires = options.ttlMs ? new Date(now.getTime() + options.ttlMs).toISOString() : null;
      await runRaw(
        db,
        sql`INSERT INTO kv (workspace_id, module_id, key, value, expires_at, updated_at)
            VALUES (${workspaceId}, ${moduleId}, ${key}, ${json}::jsonb, ${expires}::timestamptz, ${now.toISOString()}::timestamptz)
            ON CONFLICT (workspace_id, module_id, key) DO UPDATE SET value = EXCLUDED.value,
              expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at`,
      );
    },
    delete: async (workspaceId, moduleId, key) => {
      checkKey(key);
      await runRaw(
        db,
        sql`DELETE FROM kv WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId} AND key = ${key}`,
      );
    },
  };
};
