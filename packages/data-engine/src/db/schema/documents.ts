import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Documents and what they link to. */

/**
 * Titled pages of rich text. `body` is the editor's document; `body_text` (plain text, for search) and `preview` (its
 * first lines, for cards) are derived on every write. `version` counts writes, for edits made from a stale copy.
 * Removed documents stay (soft delete) and are read by nothing.
 */
export const document = pgTable(
  'document',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    title: text().notNull(),
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    bodyText: text().notNull().default(''),
    preview: text().notNull().default(''),
    version: integer().notNull().default(1),
    createdBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    updatedBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    deletedAt: timestamptz(),
  },
  (t) => [
    index('document_ws_updated_idx')
      .on(t.workspaceId, t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);
