import { boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';
import { objectMetadata } from './data-model';

/** How the studio shows the data model: views, layouts, navigation and commands. */

export const view = pgTable(
  'view',
  {
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    id: text().notNull(),
    label: text().notNull(),
    type: text().notNull().default('table'),
    icon: text(),
    isDefault: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
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
    index('view_ws_idx').on(t.workspaceId),
  ],
);

export const layout = pgTable(
  'layout',
  {
    workspaceId: text().notNull(),
    objectId: text().notNull(),
    id: text().notNull(),
    label: text().notNull(),
    kind: text().notNull().default('record'),
    /** The shape of the page: `tabs`, `column` or `split`. */
    shell: text().notNull().default('tabs'),
    isDefault: boolean().notNull().default(false),
    /** What the shape holds: `{ header, tabs }`, `{ blocks }` or `{ main, aside }`. */
    content: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** The module actions the page offers as buttons, in order. */
    actions: jsonb().$type<unknown[]>().notNull().default([]),
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
    index('layout_ws_idx').on(t.workspaceId),
  ],
);

export const navItem = pgTable(
  'nav_item',
  {
    workspaceId: text().notNull(),
    id: text().notNull(),
    label: text().notNull(),
    icon: text(),
    target: jsonb().$type<Record<string, unknown>>().notNull(),
    position: integer().notNull().default(0),
    /** The nav item this one sits under; deleting that item moves this one to the top (see the store). */
    parentId: text(),
    /** Shown above the sections whatever the workspace arranged, and never arranged in Settings. */
    pinned: boolean().notNull().default(false),
    /** What the workspace changed about a module's item (label, icon, place, hidden); the columns stay the module's. */
    overrides: jsonb().$type<Record<string, unknown>>(),
    moduleId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] }), index('nav_item_ws_idx').on(t.workspaceId)],
);

export const commandItem = pgTable(
  'command_item',
  {
    workspaceId: text().notNull(),
    id: text().notNull(),
    label: text().notNull(),
    icon: text(),
    groupName: text(),
    shortcut: text(),
    action: jsonb().$type<Record<string, unknown>>().notNull(),
    moduleId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] }), index('command_item_ws_idx').on(t.workspaceId)],
);
