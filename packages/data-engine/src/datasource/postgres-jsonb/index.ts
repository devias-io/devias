import type { FieldMetadata, ObjectMetadata, Page, RecordData, SchemaIndex } from '@devias/core';
import { sql } from 'drizzle-orm';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../../db/exec';
import type { ValidatedQuery } from '../../query/validate';
import { type DataSource, type FieldChange, type StoredRecord, toRecordData, type WriteMeta } from '../interface';
import { aggregate } from './aggregate';
import { decodeCursor, encodeCursor } from './cursor';
import { jsonArrayElements } from './fields';
import { resolveIncludes } from './include';
import { compileQuery, sortKeysOf } from './query';
import { claimUnique, dropUniqueForField, normalizeUnique, rebuildUniqueForField, releaseUnique } from './unique';

interface RawRow extends Record<string, unknown> {
  id: string;
  object_id?: string;
  data: unknown;
  created_at: unknown;
  updated_at: unknown;
  created_by: string | null;
  updated_by: string | null;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const RECORD_COLUMNS = sql.raw(
  `r.id, r.object_id, r.data, to_char(r.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at, to_char(r.updated_at AT TIME ZONE 'UTC', ${ISO}) AS updated_at, r.created_by, r.updated_by`,
);

const toStored = (row: RawRow, objectId: string): StoredRecord => ({
  id: row.id,
  objectId: row.object_id ?? objectId,
  data: parseJson<Record<string, unknown>>(row.data) ?? {},
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  createdBy: row.created_by,
  updatedBy: row.updated_by,
});

const getMany = async (db: Db, workspaceId: string, object: ObjectMetadata, ids: string[]): Promise<StoredRecord[]> => {
  if (ids.length === 0) {
    return [];
  }

  const rows = await runRaw<RawRow>(
    db,
    sql`SELECT ${RECORD_COLUMNS} FROM record r WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${object.id} AND r.deleted_at IS NULL AND r.id IN ${jsonArrayElements(ids, 'uuid')}`,
  );
  const byId = new Map(rows.map((row) => [row.id, toStored(row, object.id)]));

  return ids.map((id) => byId.get(id)).filter((r): r is StoredRecord => r !== undefined);
};

const getReferencing = async (
  db: Db,
  workspaceId: string,
  object: ObjectMetadata,
  field: string,
  ids: string[],
): Promise<StoredRecord[]> => {
  if (ids.length === 0) {
    return [];
  }

  const rows = await runRaw<RawRow>(
    db,
    sql`SELECT ${RECORD_COLUMNS} FROM record r WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${object.id} AND r.deleted_at IS NULL AND r.data ->> ${field}::text IN ${jsonArrayElements(ids, 'text')}`,
  );

  return rows.map((row) => toStored(row, object.id));
};

const query = async (db: Db, workspaceId: string, index: SchemaIndex, q: ValidatedQuery): Promise<Page> => {
  const keyCount = q.sort.length + 1;
  const compiledForHash = compileQuery(workspaceId, q);
  const cursorKeys = q.cursor ? decodeCursor(q.cursor, compiledForHash.hash, keyCount) : undefined;
  const compiled = cursorKeys ? compileQuery(workspaceId, q, cursorKeys) : compiledForHash;

  const rows = await runRaw<RawRow>(db, compiled.select);
  const hasMore = rows.length > q.limit;
  const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
  const items: RecordData[] = pageRows.map((row) => toRecordData(toStored(row, q.object.id), q.fields, q.select));
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(compiled.hash, sortKeysOf(last, compiled.sorts)) : null;

  const page: Page = { items, nextCursor };

  if (compiled.count) {
    const countRows = await runRaw<{ count: unknown }>(db, compiled.count);
    page.totalCount = toNumber(countRows[0]?.count ?? 0);
  }

  if (q.include && Object.keys(q.include).length > 0) {
    page.included = await resolveIncludes(db, workspaceId, index, q, items, getMany);
  }

  return page;
};

const findByText = async (
  db: Db,
  workspaceId: string,
  object: ObjectMetadata,
  fields: string[],
  texts: string[],
  limit: number,
): Promise<StoredRecord[]> => {
  if (fields.length === 0 || texts.length === 0) {
    return [];
  }

  const wanted = sql`(SELECT lower(x) FROM jsonb_array_elements_text(${JSON.stringify(texts)}::jsonb) x)`;
  const matches = sql.join(
    fields.map((field) => sql`lower(r.data->>${field}) IN ${wanted}`),
    sql` OR `,
  );
  const rows = await runRaw<RawRow>(
    db,
    sql`SELECT ${RECORD_COLUMNS} FROM record r WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${object.id} AND r.deleted_at IS NULL AND (${matches}) ORDER BY r.created_at, r.id LIMIT ${limit}`,
  );

  return rows.map((row) => toStored(row, object.id));
};

const existingIds = async (db: Db, workspaceId: string, objectId: string, ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) {
    return new Set();
  }

