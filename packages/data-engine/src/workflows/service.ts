import {
  ACTIONS,
  type Actor,
  actionInputProblem,
  activityDays,
  CORE_OWNER,
  type FieldMetadata,
  type Filter,
  fieldIdOf,
  fieldNameOf,
  type InstalledModule,
  isTimeZone,
  keyOfId,
  literalObjectOf,
  mapFilterFields,
  newId,
  objectByKey,
  ownerOfId,
  RESERVED_FIELD_NAMES,
  stepInputProblem,
  stepLimitsProblem,
  TASK_FILTER_FIELDS,
  templateReferences,
  triggerFollowsLog,
  triggerObjectIdOf,
  WORKFLOW_ACTIVITY_DEFAULT_DAYS,
  WORKFLOW_RUN_DEFAULT_LIMIT,
  WORKFLOW_RUN_RETENTION,
  type Workflow,
  type WorkflowActivity,
  type WorkflowActivityQuery,
  type WorkflowHealth,
  type WorkflowInput,
  WorkflowInputSchema,
  type WorkflowRun,
  type WorkflowRunPage,
  type WorkflowRunQuery,
  WorkflowRunSchema,
  type WorkflowStep,
  type WorkflowStepInput,
  WorkflowStepSchema,
  type WorkflowTrigger,
  WorkflowTriggerSchema,
  walkSteps,
  workflowCanRun,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, lockWorkspace, writeEvents } from '../events/feed';
import type { MetadataService } from '../metadata/service';
import type { Snapshot } from '../metadata/snapshot';
import { authorize } from '../permissions/policy';
import { validateFilterOver, validateQuery } from '../query/validate';

/**
 * Persistence and validation for workflows. Running them is the server runtime's job (it needs the function
 * runner); this service owns the rows, the event-log cursors, the schedule and the run history.
 */
export interface WorkflowService {
  list(ctx: EngineContext): Promise<Workflow[]>;
  get(ctx: EngineContext, id: string): Promise<Workflow>;
  create(ctx: EngineContext, input: unknown): Promise<Workflow>;
  update(ctx: EngineContext, id: string, patch: unknown): Promise<Workflow>;
  delete(ctx: EngineContext, id: string): Promise<void>;
  /** A workflow's runs, newest first; page with `nextCursor`. */
  listRuns(ctx: EngineContext, workflowId: string, query?: WorkflowRunQuery): Promise<WorkflowRunPage>;
  getRun(ctx: EngineContext, workflowId: string, runId: string): Promise<WorkflowRun>;
  /** Runs per day over the last days, and how every workflow that has run is doing. */
  activity(ctx: EngineContext, query?: WorkflowActivityQuery): Promise<WorkflowActivity>;

  /** Internal, unauthenticated readers and writers for the runner. */
  listEnabled(workspaceId: string): Promise<Workflow[]>;
  getCursor(workspaceId: string, workflowId: string): Promise<number | null>;
  setCursor(workspaceId: string, workflowId: string, sequence: number): Promise<void>;
  setNextRun(workspaceId: string, workflowId: string, at: Date | null): Promise<void>;
  /** Persist a finished run, stamp `lastRunAt` and announce it on the change feed. */
  recordRun(workspaceId: string, run: Omit<WorkflowRun, 'id'>): Promise<WorkflowRun>;
}

export interface WorkflowServiceDeps {
  db: Db;
  metadata: MetadataService;
  bus: EventBus;
  clock: () => Date;
  /** Runs kept per workflow (default 1000). */
  retention?: number;
}

interface WorkflowRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  enabled: boolean;
  trigger: unknown;
  steps: unknown;
  cursor: unknown;
  next_run_at: unknown;
  last_run_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface RunRow extends Record<string, unknown> {
  id: string;
  workflow_id: string;
  status: string;
  trigger: unknown;
  steps: unknown;
  error: string | null;
  started_at: unknown;
  finished_at: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORKFLOW_COLUMNS = sql.raw(
  'id, workspace_id, title, description, enabled, trigger, steps, cursor, next_run_at, last_run_at, created_at, updated_at',
);
const RUN_COLUMNS = sql.raw('id, workflow_id, status, trigger, steps, error, started_at, finished_at');

const toWorkflow = (row: WorkflowRow): Workflow => ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  description: row.description ?? undefined,
  enabled: row.enabled,
  trigger: WorkflowTriggerSchema.parse(parseJson(row.trigger)),
  steps: (parseJson<unknown[]>(row.steps) ?? []).map((step) => WorkflowStepSchema.parse(step)),
  lastRunAt: row.last_run_at === null || row.last_run_at === undefined ? null : toIso(row.last_run_at),
  nextRunAt: row.next_run_at === null || row.next_run_at === undefined ? null : toIso(row.next_run_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const toRun = (row: RunRow): WorkflowRun =>
  WorkflowRunSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    trigger: parseJson(row.trigger),
    steps: parseJson(row.steps) ?? [],
    error: row.error ?? undefined,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  });

