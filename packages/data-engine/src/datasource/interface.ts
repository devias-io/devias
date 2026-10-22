import type { AggregateGroup, FieldMetadata, ObjectMetadata, Page, RecordData, SchemaIndex } from '@devias/core';
import type { Db } from '../db/exec';
import type { ValidatedAggregate, ValidatedQuery } from '../query/validate';

/** A stored record before it is flattened into `RecordData`. */
export interface StoredRecord {
  id: string;
  objectId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WriteMeta {
  actor: string;
  now: Date;
}

export interface FieldChange {
  before: FieldMetadata;
  after: FieldMetadata;
  /** The change is incompatible (type family or relation target changed): existing values are dropped. */
  dropData: boolean;
}

/**
 * Storage backend for records. The engine validates, sequences and audits; the data source only knows
 * how to persist and query records for one object and maintain uniqueness.
 */
export interface DataSource {
  query(db: Db, workspaceId: string, index: SchemaIndex, query: ValidatedQuery): Promise<Page>;
  /**
   * Counts and measures per group, keyed as `keys` says (one per measure), and over every matching record. Groups
   * come back largest first; for fields other than select, at most `limit + 1` of them.
   */
  aggregate(
    db: Db,
    workspaceId: string,
    query: ValidatedAggregate,
    keys: string[],
  ): Promise<{ groups: AggregateGroup[]; total: { count: number; values: Record<string, number | string | null> } }>;
  getMany(db: Db, workspaceId: string, object: ObjectMetadata, ids: string[]): Promise<StoredRecord[]>;
  /** The live records of `object` whose relation `field` points at one of `ids`. */
  getReferencing(
    db: Db,
    workspaceId: string,
    object: ObjectMetadata,
    field: string,
    ids: string[],
  ): Promise<StoredRecord[]>;
  /**
   * The live records of `object` whose text in any of the fields `fields` is one of `texts`, compared without regard to
   * case: how an import finds the record a cell names. At most `limit` come back.
   */
  findByText(
    db: Db,
    workspaceId: string,
    object: ObjectMetadata,
    fields: string[],
    texts: string[],
    limit: number,
  ): Promise<StoredRecord[]>;
  /** Which of `ids` exist (not deleted) for the object; used for relation validation. */
  existingIds(db: Db, workspaceId: string, objectId: string, ids: string[]): Promise<Set<string>>;
  insert(
    tx: Db,
    workspaceId: string,
    object: ObjectMetadata,
    fields: FieldMetadata[],
    rows: { id: string; data: Record<string, unknown> }[],
    meta: WriteMeta,
  ): Promise<StoredRecord[]>;
  update(
    tx: Db,
    workspaceId: string,
    object: ObjectMetadata,
    fields: FieldMetadata[],
    current: StoredRecord,
    data: Record<string, unknown>,
    meta: WriteMeta,
  ): Promise<StoredRecord>;
  softDelete(tx: Db, workspaceId: string, object: ObjectMetadata, ids: string[], meta: WriteMeta): Promise<string[]>;
  countRecords(db: Db, workspaceId: string, objectId: string): Promise<number>;
  countRecordsByObject(db: Db, workspaceId: string): Promise<Map<string, number>>;
  onObjectDeleted(tx: Db, workspaceId: string, objectId: string): Promise<void>;
  onFieldCreated(tx: Db, workspaceId: string, field: FieldMetadata): Promise<void>;
  onFieldChanged(tx: Db, workspaceId: string, change: FieldChange): Promise<void>;
  onFieldDeleted(tx: Db, workspaceId: string, field: FieldMetadata): Promise<void>;
  purgeWorkspace(tx: Db, workspaceId: string): Promise<void>;
}

export const SYSTEM_RECORD_KEYS = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'] as const;

/** Flatten a stored record: every field present (null when absent), system keys win. */
export const toRecordData = (row: StoredRecord, fields: FieldMetadata[], select?: string[]): RecordData => {
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    if (select && !select.includes(field.name)) {
      continue;
    }

    const value = row.data[field.name];
    out[field.name] = value === undefined ? null : value;
  }

  out.id = row.id;
  out.created_at = row.createdAt;
  out.updated_at = row.updatedAt;

  if (row.createdBy) {
    out.created_by = row.createdBy;
  }

  if (row.updatedBy) {
    out.updated_by = row.updatedBy;
  }

  return out as RecordData;
};
