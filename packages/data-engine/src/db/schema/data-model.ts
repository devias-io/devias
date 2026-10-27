import type { Filter } from '@devias/core';
import { boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** The data model: objects, their fields and per-object permissions. */

export const objectMetadata = pgTable(
  'object_metadata',
  {
    workspaceId: text().notNull(),
    /** The object's id (a uuid): the same in every workspace that has it. */
    id: text().notNull(),
    nameSingular: text().notNull(),
    namePlural: text().notNull(),
    labelSingular: text().notNull(),
    labelPlural: text().notNull(),
    icon: text(),
    description: text(),
    primaryFieldId: text(),
    isSystem: boolean().notNull().default(false),
    readOnly: boolean().notNull().default(false),
    deleteWhen: jsonb().$type<Filter>(),
    moduleId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    unique('object_metadata_ws_name_singular_uq').on(t.workspaceId, t.nameSingular),
    index('object_metadata_ws_idx').on(t.workspaceId),
  ],
);

export const fieldMetadata = pgTable(
  'field_metadata',
  {
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    id: text().notNull(),
    name: text().notNull(),
    type: text().notNull(),
    label: text().notNull(),
    description: text(),
    icon: text(),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    isRequired: boolean().notNull().default(false),
    isUnique: boolean().notNull().default(false),
    /** SQL NULL means "no default"; a JSON value (including JSON null) is the default. */
    defaultValue: jsonb().$type<unknown>(),
    position: integer().notNull().default(0),
    moduleId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    foreignKey({
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objectMetadata.workspaceId, objectMetadata.id],
    }).onDelete('cascade'),
    unique('field_metadata_object_name_uq').on(t.workspaceId, t.objectId, t.name),
    index('field_metadata_ws_idx').on(t.workspaceId),
  ],
);

export const objectPermission = pgTable(
  'object_permission',
  {
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    role: text().notNull(),
    canRead: boolean().notNull().default(true),
    canWrite: boolean().notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.objectId, t.role] }),
    foreignKey({
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objectMetadata.workspaceId, objectMetadata.id],
    }).onDelete('cascade'),
  ],
);
