import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

/**
 * What a task or a document mentions in its text (`role` `mention`) or, for a task, names as what it is about (`about`): a record
 * (`object_id` is its object's id), a document, a task or an asset (`object_id` is empty). Replaced in the same transaction as
 * every write. This is how "mentioned in" and a record's tasks find them without reading any text, and one index
 * answers for every kind of entity. Mentions of people, agents and workflows are not indexed.
 */
export const mention = pgTable(
  'mention',
  {
    workspaceId: text().notNull(),
    /** What holds the mention: `task` or `document`. */
    entityKind: text().notNull(),
    entityId: uuid().notNull(),
    /** What it points at: `record`, `document`, `task` or `asset`. */
    kind: text().notNull(),
    objectId: text().notNull().default(''),
    targetId: uuid().notNull(),
    role: text().notNull().default('mention'),
  },
  (t) => [
    primaryKey({ columns: [t.entityKind, t.entityId, t.kind, t.objectId, t.targetId, t.role] }),
    check('mention_entity_kind_check', sql`${t.entityKind} in ('task', 'document')`),
    check('mention_kind_check', sql`${t.kind} in ('record', 'document', 'task', 'asset')`),
    check('mention_role_check', sql`${t.role} in ('mention', 'about')`),
    index('mention_target_idx').on(t.workspaceId, t.kind, t.objectId, t.targetId),
  ],
);