/** A schedule's next tick, from `now`. */
export const nextScheduledRun = (trigger: WorkflowTrigger, enabled: boolean, now: Date): Date | null =>
  enabled && trigger.kind === 'schedule' ? new Date(now.getTime() + trigger.everyMinutes * 60_000) : null;

/**
 * The workflow with the objects and fields its trigger and its branches name stored as ids. What the agent and the API
 * send may name an object or a field by its API name (a system column by its name too): the server keeps the ids. What
 * names nothing is left as it is, for `validateWorkflow` to refuse.
 */
export const normalizeWorkflow = (snapshot: Snapshot, input: WorkflowInput): WorkflowInput => {
  const { index } = snapshot;
  const objectIdOf = (ref: string): string => objectByKey(index, ref)?.id ?? ref;
  const fieldsOf = (objectId: string): FieldMetadata[] => index.fieldsByObjectId.get(objectId) ?? [];
  const conditionOf = (objectId: string | undefined, filter: Filter): Filter =>
    objectId ? mapFilterFields(filter, (ref) => fieldIdOf(fieldsOf(objectId), ref)) : filter;
  const { trigger } = input;
  let normalized: WorkflowTrigger = trigger;

  if (trigger.kind === 'record_event') {
    const objectId = objectIdOf(trigger.objectId);
    normalized = {
      ...trigger,
      objectId,
      ...(trigger.fieldIds ? { fieldIds: trigger.fieldIds.map((ref) => fieldIdOf(fieldsOf(objectId), ref)) } : {}),
      ...(trigger.condition ? { condition: conditionOf(objectId, trigger.condition) } : {}),
    };
  } else if (trigger.kind === 'manual') {
    normalized = { ...trigger, objectId: objectIdOf(trigger.objectId) };
  } else if (trigger.kind === 'schedule') {
    const objectId = trigger.objectId ? objectIdOf(trigger.objectId) : undefined;
    normalized = {
      ...trigger,
      ...(objectId ? { objectId } : {}),
      ...(trigger.condition ? { condition: conditionOf(objectId, trigger.condition) } : {}),
    };
  }

  const recordObjectId = triggerObjectIdOf(normalized);
  const steps = (list: WorkflowStepInput[]): WorkflowStepInput[] =>
    list.map((step) =>
      step.kind === 'branch'
        ? { ...step, condition: conditionOf(recordObjectId, step.condition), yes: steps(step.yes), no: steps(step.no) }
        : step,
    );

  return { ...input, trigger: normalized, steps: steps(input.steps) };
};

/**
 * Check a workflow against the workspace metadata: the objects, fields and filters, the actions (core's, or installed
 * modules') and the events it refers to must exist, and a workflow must be allowed to run each action. Throws
 * VALIDATION with the offending path.
 */
