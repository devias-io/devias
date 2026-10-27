import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Workflows and their runs. */

/**
 * Automations: one trigger, ordered steps. People configure them in the workspace, or a module ships them (`module_id`
 * is the module, `module_key` the id its manifest gives the workflow, which the row's own id does not repeat because
 * workspaces share a manifest). `cursor` is how far a record-event workflow has read the event log; `next_run_at` is
 * when a scheduled one is due.
 */
export const workflow = pgTable(
  'workflow',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    title: text().notNull(),
    description: text(),
    enabled: boolean().notNull().default(true),
    moduleId: text(),
    moduleKey: text(),
    trigger: jsonb().$type<Record<string, unknown>>().notNull(),
    steps: jsonb().$type<unknown[]>().notNull().default([]),
    cursor: bigint({ mode: 'number' }),
    nextRunAt: timestamptz(),
    lastRunAt: timestamptz(),
    createdBy: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('workflow_ws_idx').on(t.workspaceId),
    uniqueIndex('workflow_module_key_idx')
      .on(t.workspaceId, t.moduleId, t.moduleKey)
      .where(sql`${t.moduleId} is not null`),
  ],
);

/**
 * One execution of a workflow: what started it and how each step went. A run is a row from the moment its trigger
 * fires, so it outlives a restart: `wake_at` is when a runner may take it, `locked_until` the lease of the runner that
 * has it, `attempts` how many times one took it (the number the holder proves itself with), `stalls` how many times a
 * runner stopped working on it (a run whose runner died is taken again and goes on from the steps in `steps`), and `context` what the steps' templates see besides the steps (the record, the event). A trigger that
 * fires twice for the same cause queues one run: `idempotency_key` is unique per workflow.
 */
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
    context: jsonb().$type<Record<string, unknown>>(),
    steps: jsonb().$type<unknown[]>().notNull().default([]),
    error: text(),
    wakeAt: timestamptz().notNull().defaultNow(),
    lockedUntil: timestamptz(),
    attempts: integer().notNull().default(0),
    stalls: integer().notNull().default(0),
    idempotencyKey: text(),
    /** The record the run is about, when it is about one: what a record page asks the runs of. */
    recordId: text(),
    /** The object of that record: what a table asks the runs of, to show which of its rows are being worked on. */
    objectId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    startedAt: timestamptz(),
    finishedAt: timestamptz(),
  },
  (t) => [
    index('workflow_run_ws_workflow_idx').on(t.workspaceId, t.workflowId, t.id.desc()),
    uniqueIndex('workflow_run_key_idx').on(t.workflowId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index('workflow_run_record_idx').on(t.workspaceId, t.recordId, t.id.desc()).where(sql`${t.recordId} is not null`),
    index('workflow_run_object_idx').on(t.workspaceId, t.objectId, t.id.desc()).where(sql`${t.objectId} is not null`),
    index('workflow_run_open_idx').on(t.workspaceId, t.wakeAt).where(sql`${t.status} in ('pending', 'running')`),
  ],
);
