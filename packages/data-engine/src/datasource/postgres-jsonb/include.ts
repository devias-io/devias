import type { ObjectMetadata, RecordData, SchemaIndex } from '@devias/core';
import type { Db } from '../../db/exec';
import type { ValidatedQuery } from '../../query/validate';
import { type StoredRecord, toRecordData } from '../interface';

export type GetMany = (db: Db, workspaceId: string, object: ObjectMetadata, ids: string[]) => Promise<StoredRecord[]>;

/** Batched many-to-one includes: distinct target ids per relation field → one `getMany` per field. */
export const resolveIncludes = async (
  db: Db,
  workspaceId: string,
  index: SchemaIndex,
  q: ValidatedQuery,
  items: RecordData[],
  getMany: GetMany,
): Promise<Record<string, RecordData[]>> => {
  const included: Record<string, RecordData[]> = {};

  for (const [name, spec] of Object.entries(q.include ?? {})) {
    const field = q.fieldsByName.get(name);

    if (!field) {
      continue;
    }

    const targetUid = (field.settings as { targetObjectId?: string }).targetObjectId;
    const target = targetUid ? index.objectsById.get(targetUid) : undefined;

    if (!target) {
      included[name] = [];
      continue;
    }

    const ids: string[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const value = item[name];

      if (typeof value === 'string' && value && !seen.has(value)) {
        seen.add(value);
        ids.push(value);
      }
    }

    const limit = spec === true ? undefined : spec.limit;
    const select = spec === true ? undefined : spec.select;
    const wanted = limit ? ids.slice(0, limit) : ids;
    const targetFields = index.fieldsByObjectId.get(target.id) ?? [];
    const rows = wanted.length > 0 ? await getMany(db, workspaceId, target, wanted) : [];
    included[name] = rows.map((row) => toRecordData(row, targetFields, select));
  }

  return included;
};