export const validateWorkflow = (snapshot: Snapshot, input: WorkflowInput): void => {
  const { index } = snapshot;
  /** The API names of the fields of the object a step's input names (a records action takes the object by name). */
  const objectFields = (objectName: string, path: string): Set<string> => {
    const object = index.objectsByName.get(objectName);

    if (!object) {
      throw validationError(`Unknown object "${objectName}"`, { path, object: objectName });
    }

    return new Set((index.fieldsByObjectId.get(object.id) ?? []).map((field) => field.name));
  };
  /** The object a trigger names, by id, with the ids of its fields. */
  const triggerObject = (objectId: string, path: string) => {
    const object = index.objectsById.get(objectId);

    if (!object) {
      throw validationError(`Unknown object "${objectId}"`, { path, objectId });
    }

    const fields = index.fieldsByObjectId.get(object.id) ?? [];

    return { object, fieldIds: new Set(fields.map((field) => field.id)), fields };
  };
  /** A stored condition as a query reads it: with the API names of the fields. */
  const namesOf = (filter: Filter, fields: FieldMetadata[]): Filter =>
    mapFilterFields(filter, (ref) => fieldNameOf(fields, ref));
  /** A module installed in the workspace, or VALIDATION naming it. */
  const moduleAt = (id: string, path: string): InstalledModule => {
    const module = snapshot.schema.modules.find((candidate) => candidate.moduleId === id);

    if (!module) {
      throw validationError(`Module "${id}" is not installed`, { path });
    }

    return module;
  };
  const { trigger } = input;

  if (trigger.kind === 'event') {
    const module = moduleAt(trigger.moduleId, 'trigger.moduleId');

    if (module.events.length === 0) {
      throw validationError(`${module.name} does not deliver events`, { path: 'trigger.moduleId' });
    }
  } else if (trigger.kind === 'record_event') {
    const target = triggerObject(trigger.objectId, 'trigger.objectId');

    for (const id of trigger.fieldIds ?? []) {
      if (!target.fieldIds.has(id)) {
        throw validationError(`Unknown field "${id}" on ${target.object.nameSingular}`, {
          path: 'trigger.fieldIds',
          fieldId: id,
        });
      }
    }

    if (trigger.condition) {
      validateQuery(index, {
        object: target.object.nameSingular,
        filter: namesOf(trigger.condition, target.fields),
      });
    }
  } else if (trigger.kind === 'task_event') {
    if (trigger.statuses && !trigger.types.includes('status_changed')) {
      throw validationError('`statuses` belong to the `status_changed` event', { path: 'trigger.statuses' });
    }

    if (trigger.condition) {
      validateFilterOver(trigger.condition, TASK_FILTER_FIELDS);
    }
  } else if (trigger.kind === 'manual') {
    triggerObject(trigger.objectId, 'trigger.objectId');
  } else {
    const target = trigger.objectId ? triggerObject(trigger.objectId, 'trigger.objectId') : undefined;

    if (trigger.condition) {
      if (!target) {
        throw validationError('A schedule condition needs an object', { path: 'trigger.objectId' });
      }

      validateQuery(index, { object: target.object.nameSingular, filter: namesOf(trigger.condition, target.fields) });
    }
  }

  const recordObject = triggerObjectIdOf(trigger);
  /** A task trigger provides a task as `record`, though it has no object. */
  const providesRecord = recordObject !== undefined || trigger.kind === 'task_event';
  const limits = stepLimitsProblem(input.steps);

  if (limits) {
    throw validationError(limits, { path: 'steps' });
  }

  const seen = new Set<string>();
  let i = 0;
  walkSteps(input.steps, (step, place) => {
    const path = place.parent ? `steps.${place.parent}.${place.lane}.${i}` : `steps.${i}`;
    i += 1;

    if (step.id !== undefined) {
      if (seen.has(step.id)) {
        throw validationError(`Step id "${step.id}" is used twice`, { path });
      }

      seen.add(step.id);
    }

    const checkValues = (objectName: string, values: Record<string, unknown>) => {
      const fields = objectFields(objectName, `${path}.input.object`);

      for (const key of Object.keys(values)) {
        if (RESERVED_FIELD_NAMES.has(key)) {
          throw validationError(`"${key}" is a system field and cannot be set`, {
            path: `${path}.input.values`,
            field: key,
          });
        }

        if (!fields.has(key)) {
          throw validationError(`Unknown field "${key}" on ${objectName}`, {
            path: `${path}.input.values`,
            field: key,
          });
        }
      }
    };

    switch (step.kind) {
      case 'action': {
        const at = `${path}.actionId`;

        if (
          !providesRecord &&
          templateReferences(step.input).some((ref) => ref === 'record' || ref.startsWith('record.'))
        ) {
          throw validationError('This trigger provides no record for {{record…}} to refer to', {
            path: `${path}.input`,
          });
        }

        const core = ACTIONS.find((spec) => spec.id === step.actionId);

        if (core) {
          if (!workflowCanRun(core)) {
            throw validationError(`A workflow cannot run "${core.summary}" (it needs ${core.permission})`, {
              path: at,
            });
          }

          const problem = stepInputProblem(core, step.input);

          if (problem) {
            throw validationError(problem.message, { path: `${path}.input.${problem.key}` });
          }

          // A records action on an object named outright: the object and the fields it sets must exist.
          const object = literalObjectOf(step.input);

          if (object) {
            objectFields(object, `${path}.input.object`);
          }

          const values = step.input.values;

          if (object && values && typeof values === 'object' && !Array.isArray(values)) {
            checkValues(object, values as Record<string, unknown>);
          }

          return;
        }

        const owner = ownerOfId(step.actionId);

        if (!owner || owner === CORE_OWNER) {
          throw validationError(`Unknown action "${step.actionId}"`, { path: at });
        }

        const module = moduleAt(owner, at);
        const declared = module.actions.find((candidate) => candidate.id === step.actionId);

        if (!declared) {
          throw validationError(`${module.name} has no action "${keyOfId(step.actionId)}"`, { path: at });
        }

        const problem = actionInputProblem(declared, step.input);

        if (problem) {
          throw validationError(problem.message, { path: `${path}.input.${problem.name}` });
        }

        return;
      }
      case 'branch':
        if (!providesRecord) {
          throw validationError('A branch needs a trigger that provides a record to test', { path: `${path}.kind` });
        }

        if (!recordObject) {
          validateFilterOver(step.condition, TASK_FILTER_FIELDS);

          return;
        }

        {
          const target = triggerObject(recordObject, 'trigger.objectId');
          validateQuery(index, {
            object: target.object.nameSingular,
            filter: namesOf(step.condition, target.fields),
          });
        }

        return;
      default:
        return;
    }
  });
};

