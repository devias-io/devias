import {
  coreIds,
  evaluateFilter,
  fieldNameOf,
  fieldsOf,
  isAutomationActor,
  isRecordEvent,
  isTaskEvent,
  type ModuleEventScope,
  mapFilterFields,
  matchesModuleEventTrigger,
  matchesRecordEventTrigger,
  matchesTaskCondition,
  matchesTaskEventTrigger,
  matchesTriggerCondition,
  type RecordData,
  type RecordEvent,
  renderTemplate,
  richTextStepInput,
  type ScheduleTrigger,
  type SchemaIndex,
  TASK_FILTER_FIELDS,
  type TaskEventScope,
  TRIGGER_RECORD_ID,
  taskConditionRecord,
  textStepInput,
  triggerFollowsLog,
  triggerObjectIdOf,
  WORKFLOW_SCHEDULE_MAX_RECORDS,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowRunTrigger,
  type WorkflowScope,
  type WorkflowStep,
  type WorkspaceEvent,
  workflowScope,
} from '@devias/core';
import {
  type DataEngine,
  type EngineContext,
  EngineError,
  isEngineError,
  type Logger,
  workflowContext,
} from '@devias/data-engine';
import type { z } from 'zod';

/** Runs an action as the workflow; the server passes its action registry. */
export interface WorkflowActionsPort {
  invoke(ctx: EngineContext, actionId: string, input: unknown): Promise<unknown>;
  /** The input an action declares, so a step's document can be turned into text where the action asks for text. */
  inputSchema?(actionId: string): z.ZodObject | undefined;
}

export interface WorkflowRunnerOptions {
  engine: DataEngine;
  /** Runs the steps' actions; without it they fail with MISSING_DEPENDENCY. */
  actions?: WorkflowActionsPort;
  logger: Logger;
  pollIntervalMs?: number;
  batchSize?: number;
  clock?: () => Date;
}

/** What a run is about besides the workflow: the record and the record event, or the module's event. */
interface RunContext {
  record?: RecordData | Record<string, unknown> | null;
  event?: RecordEvent;
  moduleEvent?: ModuleEventScope;
  taskEvent?: TaskEventScope;
}

const OUTPUT_MAX_CHARS = 4000;

/** Keep step outputs small enough to store with the run. */
const compactOutput = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }

  try {
    const text = JSON.stringify(value);

    if (text === undefined) {
      return undefined;
    }

    return text.length > OUTPUT_MAX_CHARS ? { truncated: true, preview: text.slice(0, OUTPUT_MAX_CHARS) } : value;
  } catch {
    return String(value);
  }
};

