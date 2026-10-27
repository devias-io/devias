import {
  ACTIONS,
  actionInputProblem,
  activityDays,
  calendarDay,
  coreIds,
  DeviasApiError,
  evaluateFilter,
  type Filter,
  fieldIdOf,
  fieldNameOf,
  fieldRef,
  filterFieldRefs,
  isAutomationActor,
  isRecordEvent,
  isTaskEvent,
  isTimeZone,
  literalObjectOf,
  type ModuleEventScope,
  mapFilterFields,
  matchesModuleEventTrigger,
  matchesRecordEventTrigger,
  matchesTaskCondition,
  matchesTaskEventTrigger,
  matchesTriggerCondition,
  nextCronTime,
  RECORD_WORKFLOW_RUNS_DEFAULT_LIMIT,
  RESERVED_FIELD_NAMES,
  type RecordData,
  type RecordEvent,
  type RecordWorkflowRunsQuery,
  type RunWorkflowInput,
  renderTemplate,
  richTextStepInput,
  stableStringify,
  stepInputProblem,
  stepLimitsProblem,
  systemFieldId,
  TASK_FILTER_FIELDS,
  type TaskComment,
  type TaskEventScope,
  type TaskInput,
  type TaskPatch,
  TRIGGER_RECORD_ID,
  taskConditionRecord,
  templateReferences,
  textStepInput,
  triggerObjectIdOf,
  WORKFLOW_ACTIVITY_DEFAULT_DAYS,
  WORKFLOW_RUN_DEFAULT_LIMIT,
  WORKFLOW_SCHEDULE_MAX_RECORDS,
  type Workflow,
  type WorkflowActivity,
  type WorkflowActivityQuery,
  type WorkflowHealth,
  type WorkflowInput,
  WorkflowInputSchema,
  type WorkflowRun,
  type WorkflowRunList,
  type WorkflowRunPage,
  type WorkflowRunQuery,
  type WorkflowRunStep,
  type WorkflowRunTrigger,
  type WorkflowStep,
  type WorkflowStepInput,
  type WorkflowTrigger,
  type WorkspaceEvent,
  walkSteps,
  workflowCanRun,
  workflowScope,
} from '@devias/core';
import { runModuleAction } from './module-connections';
import { sendNotification } from './notifications';
import { createRecord, deleteRecords, getRecord, resolveObject, updateRecord } from './records';
import type { MockStore, StoredRecord } from './store';
import { commentOnTask, createTask, deleteTask, updateTask } from './tasks';

/**
 * Workflows over the store: the same validation as the server, and a runner that reacts to the store's own
 * events, runs manual workflows on demand and ticks schedules when asked (`runDueWorkflows`). Steps can run the
 * record writes, send notifications and run installed modules' actions (those answer with a mock output: the mock
 * calls no outside service); other actions fail with a note that the mock does not run them.
 */

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

/** The API names of the fields of the object a step's input names (a records action takes the object by name). */
const objectFields = (store: MockStore, objectName: string, path: string): Set<string> => {
  const object = store.objectByName(objectName);

  if (!object) {
    throw validation(`Unknown object "${objectName}"`, { path, object: objectName });
  }

  return new Set(store.fieldsOf(object.id).map((field) => field.name));
};

/** The object a trigger names, by id. */
const triggerObject = (store: MockStore, objectId: string, path: string) => {
  const object = store.objectById(objectId);

  if (!object) {
    throw validation(`Unknown object "${objectId}"`, { path, objectId });
  }

  return object;
};

/** A stored condition as a query reads it: the fields by API name. */
const conditionNames = (store: MockStore, objectId: string, condition: Filter): Filter => {
  const fields = store.fieldsOf(objectId);

  return mapFilterFields(condition, (ref) => fieldNameOf(fields, ref));
};

/** A task trigger's (or its branches') condition tests the fields every task has. */
const checkTaskCondition = (condition: Filter, path: string) => {
  for (const field of filterFieldRefs(condition)) {
    if (!TASK_FILTER_FIELDS.some((candidate) => candidate.name === field)) {
      throw validation(`Unknown field "${field}" in filter`, { path, field });
    }
  }
};

