import {
  type Actor,
  JOB_DEFAULT_LIMIT,
  type Job,
  type JobPage,
  type JobQuery,
  JobQuerySchema,
  type JobStatus,
  newId,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, lockWorkspace, writeEvents } from '../events/feed';
import { authorize } from '../permissions/policy';

/**
 * Modules' background jobs: what their code (or a schedule) asked to run later, with retries. The server's job worker
 * claims due ones (`claim`), runs them with the module's code, and records the outcome (`complete`, `fail`). People and
 * the agent list them and retry a failed one. A job that fails for good is announced on the change feed.
 */
export interface JobsService {
  list(ctx: EngineContext, query?: unknown): Promise<JobPage>;
  get(ctx: EngineContext, id: string): Promise<Job>;
  /** A failed job goes back to pending, due now, with its attempts reset (owners and admins). */
  retry(ctx: EngineContext, id: string): Promise<Job>;

  /** Internal, for the module runtime and the worker. Enqueuing with a known key returns that job instead. */
  enqueue(workspaceId: string, input: EnqueueJob): Promise<Job>;
  /** Take up to `limit` due jobs, across workspaces, for `leaseMs`: running, one more attempt each. */
  claim(options: { limit: number; leaseMs: number }): Promise<ClaimedJob[]>;
  complete(job: ClaimedJob, result: unknown): Promise<void>;
  /** A failed attempt: due again at `retryAt`, or failed for good (and announced) without one. */
  fail(job: ClaimedJob, error: string, retryAt: Date | null): Promise<void>;
  /** Drop finished jobs older than `before`; returns how many. */
  prune(before: Date): Promise<number>;
}

export interface EnqueueJob {
  moduleId: string;
  name: string;
  payload?: unknown;
  /** One job per key and module in a workspace: a second enqueue returns the first. */
  key?: string | undefined;
  runAt?: Date | undefined;
  /** Attempts in all, the first included. */
  maxAttempts: number;
  schedule?: string | undefined;
  connectionId?: string | undefined;
  onBehalfOf?: string | null | undefined;
}

/** A job a worker holds, with what it needs to run it. */
export interface ClaimedJob extends Job {
  workspaceId: string;
  onBehalfOf: string | null;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  module_id: string;
  name: string;
  payload: unknown;
  result: unknown;
  idempotency_key: string | null;
  status: string;
  attempts: unknown;
  max_attempts: unknown;
  run_at: unknown;
  last_error: string | null;
  schedule: string | null;
  connection_id: string | null;
  on_behalf_of: string | null;
  created_at: unknown;
  updated_at: unknown;
  finished_at: unknown;
}

