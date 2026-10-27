import { jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** A module's own small state, by key, in one workspace: sync cursors and the like. */
export const kv = pgTable(
  'kv',
  {
    workspaceId: text().notNull(),
    moduleId: text().notNull(),
    key: text().notNull(),
    value: jsonb().$type<unknown>().notNull(),
    expiresAt: timestamptz(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.moduleId, t.key] })],
);
