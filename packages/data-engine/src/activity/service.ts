import {
  ACTIVITY_DEFAULT_LIMIT,
  type ActivityEntry,
  type ActivityPage,
  type ActivityQuery,
  type Actor,
  decodeActivityCursor,
  encodeActivityCursor,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError } from '../errors';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import { resolveObject } from '../query/validate';

export interface ActivityService {
  list(ctx: EngineContext, object: string, id: string, query?: ActivityQuery): Promise<ActivityPage>;
}

export interface ActivityServiceDeps {
  db: Db;
  metadata: MetadataService;
}

interface ActivityRow extends Record<string, unknown> {
  sequence: unknown;
  type: string;
  actor: unknown;
  changed_fields: unknown;
  diff: unknown;
  occurred_at: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid ${what} id "${id}"`, { id });
  }
};

const toEntry = (row: ActivityRow): ActivityEntry | null => {
  const sequence = toNumber(row.sequence);
  const base = {
    id: String(sequence),
    sequence,
    actor: parseJson<Actor>(row.actor),
    occurredAt: toIso(row.occurred_at),
  };

  switch (row.type) {
    case 'record.created':
      return { ...base, kind: 'created' };
    case 'record.deleted':
      return { ...base, kind: 'deleted' };
    case 'record.updated': {
      const fields = row.changed_fields === null ? [] : parseJson<string[]>(row.changed_fields);
      const diff =
        row.diff === null
          ? null
          : parseJson<{ before: Record<string, unknown>; after: Record<string, unknown> }>(row.diff);

      return {
        ...base,
        kind: 'updated',
        changes: fields.map((field) => ({
          field,
          before: diff?.before?.[field] ?? null,
          after: diff?.after?.[field] ?? null,
        })),
      };
    }
    default:
      return null;
  }
};

/** A record's history, from the event log, newest first. */
export const createActivityService = (deps: ActivityServiceDeps): ActivityService => {
  const { db, metadata } = deps;

  const resolve = async (ctx: EngineContext, objectName: string) => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);

    return resolveObject(snapshot.index, objectName);
  };

  return {
    list: async (ctx, objectName, id, query = {}) => {
      const object = await resolve(ctx, objectName);
      authorize(ctx, 'record.read', { object });
      assertUuid(id, 'record');
      const before = query.cursor === undefined ? undefined : decodeActivityCursor(query.cursor);

      if (query.cursor !== undefined && before === undefined) {
        throw new EngineError('INVALID_CURSOR', 'The activity cursor is malformed');
      }

      const limit = query.limit ?? ACTIVITY_DEFAULT_LIMIT;
      const rows = await runRaw<ActivityRow>(
        db,
        sql`SELECT e.sequence, e.type, e.actor, e.changed_fields, e.diff, e.occurred_at
          FROM event e
          WHERE e.workspace_id = ${ctx.workspaceId}
            AND e.record_id = ${id}::uuid
            AND e.object_id = ${object.id}
            AND e.type IN ('record.created', 'record.updated', 'record.deleted')
            ${before === undefined ? sql`` : sql`AND e.sequence < ${before}`}
          ORDER BY e.sequence DESC
          LIMIT ${limit + 1}`,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map(toEntry).filter((entry): entry is ActivityEntry => entry !== null),
        nextCursor: rows.length > limit && last ? encodeActivityCursor(toNumber(last.sequence)) : null,
      };
    },
  };
};