const COLUMNS = sql.raw(
  'id, workspace_id, module_id, name, payload, result, idempotency_key, status, attempts, max_attempts, run_at, ' +
    'last_error, schedule, connection_id, on_behalf_of, created_at, updated_at, finished_at',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Errors are kept to a readable length; the full text is in the server log. */
const ERROR_MAX = 2000;

const toJob = (row: JobRow): ClaimedJob => ({
  id: row.id,
  workspaceId: row.workspace_id,
  moduleId: row.module_id,
  name: row.name,
  status: row.status as JobStatus,
  payload: parseJson(row.payload) ?? null,
  result: parseJson(row.result) ?? null,
  attempts: toNumber(row.attempts),
  maxAttempts: toNumber(row.max_attempts),
  runAt: toIso(row.run_at),
  lastError: row.last_error,
  schedule: row.schedule,
  connectionId: row.connection_id,
  idempotencyKey: row.idempotency_key,
  onBehalfOf: row.on_behalf_of,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  finishedAt: row.finished_at === null || row.finished_at === undefined ? null : toIso(row.finished_at),
});

/** What callers see: the workspace and the person behind it stay internal. */
const publicJob = ({ workspaceId: _, onBehalfOf: __, ...job }: ClaimedJob): Job => job;

export const createJobsService = (deps: { db: Db; bus: EventBus; clock: () => Date }): JobsService => {
  const { db, bus, clock } = deps;

  const readRow = async (workspaceId: string, id: string): Promise<JobRow | null> => {
    if (!UUID.test(id)) {
      return null;
    }

    const rows = await runRaw<JobRow>(
      db,
      sql`SELECT ${COLUMNS} FROM job WHERE workspace_id = ${workspaceId} AND id = ${id}::uuid`,
    );

    return rows[0] ?? null;
  };

  return {
    list: async (ctx, rawQuery = {}) => {
      authorize(ctx, 'module.read');
      const parsed = JobQuerySchema.safeParse(rawQuery);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid job query');
      }

      const query: JobQuery = parsed.data;
      const limit = query.limit ?? JOB_DEFAULT_LIMIT;

      if (query.cursor !== undefined && !UUID.test(query.cursor)) {
        throw new EngineError('INVALID_CURSOR', 'The jobs cursor is malformed');
      }

      // Job ids are time-ordered (uuid v7), so they page newest-first on their own.
      const rows = await runRaw<JobRow>(
        db,
        sql`SELECT ${COLUMNS} FROM job WHERE workspace_id = ${ctx.workspaceId}
            ${query.module ? sql`AND module_id = ${query.module}` : sql``}
            ${query.status ? sql`AND status = ${query.status}` : sql``}
            ${query.name ? sql`AND name = ${query.name}` : sql``}
            ${query.cursor ? sql`AND id < ${query.cursor}::uuid` : sql``}
            ORDER BY id DESC LIMIT ${limit + 1}`,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map((row) => publicJob(toJob(row))),
        nextCursor: rows.length > limit && last ? last.id : null,
      };
    },

    get: async (ctx, id) => {
      authorize(ctx, 'module.read');
      const row = await readRow(ctx.workspaceId, id);

      if (!row) {
        throw new EngineError('NOT_FOUND', `No job "${id}"`);
      }

      return publicJob(toJob(row));
    },

    retry: async (ctx, id) => {
      authorize(ctx, 'module.manage');
      const row = await readRow(ctx.workspaceId, id);

      if (!row) {
        throw new EngineError('NOT_FOUND', `No job "${id}"`);
      }

      if (row.status !== 'failed') {
        throw new EngineError('CONFLICT', `Only failed jobs are retried; this one is ${row.status}`, {
          status: row.status,
        });
      }

      const now = clock().toISOString();
      const rows = await runRaw<JobRow>(
        db,
        sql`UPDATE job SET status = 'pending', attempts = 0, run_at = ${now}::timestamptz, locked_until = NULL,
              finished_at = NULL, updated_at = ${now}::timestamptz
            WHERE workspace_id = ${ctx.workspaceId} AND id = ${id}::uuid RETURNING ${COLUMNS}`,
      );

      return publicJob(toJob(rows[0] as JobRow));
    },

    enqueue: async (workspaceId, input) => {
      const now = clock();
      const runAt = (input.runAt ?? now).toISOString();
      const rows = await runRaw<JobRow>(
        db,
        sql`INSERT INTO job (id, workspace_id, module_id, name, payload, idempotency_key, status, max_attempts, run_at,
              schedule, connection_id, on_behalf_of, created_at, updated_at)
            VALUES (${newId()}::uuid, ${workspaceId}, ${input.moduleId}, ${input.name},
              ${JSON.stringify(input.payload ?? null)}::jsonb, ${input.key ?? null}, 'pending', ${input.maxAttempts},
              ${runAt}::timestamptz, ${input.schedule ?? null}, ${input.connectionId ?? null}, ${input.onBehalfOf ?? null},
              ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
            ON CONFLICT ON CONSTRAINT job_idempotency_uq DO NOTHING
            RETURNING ${COLUMNS}`,
      );

      if (rows[0]) {
        return publicJob(toJob(rows[0]));
      }

      // The key was used before: that job stands for this one.
      const existing = await runRaw<JobRow>(
        db,
        sql`SELECT ${COLUMNS} FROM job WHERE workspace_id = ${workspaceId} AND module_id = ${input.moduleId}
            AND idempotency_key = ${input.key ?? null}`,
      );

      if (!existing[0]) {
        throw new EngineError('INTERNAL', 'Enqueuing a job returned nothing');
      }

      return publicJob(toJob(existing[0]));
    },

    claim: async ({ limit, leaseMs }) => {
      const now = clock();
      const lease = new Date(now.getTime() + leaseMs).toISOString();
      const rows = await runRaw<JobRow>(
        db,
        sql`UPDATE job SET status = 'running', attempts = attempts + 1, locked_until = ${lease}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id IN (
              SELECT id FROM job
              WHERE (status = 'pending' AND run_at <= ${now.toISOString()}::timestamptz)
                 OR (status = 'running' AND locked_until < ${now.toISOString()}::timestamptz)
              ORDER BY run_at, id LIMIT ${limit}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING ${COLUMNS}`,
      );

      // RETURNING keeps no order: hand them over oldest due first.
      return rows.map(toJob).sort((a, b) => a.runAt.localeCompare(b.runAt) || a.id.localeCompare(b.id));
    },

    complete: async (job, result) => {
      const now = clock().toISOString();
      await runRaw(
        db,
        sql`UPDATE job SET status = 'succeeded', result = ${JSON.stringify(result ?? null)}::jsonb, last_error = NULL,
              locked_until = NULL, finished_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
            WHERE id = ${job.id}::uuid`,
      );
    },

    fail: async (job, error, retryAt) => {
      const now = clock();
      const message = error.length > ERROR_MAX ? `${error.slice(0, ERROR_MAX)}…` : error;

      if (retryAt) {
        await runRaw(
          db,
          sql`UPDATE job SET status = 'pending', run_at = ${retryAt.toISOString()}::timestamptz, last_error = ${message},
                locked_until = NULL, updated_at = ${now.toISOString()}::timestamptz
              WHERE id = ${job.id}::uuid`,
        );

        return;
      }

      const actor: Actor = { kind: 'system', id: `module:${job.moduleId}` };
      const sequence = await db.transaction(async (tx) => {
        await lockWorkspace(tx, job.workspaceId);
        await runRaw(
          tx,
          sql`UPDATE job SET status = 'failed', last_error = ${message}, locked_until = NULL,
                finished_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
              WHERE id = ${job.id}::uuid`,
        );
        const seq = await allocateSequences(tx, job.workspaceId, 1);
        await writeEvents(tx, job.workspaceId, [
          {
            sequence: seq,
            type: 'job.failed',
            actor,
            occurredAt: now,
            moduleId: job.moduleId,
            entity: 'job',
            entityId: job.id,
            payload: { name: job.name },
          },
        ]);
        await bus.publish(tx, job.workspaceId, { seq });

        return seq;
      });
      bus.emitLocal(job.workspaceId, { seq: sequence });
    },

    prune: async (before) => {
      const rows = await runRaw<{ id: string }>(
        db,
        sql`DELETE FROM job WHERE status IN ('succeeded', 'failed') AND finished_at < ${before.toISOString()}::timestamptz
            RETURNING id`,
      );

      return rows.length;
    },
  };
};