/** An error as one line for the run, with validation issues spelled out. */
const describeError = (error: unknown): string => {
  if (isEngineError(error)) {
    const issues = (error.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;

    if (Array.isArray(issues) && issues.length > 0) {
      return `${error.message}: ${issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ')}`;
    }

    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
};

/**
 * Runs workflows. Record-event workflows follow the event log with a cursor each (like function triggers: a
 * doorbell or the 5 s poll wakes a workspace, events caused by automations are skipped). Scheduled workflows run
 * when `nextRunAt` is due, once per matching record when they name an object. Manual runs come from the API.
 * Every execution is recorded as a run; a failed step ends the run and is never retried, so steps run at most once.
 */
export const createWorkflowRunner = (options: WorkflowRunnerOptions) => {
  const { engine, actions, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const batchSize = options.batchSize ?? 100;
  const clock = options.clock ?? (() => new Date());
  const running = new Map<string, Promise<number>>();
  const dirty = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  /** Run one action step as the workflow; when it wrote the record the run is about, later steps see the new version. */
  const runStep = async (
    ctx: EngineContext,
    step: Extract<WorkflowStep, { kind: 'action' }>,
    scope: WorkflowScope,
    event: RecordEvent | undefined,
    index: SchemaIndex,
  ): Promise<Pick<WorkflowRunStep, 'status' | 'output'>> => {
    if (!actions) {
      throw new EngineError('MISSING_DEPENDENCY', 'Running actions is not available on this server');
    }

    const record = scope.record;

    if (
      event?.type === 'record.deleted' &&
      step.actionId === coreIds.actions.update_record &&
      step.input.id === TRIGGER_RECORD_ID
    ) {
      return { status: 'skipped', output: { reason: 'The record was deleted' } };
    }

    // The author's text meets the stored forms here: Markdown written to a rich-text field becomes a document, and a
    // document that reached a text input (a notification's body) becomes Markdown.
    const input = textStepInput(
      richTextStepInput(step.actionId, renderTemplate(step.input, scope), (name) => {
        const object = index.objectsByName.get(name);

        return object ? fieldsOf(index, object.id) : [];
      }),
      actions.inputSchema?.(step.actionId),
    );
    const output = await actions.invoke(ctx, step.actionId, input);

    if (record && output && typeof output === 'object' && (output as { id?: unknown }).id === record.id) {
      // A task's steps see it as the flat object its conditions test; a record's as the record.
      scope.record =
        scope.trigger.kind === 'task_event'
          ? taskConditionRecord(output as Parameters<typeof taskConditionRecord>[0])
          : (output as RecordData);
    }

    return { status: 'succeeded', output: compactOutput(output) };
  };

  /** Run every step in order as the workflow actor and record the outcome. */
  const execute = async (
    workspaceId: string,
    workflow: Workflow,
    runTrigger: WorkflowRunTrigger,
    context: RunContext,
  ): Promise<WorkflowRun> => {
    const startedAt = clock();
    const ctx = workflowContext(workspaceId, workflow.id);
    // The steps are stored with ids; a branch tests the record, which carries API names.
    const { index } = await engine.metadata.getSnapshot(workspaceId);
    const triggerObjectId = triggerObjectIdOf(workflow.trigger);
    const triggerFields =
      workflow.trigger.kind === 'task_event'
        ? TASK_FILTER_FIELDS
        : triggerObjectId
          ? fieldsOf(index, triggerObjectId)
          : [];
    const scope = workflowScope({
      workflow: { id: workflow.id, title: workflow.title },
      trigger: { kind: runTrigger.kind },
      record: context.record,
      event: context.event ?? context.moduleEvent ?? context.taskEvent,
      now: startedAt,
    });
    const steps: WorkflowRunStep[] = [];
    let error: string | undefined;
    /** Run a list of steps; false once a step failed (the failure is already recorded). */
    const runList = async (list: WorkflowStep[]): Promise<boolean> => {
      for (const step of list) {
        const base = {
          id: step.id,
          kind: step.kind,
          ...(step.kind === 'action' ? { actionId: step.actionId } : {}),
          ...(step.label ? { label: step.label } : {}),
        };

        try {
          if (step.kind === 'branch') {
            const matched = evaluateFilter(
              (scope.record ?? {}) as Record<string, unknown>,
              mapFilterFields(step.condition, (ref) => fieldNameOf(triggerFields, ref)),
            );
            steps.push({ ...base, status: 'succeeded', output: { matched, branch: matched ? 'yes' : 'no' } });

            if (scope.steps) {
              scope.steps[step.id] = { matched };
            }

            if (!(await runList(matched ? step.yes : step.no))) {
              return false;
            }

            continue;
          }

          const result = await runStep(ctx, step, scope, context.event, index);
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
    await runList(workflow.steps);
    const run = await engine.workflows.recordRun(workspaceId, {
      workflowId: workflow.id,
      status: error ? 'failed' : 'succeeded',
      trigger: runTrigger,
      steps,
      ...(error ? { error } : {}),
      startedAt: startedAt.toISOString(),
      finishedAt: clock().toISOString(),
    });

    if (error) {
      logger.warn(`workflow "${workflow.title}" (${workflow.id}) failed: ${error}`);
    }

    return run;
  };

  /** The record an event is about: the current row, or for deletions the data stored with the event. */
  const recordFor = async (
    workspaceId: string,
    workflow: Workflow,
    event: RecordEvent,
  ): Promise<Record<string, unknown> | null> => {
    if (event.type === 'record.deleted') {
      const diff = await engine.events.diffOf(workspaceId, event.sequence);

      return diff?.before ? { ...diff.before, id: event.recordId } : null;
    }

    try {
      return await engine.records.get(workflowContext(workspaceId, workflow.id), event.object, event.recordId);
    } catch (error) {
      if (isEngineError(error) && error.code === 'NOT_FOUND') {
        return null;
      }

      throw error;
    }
  };

  /**
   * Does this feed event start the workflow, and with what? `null` when it does not. Record-event triggers need the
   * record (skipped when it has gone) and the condition; event triggers need the stored event's payload.
   */
  const startOf = async (
    workspaceId: string,
    workflow: Workflow,
    event: WorkspaceEvent,
  ): Promise<{ trigger: WorkflowRunTrigger; context: RunContext } | null> => {
    const { trigger } = workflow;

    if (trigger.kind === 'record_event') {
      if (!isRecordEvent(event) || isAutomationActor(event.actor)) {
        return null;
      }

      const { index } = await engine.metadata.getSnapshot(workspaceId);
      // The event names the changed fields by API name; the trigger stores ids.
      const fieldIdOf = (name: string) => index.fieldByObjectAndName.get(`${event.objectId}:${name}`)?.id ?? name;

      if (!matchesRecordEventTrigger(trigger, event, fieldIdOf)) {
        return null;
      }

      const record = await recordFor(workspaceId, workflow, event);
      const present = event.type === 'record.deleted' || record !== null;
      const fields = fieldsOf(index, trigger.objectId);

      if (!present || !matchesTriggerCondition(trigger, record, (ref) => fieldNameOf(fields, ref))) {
        return null;
      }

      return {
        trigger: {
          kind: 'record_event',
          objectId: event.objectId,
          recordId: event.recordId,
          eventType: event.type,
          sequence: event.sequence,
        },
        context: { record, event },
      };
    }

    if (trigger.kind === 'task_event') {
      if (!isTaskEvent(event) || isAutomationActor(event.actor) || !matchesTaskEventTrigger(trigger, event)) {
        return null;
      }

      let task: Awaited<ReturnType<typeof engine.tasks.get>>;

      try {
        task = await engine.tasks.get(workflowContext(workspaceId, workflow.id), event.taskId);
      } catch (error) {
        // The task has gone since the event: there is nothing to act on.
        if (isEngineError(error) && error.code === 'NOT_FOUND') {
          return null;
        }

        throw error;
      }

      const record = taskConditionRecord(task);

      if (!matchesTaskCondition(trigger, record)) {
        return null;
      }

      return {
        trigger: { kind: 'task_event', taskId: event.taskId, eventType: event.action, sequence: event.sequence },
        context: {
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
      };
    }

    if (trigger.kind === 'event') {
      if (event.type !== 'module.event' || !matchesModuleEventTrigger(trigger, event)) {
        return null;
      }

      const stored = await engine.moduleEvents.get(workspaceId, event.eventId);

      if (!stored) {
        return null;
      }

      return {
        trigger: {
          kind: 'event',
          eventType: stored.type,
          sequence: event.sequence,
          moduleId: stored.moduleId,
          eventId: stored.id,
        },
        context: {
          moduleEvent: { type: stored.type, module: stored.moduleId, id: stored.id, payload: stored.payload },
        },
      };
    }

    return null;
  };

  /** Advance every log-following workflow through the change feed, running it on the events that match. */
  const processLogEvents = async (workspaceId: string, workflows: Workflow[]): Promise<number> => {
    let runs = 0;

    for (const workflow of workflows) {
      if (!triggerFollowsLog(workflow.trigger)) {
        continue;
      }

      let cursor = await engine.workflows.getCursor(workspaceId, workflow.id);

      if (cursor === null) {
        cursor = await engine.events.currentSequence(workspaceId);
        await engine.workflows.setCursor(workspaceId, workflow.id, cursor);
        continue;
      }

      for (;;) {
        const batch = await engine.events.readAfter(workspaceId, cursor, batchSize);

        if (batch.length === 0) {
          break;
        }

        for (const event of batch) {
          const start = await startOf(workspaceId, workflow, event);

          if (start) {
            try {
              await execute(workspaceId, workflow, start.trigger, start.context);
            } catch (error) {
              // The steps ran; only the bookkeeping failed. Move on rather than run them again.
              logger.error(`workflow "${workflow.title}" run on event ${event.sequence} could not be recorded`, error);
            }

            runs += 1;
            await engine.workflows.setCursor(workspaceId, workflow.id, event.sequence);
          }

          cursor = event.sequence;
        }

        await engine.workflows.setCursor(workspaceId, workflow.id, cursor);

        if (batch.length < batchSize) {
          break;
        }
      }
    }

    return runs;
  };

  const runSchedule = async (workspaceId: string, workflow: Workflow, trigger: ScheduleTrigger): Promise<number> => {
    if (!trigger.objectId) {
      await execute(workspaceId, workflow, { kind: 'schedule' }, {});

      return 1;
    }

    const ctx = workflowContext(workspaceId, workflow.id);
    const { index } = await engine.metadata.getSnapshot(workspaceId);
    const objectName = index.objectsById.get(trigger.objectId)?.nameSingular ?? trigger.objectId;
    const fields = fieldsOf(index, trigger.objectId);
    let cursor: string | undefined;
    let count = 0;

    do {
      const page = await engine.records.list(ctx, {
        object: objectName,
        ...(trigger.condition ? { filter: mapFilterFields(trigger.condition, (ref) => fieldNameOf(fields, ref)) } : {}),
        sort: [{ field: 'created_at', direction: 'asc' }],
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });

      for (const record of page.items) {
        if (count >= WORKFLOW_SCHEDULE_MAX_RECORDS) {
          break;
        }

        await execute(
          workspaceId,
          workflow,
          { kind: 'schedule', objectId: trigger.objectId, recordId: record.id },
          { record },
        );
        count += 1;
      }

      cursor = page.nextCursor ?? undefined;
    } while (cursor && count < WORKFLOW_SCHEDULE_MAX_RECORDS);

    return count;
  };

  const processSchedules = async (workspaceId: string, workflows: Workflow[]): Promise<number> => {
    const now = clock();
    let runs = 0;

    for (const workflow of workflows) {
      if (workflow.trigger.kind !== 'schedule' || !workflow.nextRunAt) {
        continue;
      }

      if (new Date(workflow.nextRunAt).getTime() > now.getTime()) {
        continue;
      }

      // Book the next tick first, so a failing tick cannot spin.
      await engine.workflows.setNextRun(
        workspaceId,
        workflow.id,
        new Date(now.getTime() + workflow.trigger.everyMinutes * 60_000),
      );
      runs += await runSchedule(workspaceId, workflow, workflow.trigger);
    }

    return runs;
  };

  const process = async (workspaceId: string): Promise<number> => {
    const workflows = await engine.workflows.listEnabled(workspaceId);

    if (workflows.length === 0) {
      return 0;
    }

    return (await processLogEvents(workspaceId, workflows)) + (await processSchedules(workspaceId, workflows));
  };

  /** Process everything pending for one workspace; returns how many runs happened. Serialized per workspace. */
  const runOnce = (workspaceId: string): Promise<number> => {
    const current = running.get(workspaceId);

    if (current) {
      dirty.add(workspaceId);

      return current;
    }

    const run = (async () => {
      let total = 0;

      do {
        dirty.delete(workspaceId);

        try {
          total += await process(workspaceId);
        } catch (error) {
          logger.warn(`workflow run failed for workspace ${workspaceId}`, error);
        }
      } while (dirty.has(workspaceId));

      return total;
    })().finally(() => running.delete(workspaceId));
    running.set(workspaceId, run);

    return run;
  };

  /** Run a workflow now as the caller asks; the steps still run as the workflow actor. */
  const runManual = async (
    ctx: EngineContext,
    workflowId: string,
    input: { recordId?: string },
  ): Promise<WorkflowRun> => {
    const workflow = await engine.workflows.get(ctx, workflowId);
    engine.permissions.authorize(ctx, 'workflow.run');

    if (!workflow.enabled) {
      throw new EngineError('CONFLICT', `Workflow "${workflow.title}" is disabled`);
    }

    const objectId = triggerObjectIdOf(workflow.trigger);
    const { index } = await engine.metadata.getSnapshot(ctx.workspaceId);
    const object = objectId ? (index.objectsById.get(objectId)?.nameSingular ?? objectId) : undefined;
    let record: RecordData | null = null;

    if (object) {
      if (!input.recordId) {
        throw new EngineError('VALIDATION', `"${workflow.title}" runs on a ${object} record; pass its id as recordId`, {
          path: 'recordId',
        });
      }

      record = await engine.records.get(ctx, object, input.recordId);
    }

    return execute(
      ctx.workspaceId,
      workflow,
      { kind: 'manual', ...(objectId && record ? { objectId, recordId: record.id } : {}), actor: ctx.actor },
      { record },
    );
  };

  /**
   * Run a workflow again on what one of its runs was about: the same record (as it is now) or the same module event.
   * The new run names the one it repeats in `trigger.retryOf`.
   */
  const retryRun = async (ctx: EngineContext, workflowId: string, runId: string): Promise<WorkflowRun> => {
    const workflow = await engine.workflows.get(ctx, workflowId);
    engine.permissions.authorize(ctx, 'workflow.run');

    if (!workflow.enabled) {
      throw new EngineError('CONFLICT', `Workflow "${workflow.title}" is disabled`);
    }

    const previous = await engine.workflows.getRun(ctx, workflowId, runId);
    const { trigger } = previous;
    const context: RunContext = {};

    const { index } = await engine.metadata.getSnapshot(ctx.workspaceId);
    const retryObject = trigger.objectId ? index.objectsById.get(trigger.objectId) : undefined;

    if (retryObject && trigger.recordId) {
      try {
        context.record = await engine.records.get(ctx, retryObject.nameSingular, trigger.recordId);
      } catch (error) {
        if (isEngineError(error) && error.code === 'NOT_FOUND') {
          throw new EngineError('CONFLICT', 'The record that run was about no longer exists');
        }

        throw error;
      }
    }

    if (trigger.kind === 'event' && trigger.eventId) {
      const stored = await engine.moduleEvents.get(ctx.workspaceId, trigger.eventId);

      if (!stored) {
        throw new EngineError('CONFLICT', 'The module event that run was about is no longer kept');
      }

      context.moduleEvent = { type: stored.type, module: stored.moduleId, id: stored.id, payload: stored.payload };
    }

    return execute(ctx.workspaceId, workflow, { ...trigger, retryOf: previous.id, actor: ctx.actor }, context);
  };

  const poll = async () => {
    try {
      for (const workspaceId of await engine.workspaces.list()) {
        void runOnce(workspaceId);
      }
    } catch (error) {
      logger.warn('workflow poll failed', error);
    }
  };

  return {
    start(): void {
      if (timer) {
        return;
      }

      unsubscribe = engine.events.subscribeAll((workspaceId) => {
        void runOnce(workspaceId);
      });
      timer = setInterval(() => void poll(), pollIntervalMs);
      timer.unref();
      void poll();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
      }

      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    runOnce,
    runManual,
    retryRun,
    execute,
  };
};

export type WorkflowRunner = ReturnType<typeof createWorkflowRunner>;
