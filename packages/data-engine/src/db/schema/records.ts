import { sql } from 'drizzle-orm';
import { foreignKey, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';
import { objectMetadata } from './data-model';

/** Records and what hangs off them: uniqueness keys. Their notes are comments (`comments.ts`). */

export const record = pgTable(
  'record',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    deletedAt: timestamptz(),
    createdBy: text(),
    updatedBy: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objectMetadata.workspaceId, objectMetadata.id],
    }).onDelete('restrict'),
    index('record_ws_object_updated_idx')
      .on(t.workspaceId, t.objectId, t.updatedAt.desc(), t.id)
      .where(sql`${t.deletedAt} is null`),
    index('record_data_gin_idx').using('gin', t.data),
  ],
);

export const recordUnique = pgTable(
  'record_unique',
  {
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    fieldId: text().notNull(),
    value: text().notNull(),
    recordId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.objectId, t.fieldId, t.value] })],
);