  const rows = await runRaw<{ id: string }>(
    db,
    sql`SELECT r.id FROM record r WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${objectId} AND r.deleted_at IS NULL AND r.id IN ${jsonArrayElements(ids, 'uuid')}`,
  );

  return new Set(rows.map((r) => r.id));
};

const insert = async (
  tx: Db,
  workspaceId: string,
  object: ObjectMetadata,
  fields: FieldMetadata[],
  rows: { id: string; data: Record<string, unknown> }[],
  meta: WriteMeta,
): Promise<StoredRecord[]> => {
  if (rows.length === 0) {
    return [];
  }

  const now = meta.now.toISOString();
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.id}::uuid, ${workspaceId}, ${object.id}, ${JSON.stringify(row.data)}::jsonb, ${now}::timestamptz, ${now}::timestamptz, ${meta.actor}, ${meta.actor})`,
    ),
    sql`, `,
  );
  await runRaw(
    tx,
    sql`INSERT INTO record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by) VALUES ${values}`,
  );
  const uniqueFields = fields.filter((f) => f.isUnique);

  for (const row of rows) {
    for (const field of uniqueFields) {
      const value = normalizeUnique(field, row.data[field.name]);

      if (value !== null) {
        await claimUnique(tx, workspaceId, object.id, field, value, row.id);
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    objectId: object.id,
    data: row.data,
    createdAt: now,
    updatedAt: now,
    createdBy: meta.actor,
    updatedBy: meta.actor,
  }));
};

const update = async (
  tx: Db,
  workspaceId: string,
  object: ObjectMetadata,
  fields: FieldMetadata[],
  current: StoredRecord,
  data: Record<string, unknown>,
  meta: WriteMeta,
): Promise<StoredRecord> => {
  const now = meta.now.toISOString();
  await runRaw(
    tx,
    sql`UPDATE record SET data = ${JSON.stringify(data)}::jsonb, updated_at = ${now}::timestamptz, updated_by = ${meta.actor} WHERE workspace_id = ${workspaceId} AND id = ${current.id}::uuid`,
  );

  for (const field of fields.filter((f) => f.isUnique)) {
    const before = normalizeUnique(field, current.data[field.name]);
    const after = normalizeUnique(field, data[field.name]);

    if (before === after) {
      continue;
    }

    if (before !== null) {
      await releaseUnique(tx, workspaceId, object.id, field.id, current.id);
    }

    if (after !== null) {
      await claimUnique(tx, workspaceId, object.id, field, after, current.id);
    }
  }

  return { ...current, data, updatedAt: now, updatedBy: meta.actor };
};

const softDelete = async (
  tx: Db,
  workspaceId: string,
  object: ObjectMetadata,
  ids: string[],
  meta: WriteMeta,
): Promise<string[]> => {
  if (ids.length === 0) {
    return [];
  }

  const now = meta.now.toISOString();
  const rows = await runRaw<{ id: string }>(
    tx,
    sql`UPDATE record SET deleted_at = ${now}::timestamptz, updated_at = ${now}::timestamptz, updated_by = ${meta.actor} WHERE workspace_id = ${workspaceId} AND object_id = ${object.id} AND deleted_at IS NULL AND id IN ${jsonArrayElements(ids, 'uuid')} RETURNING id`,
  );
  const deleted = rows.map((r) => r.id);

  if (deleted.length > 0) {
    await runRaw(
      tx,
      sql`DELETE FROM record_unique WHERE workspace_id = ${workspaceId} AND object_id = ${object.id} AND record_id IN ${jsonArrayElements(deleted, 'uuid')}`,
    );
  }

  return deleted;
};

const countRecords = async (db: Db, workspaceId: string, objectId: string): Promise<number> => {
  const rows = await runRaw<{ count: unknown }>(
    db,
    sql`SELECT count(*)::int AS count FROM record r WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${objectId} AND r.deleted_at IS NULL`,
  );

  return toNumber(rows[0]?.count ?? 0);
};

const countRecordsByObject = async (db: Db, workspaceId: string): Promise<Map<string, number>> => {
  const rows = await runRaw<{ object_id: string; count: unknown }>(
    db,
    sql`SELECT r.object_id, count(*)::int AS count FROM record r WHERE r.workspace_id = ${workspaceId} AND r.deleted_at IS NULL GROUP BY r.object_id`,
  );

  return new Map(rows.map((r) => [r.object_id, toNumber(r.count)]));
};

const onObjectDeleted = async (tx: Db, workspaceId: string, objectId: string): Promise<void> => {
  await runRaw(tx, sql`DELETE FROM record_unique WHERE workspace_id = ${workspaceId} AND object_id = ${objectId}`);
  await runRaw(tx, sql`DELETE FROM record WHERE workspace_id = ${workspaceId} AND object_id = ${objectId}`);
};

const stripKey = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
  await runRaw(
    tx,
    sql`UPDATE record SET data = data - ${field.name}::text WHERE workspace_id = ${workspaceId} AND object_id = ${field.objectId} AND data ? ${field.name}::text`,
  );
};

const onFieldCreated = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
  if (field.isUnique) {
    await rebuildUniqueForField(tx, workspaceId, field);
  }
};

const onFieldChanged = async (tx: Db, workspaceId: string, { before, after, dropData }: FieldChange): Promise<void> => {
  if (dropData) {
    await stripKey(tx, workspaceId, before);
    await dropUniqueForField(tx, workspaceId, before);
  } else if (before.name !== after.name) {
    await runRaw(
      tx,
      sql`UPDATE record AS r SET data = (r.data - ${before.name}::text) || jsonb_build_object(${after.name}::text, r.data -> ${before.name}::text) WHERE r.workspace_id = ${workspaceId} AND r.object_id = ${before.objectId} AND r.data ? ${before.name}::text`,
    );
  }

  const normalizationChanged = before.type !== after.type || before.name !== after.name;

  if (after.isUnique && (!before.isUnique || normalizationChanged || dropData)) {
    await rebuildUniqueForField(tx, workspaceId, after);
  } else if (!after.isUnique && before.isUnique) {
    await dropUniqueForField(tx, workspaceId, after);
  }
};

const onFieldDeleted = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
  await stripKey(tx, workspaceId, field);
  await dropUniqueForField(tx, workspaceId, field);
};

const purgeWorkspace = async (tx: Db, workspaceId: string): Promise<void> => {
  await runRaw(tx, sql`DELETE FROM record_unique WHERE workspace_id = ${workspaceId}`);
  await runRaw(tx, sql`DELETE FROM record WHERE workspace_id = ${workspaceId}`);
};

export const createPostgresJsonbDataSource = (): DataSource => ({
  query,
  aggregate,
  getMany,
  getReferencing,
  findByText,
  existingIds,
  insert,
  update,
  softDelete,
  countRecords,
  countRecordsByObject,
  onObjectDeleted,
  onFieldCreated,
  onFieldChanged,
  onFieldDeleted,
  purgeWorkspace,
});

export { decodeCursor, encodeCursor, queryHash } from './cursor';
export { compileFilter, compileSearch } from './filter';
export { compileQuery, sortKeysOf } from './query';
export { compileSorts, keysetPredicate, orderByClause } from './sort';
export { normalizeUnique } from './unique';