const parseInput = (input: unknown, message: string): WorkflowInput => {
  const parsed = WorkflowInputSchema.safeParse(input);

  if (!parsed.success) {
    throw fromZodError(parsed.error, message);
  }

  return parsed.data;
};

const withStepIds = (steps: WorkflowStepInput[]): WorkflowStep[] =>
  steps.map((step) =>
    step.kind === 'branch'
      ? ({
          ...step,
          id: step.id ?? newId(),
          yes: withStepIds(step.yes),
          no: withStepIds(step.no),
        } as WorkflowStep)
      : ({ ...step, id: step.id ?? newId() } as WorkflowStep),
  );

export const createWorkflowService = (deps: WorkflowServiceDeps): WorkflowService => {
  const { db, metadata, bus, clock } = deps;
  const retention = deps.retention ?? WORKFLOW_RUN_RETENTION;
  const inserted = new Map<string, number>();

  /** The workflow with ids in the place of API names, checked against the snapshot: objects, fields and installed modules. */
  const validate = async (ctx: EngineContext, input: WorkflowInput): Promise<WorkflowInput> => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);
    const normalized = normalizeWorkflow(snapshot, input);
    validateWorkflow(snapshot, normalized);

    return normalized;
  };

  const readOne = async (workspaceId: string, id: string): Promise<Workflow | null> => {
    if (!UUID.test(id)) {
      return null;
    }

    const rows = await runRaw<WorkflowRow>(
      db,
      sql`SELECT ${WORKFLOW_COLUMNS} FROM workflow WHERE workspace_id = ${workspaceId} AND id = ${id}::uuid`,
    );

    return rows[0] ? toWorkflow(rows[0]) : null;
  };

  const find = async (ctx: EngineContext, id: string): Promise<Workflow> => {
    const workflow = await readOne(ctx.workspaceId, id);

    if (!workflow) {
      throw notFound('Workflow', id);
    }

    return workflow;
  };

  /** One write transaction: lock the workspace, mutate, announce on the feed. */
  const write = async <T>(
    ctx: EngineContext,
    mutate: (tx: Db, now: Date, eventSeq: number) => Promise<{ result: T; workflowId: string; action: string }>,
  ): Promise<T> => {
    const now = clock();
    const outcome = await db.transaction(async (tx) => {
      const state = await lockWorkspace(tx, ctx.workspaceId);
      const { result, workflowId, action } = await mutate(tx, now, state.eventSeq);
      const sequence = await allocateSequences(tx, ctx.workspaceId, 1);
      await writeEvents(tx, ctx.workspaceId, [
        {
          sequence,
          type: 'workflow.changed',
          actor: ctx.actor,
          occurredAt: now,
          entity: 'workflow',
          entityId: workflowId,
          payload: { action },
        },
      ]);
      await bus.publish(tx, ctx.workspaceId, { seq: sequence });

      return { result, sequence };
    });
    bus.emitLocal(ctx.workspaceId, { seq: outcome.sequence });

    return outcome.result;
  };

  const prune = async (workspaceId: string, workflowId: string) => {
    await runRaw(
      db,
      sql`DELETE FROM workflow_run WHERE workspace_id = ${workspaceId} AND workflow_id = ${workflowId}::uuid
          AND id NOT IN (SELECT id FROM workflow_run WHERE workflow_id = ${workflowId}::uuid ORDER BY id DESC LIMIT ${retention})`,
    );
  };

  return {
    list: async (ctx) => {
      authorize(ctx, 'workflow.read');
      const rows = await runRaw<WorkflowRow>(
        db,
        sql`SELECT ${WORKFLOW_COLUMNS} FROM workflow WHERE workspace_id = ${ctx.workspaceId} ORDER BY created_at ASC, id ASC`,
      );

      return rows.map(toWorkflow);
    },

    get: async (ctx, id) => {
      authorize(ctx, 'workflow.read');

      return find(ctx, id);
    },

    create: async (ctx, rawInput) => {
      authorize(ctx, 'workflow.manage');
      const input = await validate(ctx, parseInput(rawInput, 'Invalid workflow'));
      const id = newId();
      const steps = withStepIds(input.steps);
      const enabled = input.enabled ?? true;

      return write(ctx, async (tx, now, eventSeq) => {
        const nextRunAt = nextScheduledRun(input.trigger, enabled, now);
        const cursor = triggerFollowsLog(input.trigger) ? eventSeq : null;
        const rows = await runRaw<WorkflowRow>(
          tx,
          sql`INSERT INTO workflow (id, workspace_id, title, description, enabled, trigger, steps, cursor, next_run_at, created_by, created_at, updated_at)
              VALUES (${id}::uuid, ${ctx.workspaceId}, ${input.title}, ${input.description ?? null}, ${enabled},
                ${JSON.stringify(input.trigger)}::jsonb, ${JSON.stringify(steps)}::jsonb, ${cursor},
                ${nextRunAt ? nextRunAt.toISOString() : null}::timestamptz, ${`${ctx.actor.kind}:${ctx.actor.id}`},
                ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
              RETURNING ${WORKFLOW_COLUMNS}`,
        );
        const row = rows[0];

        if (!row) {
          throw new EngineError('INTERNAL', 'Insert returned no workflow');
        }

        return { result: toWorkflow(row), workflowId: id, action: 'created' };
      });
    },

    update: async (ctx, id, rawPatch) => {
      authorize(ctx, 'workflow.manage');
      const current = await find(ctx, id);
      const parsed = WorkflowInputSchema.partial().safeParse(rawPatch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid workflow');
      }

      const patch = parsed.data;
      const raw = typeof rawPatch === 'object' && rawPatch !== null ? (rawPatch as Record<string, unknown>) : {};
      const merged = await validate(ctx, {
        title: patch.title ?? current.title,
        description: Object.hasOwn(raw, 'description') ? patch.description : current.description,
        enabled: patch.enabled ?? current.enabled,
        trigger: patch.trigger ?? current.trigger,
        steps: patch.steps ?? current.steps,
      });
      const steps = withStepIds(merged.steps);
      const enabled = merged.enabled ?? true;
      // A new trigger or a re-enable starts from now: no replay of what happened in between.
      const restart = patch.trigger !== undefined || (patch.enabled !== undefined && patch.enabled !== current.enabled);

      return write(ctx, async (tx, now, eventSeq) => {
        const nextRunAt = restart || !enabled ? nextScheduledRun(merged.trigger, enabled, now) : undefined;
        const cursor = restart ? (triggerFollowsLog(merged.trigger) ? eventSeq : null) : undefined;
        const rows = await runRaw<WorkflowRow>(
          tx,
          sql`UPDATE workflow SET title = ${merged.title}, description = ${merged.description ?? null}, enabled = ${enabled},
                trigger = ${JSON.stringify(merged.trigger)}::jsonb, steps = ${JSON.stringify(steps)}::jsonb,
                cursor = ${cursor === undefined ? sql`cursor` : cursor},
                next_run_at = ${nextRunAt === undefined ? sql`next_run_at` : sql`${nextRunAt ? nextRunAt.toISOString() : null}::timestamptz`},
                updated_at = ${now.toISOString()}::timestamptz
              WHERE workspace_id = ${ctx.workspaceId} AND id = ${id}::uuid
              RETURNING ${WORKFLOW_COLUMNS}`,
        );
        const row = rows[0];

        if (!row) {
          throw notFound('Workflow', id);
        }

        return { result: toWorkflow(row), workflowId: id, action: 'updated' };
      });
    },

    delete: async (ctx, id) => {
      authorize(ctx, 'workflow.manage');
      await find(ctx, id);
      await write(ctx, async (tx) => {
        await runRaw(tx, sql`DELETE FROM workflow WHERE workspace_id = ${ctx.workspaceId} AND id = ${id}::uuid`);

        return { result: undefined, workflowId: id, action: 'deleted' };
      });
    },

    listRuns: async (ctx, workflowId, query = {}) => {
      authorize(ctx, 'workflow.read');
      await find(ctx, workflowId);
      const limit = query.limit ?? WORKFLOW_RUN_DEFAULT_LIMIT;

      if (query.cursor !== undefined && !UUID.test(query.cursor)) {
        throw new EngineError('INVALID_CURSOR', 'The runs cursor is malformed');
      }

      // Run ids are time-ordered (uuid v7), so they page newest-first without a timestamp tiebreaker.
      const rows = await runRaw<RunRow>(
        db,
        sql`SELECT ${RUN_COLUMNS} FROM workflow_run
            WHERE workspace_id = ${ctx.workspaceId} AND workflow_id = ${workflowId}::uuid
            ${query.cursor === undefined ? sql`` : sql`AND id < ${query.cursor}::uuid`}
            ORDER BY id DESC LIMIT ${limit + 1}`,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return { items: page.map(toRun), nextCursor: rows.length > limit && last ? last.id : null };
    },

    getRun: async (ctx, workflowId, runId) => {
      authorize(ctx, 'workflow.read');
      await find(ctx, workflowId);
      const rows = UUID.test(runId)
        ? await runRaw<RunRow>(
            db,
            sql`SELECT ${RUN_COLUMNS} FROM workflow_run
                WHERE workspace_id = ${ctx.workspaceId} AND workflow_id = ${workflowId}::uuid AND id = ${runId}::uuid`,
          )
        : [];
      const row = rows[0];

      if (!row) {
        throw new EngineError('NOT_FOUND', `No run "${runId}" of this workflow`);
      }

      return toRun(row);
    },

    activity: async (ctx, query = {}) => {
      authorize(ctx, 'workflow.read');
      const tz = query.tz ?? 'UTC';

      if (!isTimeZone(tz)) {
        throw new EngineError('VALIDATION', `Unknown time zone "${tz}"`);
      }

      const dates = activityDays(clock(), query.days ?? WORKFLOW_ACTIVITY_DEFAULT_DAYS, tz);
      // The first day's midnight, in the time zone.
      const since = sql`(${dates[0]}::date::timestamp AT TIME ZONE ${tz})`;
      const perDay = await runRaw<{ day: string; status: string; count: unknown }>(
        db,
        sql`SELECT to_char(finished_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, status, count(*) AS count
            FROM workflow_run WHERE workspace_id = ${ctx.workspaceId} AND finished_at >= ${since}
            GROUP BY 1, 2`,
      );
      const counts = new Map<string, { succeeded: number; failed: number }>();

      for (const row of perDay) {
        const day = counts.get(row.day) ?? { succeeded: 0, failed: 0 };
        day[row.status === 'failed' ? 'failed' : 'succeeded'] += toNumber(row.count);
        counts.set(row.day, day);
      }

      const totals = await runRaw<{ workflow_id: string; runs: unknown; failed: unknown }>(
        db,
        sql`SELECT workflow_id, count(*) FILTER (WHERE finished_at >= ${since}) AS runs,
              count(*) FILTER (WHERE finished_at >= ${since} AND status = 'failed') AS failed
            FROM workflow_run WHERE workspace_id = ${ctx.workspaceId} GROUP BY workflow_id`,
      );
      const latest = await runRaw<{ workflow_id: string; id: string; status: string; error: string | null }>(
        db,
        sql`SELECT DISTINCT ON (workflow_id) workflow_id, id, status, error
            FROM workflow_run WHERE workspace_id = ${ctx.workspaceId} ORDER BY workflow_id, id DESC`,
      );
      const totalsOf = new Map(totals.map((row) => [row.workflow_id, row]));

      return {
        days: dates.map((date) => ({ date, ...(counts.get(date) ?? { succeeded: 0, failed: 0 }) })),
        workflows: latest.map((row): WorkflowHealth => {
          const total = totalsOf.get(row.workflow_id);

          return {
            workflowId: row.workflow_id,
            runs: total ? toNumber(total.runs) : 0,
            failed: total ? toNumber(total.failed) : 0,
            lastRunId: row.id,
            lastStatus: row.status === 'failed' ? 'failed' : 'succeeded',
            ...(row.status === 'failed' && row.error ? { lastError: row.error } : {}),
          };
        }),
      };
    },

    listEnabled: async (workspaceId) => {
      const rows = await runRaw<WorkflowRow>(
        db,
        sql`SELECT ${WORKFLOW_COLUMNS} FROM workflow WHERE workspace_id = ${workspaceId} AND enabled ORDER BY created_at ASC, id ASC`,
      );

      return rows.map(toWorkflow);
    },

    getCursor: async (workspaceId, workflowId) => {
      const rows = await runRaw<{ cursor: unknown }>(
        db,
        sql`SELECT cursor FROM workflow WHERE workspace_id = ${workspaceId} AND id = ${workflowId}::uuid`,
      );
      const row = rows[0];

      return row && row.cursor !== null && row.cursor !== undefined ? toNumber(row.cursor) : null;
    },

    setCursor: async (workspaceId, workflowId, sequence) => {
      await runRaw(
        db,
        sql`UPDATE workflow SET cursor = ${sequence} WHERE workspace_id = ${workspaceId} AND id = ${workflowId}::uuid`,
      );
    },

    setNextRun: async (workspaceId, workflowId, at) => {
      await runRaw(
        db,
        sql`UPDATE workflow SET next_run_at = ${at ? at.toISOString() : null}::timestamptz WHERE workspace_id = ${workspaceId} AND id = ${workflowId}::uuid`,
      );
    },

    recordRun: async (workspaceId, run) => {
      const id = newId();
      const actor: Actor = { kind: 'workflow', id: run.workflowId };
      const outcome = await db.transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const rows = await runRaw<RunRow>(
          tx,
          sql`INSERT INTO workflow_run (id, workspace_id, workflow_id, status, trigger, steps, error, started_at, finished_at)
              VALUES (${id}::uuid, ${workspaceId}, ${run.workflowId}::uuid, ${run.status}, ${JSON.stringify(run.trigger)}::jsonb,
                ${JSON.stringify(run.steps)}::jsonb, ${run.error ?? null}, ${run.startedAt}::timestamptz, ${run.finishedAt}::timestamptz)
              RETURNING ${RUN_COLUMNS}`,
        );
        const row = rows[0];

        if (!row) {
          throw new EngineError('INTERNAL', 'Insert returned no run');
        }

        await runRaw(
          tx,
          sql`UPDATE workflow SET last_run_at = ${run.finishedAt}::timestamptz WHERE workspace_id = ${workspaceId} AND id = ${run.workflowId}::uuid`,
        );
        const sequence = await allocateSequences(tx, workspaceId, 1);
        await writeEvents(tx, workspaceId, [
          {
            sequence,
            type: 'workflow.run',
            actor,
            occurredAt: new Date(run.finishedAt),
            entity: 'workflow',
            entityId: run.workflowId,
            payload: { runId: id, status: run.status },
          },
        ]);
        await bus.publish(tx, workspaceId, { seq: sequence });

        return { run: toRun(row), sequence };
      });
      bus.emitLocal(workspaceId, { seq: outcome.sequence });
      const count = (inserted.get(run.workflowId) ?? 0) + 1;
      inserted.set(run.workflowId, count);

      if (count % 100 === 0) {
        await prune(workspaceId, run.workflowId);
      }

      return outcome.run;
    },
  };
};
