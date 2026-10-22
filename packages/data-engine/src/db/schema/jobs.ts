import { index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Background work: jobs and a module's own small state. */

/**
 * A module's background job: one piece of work its code asked for (or a schedule did), run by the job worker with
 * retries. Workers claim due rows with `FOR UPDATE SKIP LOCKED` and hold them until `locked_until`; a worker that
 * dies leaves the row to be claimed again once that passes.
 */
export const job = pgTable(
  'job',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    moduleId: text().notNull(),
    name: text().notNull(),
    payload: jsonb().$type<unknown>(),
    /** What the last successful attempt returned. */
    result: jsonb().$type<unknown>(),
    /** Enqueuing again with the same key returns the job instead of adding one. */
    idempotencyKey: text(),
    /** `pending`, `running`, `succeeded` or `failed`. */
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(1),
    runAt: timestamptz().notNull().defaultNow(),
    lockedUntil: timestamptz(),
    lastError: text(),
    /** The schedule that started it. */
    schedule: text(),
    /** The connection it works with, when started for one. */
    connectionId: text(),
    /** The person whose action started it, for history. */
    onBehalfOf: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    finishedAt: timestamptz(),
  },
  (t) => [
    unique('job_idempotency_uq').on(t.workspaceId, t.moduleId, t.idempotencyKey),
    index('job_due_idx').on(t.status, t.runAt),
    index('job_ws_module_idx').on(t.workspaceId, t.moduleId, t.id.desc()),
  ],
);

/** A module's own small state, by key, in one workspace: sync cursors and the like. */
export const moduleKv = pgTable(
  'module_kv',
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
