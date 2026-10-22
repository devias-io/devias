import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/**
 * One attempt of an agent at a task. The task row says what is happening now; a run keeps the attempt: the
 * conversation the agent worked in, the person it acted for, what it said it did and how it ended.
 */
export const aiRun = pgTable(
  'ai_run',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    taskId: uuid().notNull(),
    agentId: text().notNull(),
    conversationId: uuid().notNull(),
    /** `running`, `awaiting_review`, `completed`, `failed` or `cancelled`. */
    status: text().notNull().default('running'),
    attempt: integer().notNull().default(1),
    /** The user id the agent acted for. */
    requestedBy: text().notNull(),
    summary: text(),
    error: text(),
    startedAt: timestamptz().notNull().defaultNow(),
    finishedAt: timestamptz(),
  },
  (t) => [
    index('ai_run_task_idx').on(t.workspaceId, t.taskId, t.startedAt.desc()),
    index('ai_run_open_idx').on(t.workspaceId, t.status),
  ],
);
