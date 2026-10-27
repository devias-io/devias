import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Tasks, what they link to and their timeline. */

/**
 * Work handed between people and agents. `description` is the editor's document; `description_text` (plain text, for
 * search) is derived on every write. The assignee is a person or an agent (`assignee_kind` and `assignee_id` are both
 * set or both empty). `parent_id`, `depth` and `root_id` keep subtasks; `work`, `run_id`, `attempts`, `queued_at` and
 * `lease_until` are the queue an agent works from, written by the platform only. `key` makes creating idempotent.
 * `version` counts writes, for edits made from a stale copy. Removed tasks stay (soft delete) and are read by nothing.
 */
export const task = pgTable(
  'task',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    title: text().notNull(),
    description: jsonb().$type<Record<string, unknown>>().notNull(),
    descriptionText: text().notNull().default(''),
    status: text().notNull().default('todo'),
    statusChangedAt: timestamptz().notNull().defaultNow(),
    priority: text().notNull().default('none'),
    priorityRank: integer().notNull().default(4),
    assigneeKind: text(),
    assigneeId: text(),
    /** Who gave it to that assignee: an agent works a task for that person, with what they may do. */
    assignedBy: jsonb().$type<{ kind: string; id: string }>(),
    dueDate: date({ mode: 'string' }),
    parentId: uuid().references((): AnyPgColumn => task.id),
    depth: integer().notNull().default(0),
    rootId: uuid(),
    work: text(),
    runId: uuid(),
    attempts: integer().notNull().default(0),
    queuedAt: timestamptz(),
    leaseUntil: timestamptz(),
    key: text(),
    version: integer().notNull().default(1),
    closedAt: timestamptz(),
    createdBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    updatedBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    deletedAt: timestamptz(),
  },
  (t) => [
    check('task_status_check', sql`${t.status} in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled')`),
    check('task_priority_check', sql`${t.priority} in ('urgent', 'high', 'medium', 'low', 'none')`),
    check(
      'task_work_check',
      sql`${t.work} is null or ${t.work} in ('working', 'waiting_on_you', 'waiting_on_subtasks', 'failed')`,
    ),
    check(
      'task_assignee_check',
      sql`(${t.assigneeKind} is null and ${t.assigneeId} is null) or (${t.assigneeKind} in ('user', 'agent') and ${t.assigneeId} is not null)`,
    ),
    uniqueIndex('task_ws_key_idx').on(t.workspaceId, t.key).where(sql`${t.key} is not null`),
    index('task_ws_updated_idx').on(t.workspaceId, t.updatedAt.desc(), t.id.desc()).where(sql`${t.deletedAt} is null`),
    index('task_ws_status_idx')
      .on(t.workspaceId, t.status, t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
    index('task_assignee_idx')
      .on(t.workspaceId, t.assigneeKind, t.assigneeId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('task_due_idx').on(t.workspaceId, t.dueDate).where(sql`${t.deletedAt} is null and ${t.dueDate} is not null`),
    index('task_queue_idx')
      .on(t.workspaceId, t.assigneeId, t.priorityRank, t.dueDate, t.createdAt)
      .where(
        sql`${t.deletedAt} is null and ${t.status} = 'todo' and ${t.assigneeKind} = 'agent' and ${t.work} is null`,
      ),
    index('task_parent_idx').on(t.parentId).where(sql`${t.deletedAt} is null`),
  ],
);
