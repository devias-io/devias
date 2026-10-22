import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/**
 * What people and agents write on something: a comment on a task or a document, or a note on a record (which has a
 * title). Content, not a signal: it can be edited and removed, and it outlives anything the event log may someday
 * drop. Writing one also appends an event (`commented`, `note.created`) so open pages refresh. The entity is named by
 * kind and id with no foreign key: they are soft-deleted, and a workspace is purged as a whole.
 */
export const comment = pgTable(
  'comment',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    /** `task`, `document` or `record`. */
    entityKind: text().notNull(),
    entityId: uuid().notNull(),
    /** For a record: its object's id. */
    objectId: text(),
    /** Who wrote it. */
    actor: jsonb().$type<{ kind: string; id: string }>().notNull(),
    /** The top-level comment this replies to (documents). */
    parentId: uuid(),
    /** The text of the document it is on: `{ quote, prefix, suffix, hint }`. */
    anchor: jsonb().$type<{ quote: string; prefix: string; suffix: string; hint: number }>(),
    /** When a top-level comment was resolved, and by whom. */
    resolvedAt: timestamptz(),
    resolvedBy: jsonb().$type<{ kind: string; id: string }>(),
    /** A note's title; comments have none. */
    title: text(),
    /** Markdown. */
    body: text().notNull().default(''),
    /** The run of an agent that wrote it. */
    cause: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamptz().notNull().defaultNow(),
    editedAt: timestamptz(),
    deletedAt: timestamptz(),
  },
  (t) => [
    check('comment_entity_kind_check', sql`${t.entityKind} in ('task', 'document', 'record')`),
    index('comment_entity_idx')
      .on(t.workspaceId, t.entityKind, t.entityId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);