const checkCondition = (store: MockStore, objectId: string, condition: Filter | undefined, path: string) => {
  if (!condition) {
    return;
  }

  const fields = store.fieldsOf(objectId);

  for (const field of filterFieldRefs(condition)) {
    if (!fieldRef(fields, field) && !systemFieldId(field)) {
      throw validation(`Unknown field "${field}" in filter`, { path, field });
    }
  }
};

/**
 * The workflow with the objects and fields its trigger and branches name stored as ids, as the server does: what a
 * client sends may name an object or a field by its API name.
 */
const normalizeMockWorkflow = (store: MockStore, input: WorkflowInput): WorkflowInput => {
  const objectIdOf = (ref: string): string => (store.objectByName(ref) ?? store.objectById(ref))?.id ?? ref;
  const conditionOf = (objectId: string | undefined, filter: Filter): Filter => {
    const fields = objectId ? store.fieldsOf(objectId) : [];

    return objectId ? mapFilterFields(filter, (ref) => fieldIdOf(fields, ref)) : filter;
  };
  const { trigger } = input;
  let normalized: WorkflowTrigger = trigger;

  if (trigger.kind === 'record_event') {
    const objectId = objectIdOf(trigger.objectId);
    const fields = store.fieldsOf(objectId);
    normalized = {
      ...trigger,
      objectId,
      ...(trigger.fieldIds ? { fieldIds: trigger.fieldIds.map((ref) => fieldIdOf(fields, ref)) } : {}),
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

/** An installed module and its name, or VALIDATION naming it. */
const moduleAt = (store: MockStore, id: string, path: string) => {
  const module = store.modules.get(id);

  if (!module) {
    throw validation(`Module "${id}" is not installed`, { path });
  }

  return { module, name: module.label };
};

/** The server's checks: objects, fields, filters and installed modules must exist. */
export const validateMockWorkflow = (store: MockStore, input: WorkflowInput): void => {
  const { trigger } = input;

  if (trigger.kind === 'module_event') {
    const { module, name } = moduleAt(store, trigger.moduleId, 'trigger.moduleId');

    if (module.events.length === 0) {
      throw validation(`${name} does not deliver events`, { path: 'trigger.moduleId' });
    }
  } else if (trigger.kind === 'record_event') {
    const object = triggerObject(store, trigger.objectId, 'trigger.objectId');
    const fieldIds = new Set(store.fieldsOf(object.id).map((field) => field.id));

    for (const id of trigger.fieldIds ?? []) {
      if (!fieldIds.has(id)) {
        throw validation(`Unknown field "${id}" on ${object.nameSingular}`, { path: 'trigger.fieldIds' });
      }
    }

    checkCondition(store, trigger.objectId, trigger.condition, 'trigger.condition');
  } else if (trigger.kind === 'task_event') {
    if (trigger.statuses && !trigger.types.includes('status_changed')) {
      throw validation('`statuses` belong to the `status_changed` event', { path: 'trigger.statuses' });
    }

    if (trigger.condition) {
      checkTaskCondition(trigger.condition, 'trigger.condition');
    }
  } else if (trigger.kind === 'manual') {
    triggerObject(store, trigger.objectId, 'trigger.objectId');
  } else {
    if (trigger.objectId) {
      triggerObject(store, trigger.objectId, 'trigger.objectId');
    }

    if (trigger.condition) {
      if (!trigger.objectId) {
        throw validation('A schedule condition needs an object', { path: 'trigger.objectId' });
      }

      checkCondition(store, trigger.objectId, trigger.condition, 'trigger.condition');
    }
  }

  const recordObject = triggerObjectIdOf(trigger);
  const providesRecord = recordObject !== undefined || trigger.kind === 'task_event';
  const limits = stepLimitsProblem(input.steps);

  if (limits) {
    throw validation(limits, { path: 'steps' });
  }

  const seen = new Set<string>();
  let i = 0;
  walkSteps(input.steps, (step, place) => {
    const path = place.parent ? `steps.${place.parent}.${place.lane}.${i}` : `steps.${i}`;
    i += 1;

    if (step.id !== undefined) {
      if (seen.has(step.id)) {
        throw validation(`Step id "${step.id}" is used twice`, { path });
      }

      seen.add(step.id);
    }

    const checkValues = (objectName: string, values: Record<string, unknown>) => {
      const fields = objectFields(store, objectName, `${path}.input.object`);

      for (const key of Object.keys(values)) {
        if (RESERVED_FIELD_NAMES.has(key)) {
          throw validation(`"${key}" is a system field and cannot be set`, {
            path: `${path}.input.values`,
            field: key,
          });
        }

        if (!fields.has(key)) {
          throw validation(`Unknown field "${key}" on ${objectName}`, { path: `${path}.input.values` });
        }
      }
    };

    if (step.kind === 'branch') {
      if (!providesRecord) {
        throw validation('A branch needs a trigger that provides a record to test', { path });
      }

      if (recordObject) {
        checkCondition(store, recordObject, step.condition, `${path}.condition`);
      } else {
        checkTaskCondition(step.condition, `${path}.condition`);
      }

      return;
    }

    if (
      !providesRecord &&
      templateReferences(step.input).some((ref) => ref === 'record' || ref.startsWith('record.'))
    ) {
      throw validation('This trigger provides no record for {{record…}} to refer to', { path: `${path}.input` });
    }

    const core = ACTIONS.find((spec) => spec.id === step.actionId);

    if (core) {
      if (!workflowCanRun(core)) {
        throw validation(`A workflow cannot run "${core.summary}" (it needs ${core.permission})`, {
          path: `${path}.action`,
        });
      }

      const problem = stepInputProblem(core, step.input);

      if (problem) {
        throw validation(problem.message, { path: `${path}.input.${problem.key}` });
      }

      const object = literalObjectOf(step.input);

      if (object) {
        objectFields(store, object, `${path}.input.object`);
      }

      const values = step.input.values;

      if (object && values && typeof values === 'object' && !Array.isArray(values)) {
        checkValues(object, values as Record<string, unknown>);
      }

      return;
    }

    // Not one of core's: an action an installed module declares.
    const action = [...store.modules.values()]
      .flatMap((module) => module.actions)
      .find((candidate) => candidate.id === step.actionId);

    if (!action) {
      throw validation(`Unknown action "${step.actionId}": no installed module declares it`, {
        path: `${path}.action`,
      });
    }

    const problem = actionInputProblem(action, step.input);

    if (problem) {
      throw validation(problem.message, { path: `${path}.input.${problem.name}` });
    }
  });
};

/** What a step can run here: record writes, notifications and installed modules' actions (with a mock output). */
/** The fields of an object by API name; none for a name that is not one, so the action can say so. */
const fieldsOfObject = (store: MockStore, name: string) => {
  try {
    return store.fieldsOf(resolveObject(store, name).id);
  } catch {
    return [];
  }
};

const runMockAction = (store: MockStore, actionId: string, input: Record<string, unknown>): unknown => {
  const object = String(input.object ?? '');
  const values = (input.values ?? {}) as Record<string, unknown>;

  switch (actionId) {
    case coreIds.actions.create_record:
      return createRecord(store, object, values);
    case coreIds.actions.update_record:
      return updateRecord(store, object, String(input.id ?? ''), values);
    case coreIds.actions.delete_record:
      deleteRecords(store, object, [String(input.id ?? '')]);

      return { done: true };
    case coreIds.actions.create_task:
      return createTask(store, input as TaskInput);
    case coreIds.actions.update_task: {
      const { id, ...patch } = input;

      return updateTask(store, String(id ?? ''), patch as TaskPatch);
    }
    case coreIds.actions.delete_task:
      deleteTask(store, String(input.id ?? ''));

      return { done: true };
    case coreIds.actions.comment_on_task: {
      const { id, ...comment } = input;

      return commentOnTask(store, String(id ?? ''), comment as TaskComment);
    }
    case coreIds.actions.send_notification:
      // As the workflow actor, which `executeWorkflow` swapped in: the rows and events carry it, and `to.me` fails.
      return sendNotification(store, input);
    default: {
      const owner = [...store.modules.values()].find((module) => module.actions.some((one) => one.id === actionId));
      const declared = owner?.actions.find((one) => one.id === actionId);

      if (owner && declared) {
        return runModuleAction(store, owner.id, declared.name, input);
      }

      throw new DeviasApiError(422, 'MISSING_DEPENDENCY', `The mock backend does not run "${actionId}" in workflows`);
    }
  }
};

const parse = (input: unknown): WorkflowInput => {
  const result = WorkflowInputSchema.safeParse(input);

  if (!result.success) {
    const summary = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

    throw validation(`Invalid workflow: ${summary.join('; ')}`, { issues: result.error.issues });
  }

  return result.data;
};

export const nextRun = (workflow: Pick<Workflow, 'trigger' | 'enabled'>, from: string): string | null =>
  workflow.enabled && workflow.trigger.kind === 'schedule'
    ? (nextCronTime(workflow.trigger.cron, new Date(from))?.toISOString() ?? null)
    : null;

const withIds = (store: MockStore, steps: WorkflowStepInput[]): WorkflowStep[] =>
  steps.map((step) =>
    step.kind === 'branch'
      ? ({
          ...step,
          id: step.id ?? store.newId(),
          yes: withIds(store, step.yes),
          no: withIds(store, step.no),
        } as WorkflowStep)
      : ({ ...step, id: step.id ?? store.newId() } as WorkflowStep),
  );

const byCreation = (a: Workflow, b: Workflow) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export const listWorkflows = (store: MockStore): Workflow[] =>
  structuredClone([...store.workflows.values()].sort(byCreation));

export const getWorkflow = (store: MockStore, id: string): Workflow => {
  const workflow = store.workflows.get(id);

  if (!workflow) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Workflow "${id}" not found`);
  }

  return structuredClone(workflow);
};

export const createWorkflow = (store: MockStore, rawInput: unknown): Workflow => {
  const input = normalizeMockWorkflow(store, parse(rawInput));
  validateMockWorkflow(store, input);
  const now = store.now();
  const enabled = input.enabled ?? true;
  const workflow: Workflow = {
    id: store.newId(),
    workspaceId: store.workspaceId,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    enabled,
    trigger: input.trigger,
    steps: withIds(store, input.steps),
    lastRunAt: null,
    nextRunAt: nextRun({ trigger: input.trigger, enabled }, now),
    createdAt: now,
    updatedAt: now,
  };
  store.workflows.set(workflow.id, workflow);
  store.emit({ type: 'workflow.changed', workflowId: workflow.id, action: 'created' });
  store.changed();

  return structuredClone(workflow);
};

export const updateWorkflow = (store: MockStore, id: string, rawPatch: unknown): Workflow => {
  const current = store.workflows.get(id);

  if (!current) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Workflow "${id}" not found`);
  }

  const result = WorkflowInputSchema.partial().safeParse(rawPatch);

  if (!result.success) {
    throw validation('Invalid workflow', { issues: result.error.issues });
  }

  const patch = result.data;
  const raw = typeof rawPatch === 'object' && rawPatch !== null ? (rawPatch as Record<string, unknown>) : {};

  // What a module ships is the module's: only turning it on or off is the workspace's, as on the server.
  if (current.moduleId) {
    const changed = (['title', 'description', 'trigger', 'steps'] as const).filter(
      (key) => Object.hasOwn(raw, key) && stableStringify(patch[key] ?? null) !== stableStringify(current[key] ?? null),
    );

    if (changed.length > 0) {
      throw new DeviasApiError(
        409,
        'CONFLICT',
        `"${current.title}" comes with a module, so its ${changed.join(' and ')} cannot be changed here. Turn it on or off, or make a copy to change.`,
      );
    }
  }

  const merged = normalizeMockWorkflow(store, {
    title: patch.title ?? current.title,
    description: Object.hasOwn(raw, 'description') ? patch.description : current.description,
    enabled: patch.enabled ?? current.enabled,
    trigger: patch.trigger ?? current.trigger,
    steps: patch.steps ?? current.steps,
  });
  validateMockWorkflow(store, merged);
  const now = store.now();
  const enabled = merged.enabled ?? true;
  const restart = patch.trigger !== undefined || (patch.enabled !== undefined && patch.enabled !== current.enabled);
  const next: Workflow = {
    ...current,
    title: merged.title,
    enabled,
    trigger: merged.trigger,
    steps: withIds(store, merged.steps),
    nextRunAt: restart || !enabled ? nextRun({ trigger: merged.trigger, enabled }, now) : current.nextRunAt,
    updatedAt: now,
  };

  if (merged.description === undefined) {
    delete next.description;
  } else {
    next.description = merged.description;
  }

  store.workflows.set(id, next);
  store.emit({ type: 'workflow.changed', workflowId: id, action: 'updated' });
  store.changed();

  return structuredClone(next);
};

export const deleteWorkflow = (store: MockStore, id: string): void => {
  const current = store.workflows.get(id);

  if (!current) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Workflow "${id}" not found`);
  }

  if (current.moduleId) {
    throw new DeviasApiError(
      409,
      'CONFLICT',
      `"${current.title}" comes with a module and goes when the module is uninstalled. Turn it off to stop it.`,
    );
  }

  store.workflows.delete(id);
  store.workflowRuns = store.workflowRuns.filter((run) => run.workflowId !== id);
  store.emit({ type: 'workflow.changed', workflowId: id, action: 'deleted' });
  store.changed();
};

export const listWorkflowRuns = (store: MockStore, id: string, query: WorkflowRunQuery = {}): WorkflowRunPage => {
  getWorkflow(store, id);
  const limit = query.limit ?? WORKFLOW_RUN_DEFAULT_LIMIT;
  const newestFirst = store.workflowRuns.filter((run) => run.workflowId === id).reverse();
  let start = 0;

  if (query.cursor !== undefined) {
    const index = newestFirst.findIndex((run) => run.id === query.cursor);

    if (index < 0) {
      throw new DeviasApiError(400, 'INVALID_CURSOR', 'The runs cursor is malformed');
    }

    start = index + 1;
  }

  const items = newestFirst.slice(start, start + limit);
  const last = items.at(-1);

  return { items: structuredClone(items), nextCursor: start + limit < newestFirst.length && last ? last.id : null };
};

type FinishedWorkflowRun = WorkflowRun & { status: 'succeeded' | 'failed'; finishedAt: string };

export const workflowActivity = (store: MockStore, query: WorkflowActivityQuery = {}): WorkflowActivity => {
  const tz = query.tz ?? 'UTC';

  if (!isTimeZone(tz)) {
    throw new DeviasApiError(400, 'VALIDATION', `Unknown time zone "${tz}"`);
  }

  const days = activityDays(new Date(store.now()), query.days ?? WORKFLOW_ACTIVITY_DEFAULT_DAYS, tz);
  // The mock carries a run out as it is queued, so every run it holds has finished.
  const finished = store.workflowRuns.filter(
    (run): run is FinishedWorkflowRun =>
      run.finishedAt !== null && (run.status === 'succeeded' || run.status === 'failed'),
  );
  const inPeriod = (run: FinishedWorkflowRun) => calendarDay(new Date(run.finishedAt), tz) >= (days[0] as string);
  const health = new Map<string, WorkflowHealth>();

  for (const run of finished) {
    const counted = inPeriod(run);
    const previous = health.get(run.workflowId);
    health.set(run.workflowId, {
      workflowId: run.workflowId,
      runs: (previous?.runs ?? 0) + (counted ? 1 : 0),
      failed: (previous?.failed ?? 0) + (counted && run.status === 'failed' ? 1 : 0),
      // Runs are stored oldest first, so the last one seen is the latest.
      lastRunId: run.id,
      lastStatus: run.status,
      ...(run.status === 'failed' && run.error ? { lastError: run.error } : {}),
    });
  }

  return {
    days: days.map((date) => {
      const runs = finished.filter((run) => calendarDay(new Date(run.finishedAt), tz) === date);
      const failed = runs.filter((run) => run.status === 'failed').length;

      return { date, succeeded: runs.length - failed, failed };
    }),
    workflows: [...health.values()],
  };
};

const publicRecord = (record: StoredRecord): RecordData => {
  const { deleted_at: _deletedAt, ...rest } = record;

  return structuredClone(rest);
};

const describeError = (error: unknown): string => {
  if (error instanceof DeviasApiError) {
    const issues = (error.details as { issues?: { field?: string; message: string }[] } | undefined)?.issues;

    if (Array.isArray(issues) && issues.length > 0) {
      return `${error.message}: ${issues.map((issue) => (issue.field ? `${issue.field}: ${issue.message}` : issue.message)).join('; ')}`;
    }

    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
};

/** Run every step as the workflow actor and record the run. */
export const executeWorkflow = (
  store: MockStore,
  workflow: Workflow,
  runTrigger: WorkflowRunTrigger,
  context: {
    record?: RecordData | Record<string, unknown> | null;
    event?: RecordEvent;
    moduleEvent?: ModuleEventScope;
    taskEvent?: TaskEventScope;
  },
): WorkflowRun => {
  const startedAt = store.now();
  const triggerObjectId = triggerObjectIdOf(workflow.trigger);
  const scope = workflowScope({
    workflow: { id: workflow.id, title: workflow.title },
    trigger: { kind: runTrigger.kind },
    record: context.record,
    event: context.event ?? context.moduleEvent ?? context.taskEvent,
    now: new Date(startedAt),
  });
  const steps: WorkflowRunStep[] = [];
  let error: string | undefined;
  const caller = store.actor;
  store.actor = { kind: 'workflow', id: workflow.id };
  /** Run a list of steps; false once a step failed (the failure is already recorded). */
  const runList = (list: WorkflowStep[]): boolean => {
    for (const step of list) {
      const base = {
        id: step.id,
        kind: step.kind,
        ...(step.kind === 'action' ? { actionId: step.actionId } : {}),
        ...(step.label ? { label: step.label } : {}),
      };

      try {
        let result: Pick<WorkflowRunStep, 'status' | 'output'>;

        if (step.kind === 'branch') {
          const matched = evaluateFilter(
            (scope.record ?? {}) as Record<string, unknown>,
            triggerObjectId ? conditionNames(store, triggerObjectId, step.condition) : step.condition,
          );
          steps.push({ ...base, status: 'succeeded', output: { matched, branch: matched ? 'yes' : 'no' } });

          if (scope.steps) {
            scope.steps[step.id] = { matched };
          }

          if (!runList(matched ? step.yes : step.no)) {
            return false;
          }

          continue;
        }

        const record = scope.record;

        if (
          context.event?.type === 'record.deleted' &&
          step.actionId === coreIds.actions.update_record &&
          step.input.id === TRIGGER_RECORD_ID
        ) {
          result = { status: 'skipped', output: { reason: 'The record was deleted' } };
        } else {
          // The same meeting of the author's text and the stored forms as the server's runner.
          const rendered = richTextStepInput(step.actionId, renderTemplate(step.input, scope), (name) =>
            fieldsOfObject(store, name),
          );
          const output = runMockAction(
            store,
            step.actionId,
            textStepInput(rendered, ACTIONS.find((spec) => spec.id === step.actionId)?.input) as Record<
              string,
              unknown
            >,
          );

          if (record && output && typeof output === 'object' && (output as { id?: unknown }).id === record.id) {
            scope.record =
              scope.trigger.kind === 'task_event'
                ? taskConditionRecord(output as Parameters<typeof taskConditionRecord>[0])
                : (output as RecordData);
          }

          result = { status: 'succeeded', output };
        }

        steps.push({ ...base, ...result });

        if (scope.steps) {
          scope.steps[step.id] = result.output ?? null;
        }
      } catch (cause) {
        const message = describeError(cause);
        steps.push({ ...base, status: 'failed', error: message });
        error = `Step ${steps.length} (${step.label ?? step.kind}) failed: ${message}`;

        return false;
      }
    }

    return true;
  };

  try {
    runList(workflow.steps);
  } finally {
    store.actor = caller;
  }

  const finishedAt = store.now();
  const run: WorkflowRun = {
    id: store.newId(),
    workflowId: workflow.id,
    status: error ? 'failed' : 'succeeded',
    trigger: runTrigger,
    steps,
    ...(error ? { error } : {}),
    createdAt: startedAt,
    startedAt,
    finishedAt,
  };
  store.workflowRuns.push(run);
  const stored = store.workflows.get(workflow.id);

  if (stored) {
    stored.lastRunAt = finishedAt;
  }

  store.actor = { kind: 'workflow', id: workflow.id };

  try {
    store.emit({ type: 'workflow.run', workflowId: workflow.id, runId: run.id, status: run.status });
  } finally {
    store.actor = caller;
  }

  store.changed();

  return structuredClone(run);
};

/** A manual run as the store's actor; the trigger's object needs a `recordId`. */
/**
 * The runs about one record (or any record of an object), newest first, whichever workflow they belong to. The mock has no runner: a run is carried
 * out as it is made (also one that is not waited for), so none is ever open.
 */
export const listRecordWorkflowRuns = (store: MockStore, query: RecordWorkflowRunsQuery): WorkflowRunList => {
  const open = (run: WorkflowRun) => run.status === 'pending' || run.status === 'running';
  const items = [...store.workflowRuns]
    .reverse()
    .filter(
      (run) =>
        (query.recordId === undefined || run.trigger.recordId === query.recordId) &&
        (query.objectId === undefined || run.trigger.objectId === query.objectId) &&
        (query.state !== 'open' || open(run)),
    )
    .slice(0, query.limit ?? RECORD_WORKFLOW_RUNS_DEFAULT_LIMIT);

  return { items: structuredClone(items) };
};

export const runWorkflow = (store: MockStore, id: string, input: RunWorkflowInput = {}): WorkflowRun => {
  const workflow = getWorkflow(store, id);

  if (!workflow.enabled) {
    throw new DeviasApiError(409, 'CONFLICT', `Workflow "${workflow.title}" is disabled`);
  }

  const objectId = triggerObjectIdOf(workflow.trigger);
  let record: RecordData | null = null;

  if (objectId) {
    if (!input.recordId) {
      const name = store.objectById(objectId)?.nameSingular ?? objectId;

      throw validation(`"${workflow.title}" runs on a ${name} record; pass its id as recordId`, { path: 'recordId' });
    }

    record = getRecord(store, store.objectById(objectId)?.nameSingular ?? objectId, input.recordId);
  }

  return executeWorkflow(
    store,
    workflow,
    { kind: 'manual', ...(objectId && record ? { objectId, recordId: record.id } : {}), actor: store.actor },
    { record },
  );
};

/** Run a workflow again on what one of its runs was about; the new run names it in `trigger.retryOf`. */
export const retryWorkflowRun = (store: MockStore, id: string, runId: string): WorkflowRun => {
  const workflow = getWorkflow(store, id);

  if (!workflow.enabled) {
    throw new DeviasApiError(409, 'CONFLICT', `Workflow "${workflow.title}" is disabled`);
  }

  const previous = store.workflowRuns.find((run) => run.id === runId && run.workflowId === id);

  if (!previous) {
    throw new DeviasApiError(404, 'NOT_FOUND', `No run "${runId}" of this workflow`);
  }

  const { trigger } = previous;
  const retryObject = trigger.objectId ? store.objectById(trigger.objectId) : undefined;
  const record = retryObject && trigger.recordId ? getRecord(store, retryObject.nameSingular, trigger.recordId) : null;
  const stored = trigger.eventId ? store.webhookEvents.find((event) => event.id === trigger.eventId) : undefined;

  return executeWorkflow(
    store,
    workflow,
    { ...trigger, retryOf: previous.id, actor: store.actor },
    {
      record,
      ...(stored
        ? { moduleEvent: { type: stored.type, module: stored.moduleId, id: stored.id, payload: stored.payload } }
        : {}),
    },
  );
};

/** React to one store event: run every enabled record-event or module-event workflow it starts. */
export const runWorkflowsForEvent = (store: MockStore, event: WorkspaceEvent): number => {
  if (event.type === 'module.event') {
    let runs = 0;

    for (const workflow of [...store.workflows.values()].sort(byCreation)) {
      const { trigger } = workflow;

      if (!workflow.enabled || trigger.kind !== 'module_event') {
        continue;
      }

      if (!matchesModuleEventTrigger(trigger, event)) {
        continue;
      }

      const stored = store.webhookEvents.find((candidate) => candidate.id === event.eventId);

      if (!stored) {
        continue;
      }

      executeWorkflow(
        store,
        workflow,
        {
          kind: 'module_event',
          eventType: stored.type,
          sequence: event.sequence,
          moduleId: stored.moduleId,
          eventId: stored.id,
        },
        {
          moduleEvent: { type: stored.type, module: stored.moduleId, id: stored.id, payload: stored.payload },
        },
      );
      runs += 1;
    }

    return runs;
  }

  if (isTaskEvent(event)) {
    if (isAutomationActor(event.actor)) {
      return 0;
    }

    const row = store.tasks.find((candidate) => candidate.id === event.taskId && !candidate.deleted);

    if (!row) {
      return 0;
    }

    const record = taskConditionRecord(row);
    let taskRuns = 0;

    for (const workflow of [...store.workflows.values()].sort(byCreation)) {
      const { trigger } = workflow;

      if (!workflow.enabled || trigger.kind !== 'task_event') {
        continue;
      }

      if (!matchesTaskEventTrigger(trigger, event) || !matchesTaskCondition(trigger, record)) {
        continue;
      }

      executeWorkflow(
        store,
        workflow,
        { kind: 'task_event', taskId: event.taskId, eventType: event.action, sequence: event.sequence },
        {
          record,
          taskEvent: {
            type: event.type,
            taskId: event.taskId,
            action: event.action,
            sequence: event.sequence,
            occurredAt: event.occurredAt,
            ...(event.changes ? { changes: event.changes } : {}),
            ...(event.status !== undefined ? { status: event.status } : {}),
            ...(event.assignee !== undefined ? { assignee: event.assignee } : {}),
          },
        },
      );
      taskRuns += 1;
    }

    return taskRuns;
  }

  if (!isRecordEvent(event) || isAutomationActor(event.actor)) {
    return 0;
  }

  let runs = 0;

  for (const workflow of [...store.workflows.values()].sort(byCreation)) {
    if (!workflow.enabled || workflow.trigger.kind !== 'record_event') {
      continue;
    }

    if (
      !matchesRecordEventTrigger(
        workflow.trigger,
        event,
        (name) => store.fieldsOf(event.objectId).find((field) => field.name === name)?.id ?? name,
      )
    ) {
      continue;
    }

    const stored = store.recordsOf(event.objectId).get(event.recordId);
    const live = stored && !stored.deleted_at ? publicRecord(stored) : null;
    const record = event.type === 'record.deleted' ? (stored ? publicRecord(stored) : null) : live;
    const present = event.type === 'record.deleted' || record !== null;

    if (
      !present ||
      !matchesTriggerCondition(workflow.trigger, record, (ref) => fieldNameOf(store.fieldsOf(event.objectId), ref))
    ) {
      continue;
    }

    executeWorkflow(
      store,
      workflow,
      {
        kind: 'record_event',
        objectId: event.objectId,
        recordId: event.recordId,
        eventType: event.type,
        sequence: event.sequence,
      },
      { record, event },
    );
    runs += 1;
  }

  return runs;
};

/** Tick every scheduled workflow whose `nextRunAt` has passed. Returns how many runs happened. */
export const runDueWorkflows = (store: MockStore, now: Date = new Date(store.now())): number => {
  let runs = 0;

  for (const workflow of [...store.workflows.values()].sort(byCreation)) {
    const { trigger } = workflow;

    if (!workflow.enabled || trigger.kind !== 'schedule' || !workflow.nextRunAt) {
      continue;
    }

    if (Date.parse(workflow.nextRunAt) > now.getTime()) {
      continue;
    }

    workflow.nextRunAt = nextCronTime(trigger.cron, now)?.toISOString() ?? null;

    if (!trigger.objectId) {
      executeWorkflow(store, workflow, { kind: 'schedule' }, {});
      runs += 1;
      continue;
    }

    const object = store.objectById(trigger.objectId);

    if (!object) {
      continue;
    }

    const condition = trigger.condition ? conditionNames(store, object.id, trigger.condition) : undefined;
    const matching = store
      .liveRecords(object.id)
      .filter((record) => !condition || evaluateFilter(record, condition))
      .slice(0, WORKFLOW_SCHEDULE_MAX_RECORDS);

    for (const record of matching) {
      executeWorkflow(
        store,
        workflow,
        { kind: 'schedule', objectId: object.id, recordId: record.id },
        { record: publicRecord(record) },
      );
      runs += 1;
    }
  }

  return runs;
};
