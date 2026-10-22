import type { FieldMetadata } from '@devias/core';
import { sql } from 'drizzle-orm';
import { type Db, runRaw } from '../../db/exec';
import { EngineError } from '../../errors';
import { jsonText } from './fields';

/** Normalized text for the unique side table; email and url compare case-insensitively. */
export const normalizeUnique = (field: FieldMetadata, value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value);

  return field.type === 'email' || field.type === 'url' ? text.toLowerCase() : text;
};

const uniqueViolation = (field: FieldMetadata, value: string): EngineError =>
  new EngineError('UNIQUE_VIOLATION', `Value "${value}" for field "${field.name}" is already used by another record`, {
    field: field.name,
    value,
  });

/** Insert a unique claim; a conflicting claim by another record throws UNIQUE_VIOLATION (no aborted tx). */
export const claimUnique = async (
  tx: Db,
  workspaceId: string,
  objectId: string,
  field: FieldMetadata,
  value: string,
  recordId: string,
): Promise<void> => {
  const rows = await runRaw<{ record_id: string }>(
    tx,
    sql`INSERT INTO record_unique (workspace_id, object_id, field_id, value, record_id)
        VALUES (${workspaceId}, ${objectId}, ${field.id}, ${value}, ${recordId}::uuid)
        ON CONFLICT (workspace_id, object_id, field_id, value) DO UPDATE SET record_id = record_unique.record_id
        WHERE record_unique.record_id = EXCLUDED.record_id
        RETURNING record_id`,
  );

  if (rows.length === 0) {
    throw uniqueViolation(field, value);
  }
};

export const releaseUnique = async (
  tx: Db,
  workspaceId: string,
  objectId: string,
  fieldId: string,
  recordId: string,
): Promise<void> => {
  await runRaw(
    tx,
    sql`DELETE FROM record_unique WHERE workspace_id = ${workspaceId} AND object_id = ${objectId} AND field_id = ${fieldId} AND record_id = ${recordId}::uuid`,
  );
};

export const dropUniqueForField = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
  await runRaw(
    tx,
    sql`DELETE FROM record_unique WHERE workspace_id = ${workspaceId} AND object_id = ${field.objectId} AND field_id = ${field.id}`,
  );
};

/** Rebuild the unique table for a field from live records; duplicates throw UNIQUE_VIOLATION. */
export const rebuildUniqueForField = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
  await dropUniqueForField(tx, workspaceId, field);
  const text = jsonText(field.name);
  const normalized = field.type === 'email' || field.type === 'url' ? sql`lower(${text})` : text;
  const scope = sql`r.workspace_id = ${workspaceId} AND r.object_id = ${field.objectId} AND r.deleted_at IS NULL AND ${text} IS NOT NULL AND ${text} <> ''`;
  const duplicates = await runRaw<{ value: string }>(
    tx,
    sql`SELECT ${normalized} AS value FROM record r WHERE ${scope} GROUP BY 1 HAVING count(*) > 1 LIMIT 1`,
  );
  const duplicate = duplicates[0];

  if (duplicate) {
    throw uniqueViolation(field, duplicate.value);
  }

  await runRaw(
    tx,
    sql`INSERT INTO record_unique (workspace_id, object_id, field_id, value, record_id)
        SELECT r.workspace_id, r.object_id, ${field.id}, ${normalized}, r.id FROM record r WHERE ${scope}`,
  );
};
