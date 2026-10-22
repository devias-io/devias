import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Workflows and their runs. */

/**
 * Automations people configure in the workspace: one trigger, ordered steps. `cursor` is how far a record-event
 * workflow has read the event log; `next_run_at` is when a scheduled one is due.
 */
export const workflow = pgTable(
  'workflow',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    title: text().notNull(),
    description: text(),
    enabled: boolean().notNull().default(true),
    trigger: jsonb().$type<Record<string, unknown>>().notNull(),
    steps: jsonb().$type<unknown[]>().notNull().default([]),
    cursor: bigint({ mode: 'number' }),
    nextRunAt: timestamptz(),
    lastRunAt: timestamptz(),
    createdBy: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('workflow_ws_idx').on(t.workspaceId)],
);

/** One execution of a workflow: what started it and how each step went. */
export const workflowRun = pgTable(
  'workflow_run',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    workflowId: uuid()
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    status: text().notNull(),
    trigger: jsonb().$type<Record<string, unknown>>().notNull(),
    steps: jsonb().$type<unknown[]>().notNull().default([]),
    error: text(),
    startedAt: timestamptz().notNull(),
    finishedAt: timestamptz().notNull(),
  },
  (t) => [index('workflow_run_ws_workflow_idx').on(t.workspaceId, t.workflowId, t.id.desc())],
);
