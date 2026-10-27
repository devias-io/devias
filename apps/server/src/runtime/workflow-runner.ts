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
  WORKFLOW_MAX_OPEN_RUNS,
  WORKFLOW_RUN_LEASE_MS,
  WORKFLOW_RUN_MAX_STALLS,
  WORKFLOW_SCHEDULE_MAX_RECORDS,
  WORKFLOW_STEP_RETRY_LIMIT,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowRunTrigger,
  type WorkflowScope,
  type WorkflowStep,
  type WorkspaceEvent,
  workflowRetryDelayMs,
  workflowScope,
} from '@devias/core';
import {
  type DataEngine,
  type EngineContext,
  EngineError,
  type HeldRun,
  isEngineError,
  type Logger,
  nextScheduledRun,
  type RunDraft,
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
  /** How long a runner keeps a run before another may take it over (default 5 minutes). */
  leaseMs?: number;
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

/**
 * Whether a failed step is worth another try, and when its action suggests it: an action that throws `RetryableError`
 * (a rate limit, a timeout) says so, and nothing else is retried.
 */
const retryOf = (cause: unknown): { afterMs?: number } | null => {
  const details = isEngineError(cause)
    ? (cause.details as { retryable?: boolean; retryAfterMs?: number } | undefined)
    : undefined;

  if (!details?.retryable) {
    return null;
  }

  return typeof details.retryAfterMs === 'number' ? { afterMs: Math.max(0, details.retryAfterMs) } : {};
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
 * Runs workflows. A trigger queues a run: record-event workflows follow the event log with a cursor each (like function
 * triggers: a doorbell or the 5 s poll wakes a workspace, events caused by automations are skipped), scheduled ones
 * queue a run when `nextRunAt` is due, once per matching record when they name an object, and manual runs come from
 * the API. A run is a row from the moment it is queued; runners take them one at a time per workspace with a lease and
 * save the steps as they settle. A run whose runner stopped is taken again and goes on after the steps that settled,
 * so only the step that was running repeats. A failed step ends the run and is never retried.
 */
export const createWorkflowRunner = (options: WorkflowRunnerOptions) => {
  const { engine, actions, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const batchSize = options.batchSize ?? 100;
  const leaseMs = options.leaseMs ?? WORKFLOW_RUN_LEASE_MS;
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

  /**
   * Carry out a run this runner holds, as the workflow actor. A run that was taken over from a runner that stopped
   * goes on after the steps it had settled: their outputs feed the templates again and a branch goes the way it went.
   * The steps and the record so far are saved after every step, which also pushes the lease out. Resolves to `null`
   * when another runner took the run over meanwhile; that runner finishes it.
   */
  const carryOut = async (workspaceId: string, workflow: Workflow, held: HeldRun): Promise<WorkflowRun | null> => {
    const context = (held.context ?? {}) as RunContext;
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
      trigger: { kind: held.trigger.kind },
      record: context.record,
      event: context.event ?? context.moduleEvent ?? context.taskEvent,
      now: new Date(held.startedAt),
    });
    // What a runner that stopped left: the steps that settled, and the tries a step that asked for a retry has had.
    const settled = new Map(
      held.steps
        .filter((step) => step.status === 'succeeded' || step.status === 'skipped')
        .map((step) => [step.id, step]),
    );
    const tried = new Map(
      held.steps.filter((step) => step.status === 'retrying').map((step) => [step.id, step.attempt ?? 1]),
    );
    const steps: WorkflowRunStep[] = [...held.steps];
    /** A step has one entry: its latest try replaces the one before it. */
    const put = (entry: WorkflowRunStep) => {
      const at = steps.findIndex((step) => step.id === entry.id);

      if (at >= 0) {
        steps[at] = entry;
      } else {
        steps.push(entry);
      }
    };
    let error: string | undefined;
    let retryAt: Date | undefined;
    const save = () =>
      engine.workflows.saveRun(workspaceId, held, leaseMs, { steps, context: { ...context, record: scope.record } });
    /** Run a list of steps: `failed` once a step failed (already recorded), `deferred` once one asked to be retried later. */
    const runList = async (list: WorkflowStep[]): Promise<'done' | 'failed' | 'deferred'> => {
      for (const step of list) {
        const base = {
          id: step.id,
          kind: step.kind,
          ...(step.kind === 'action' ? { actionId: step.actionId } : {}),
          ...(step.label ? { label: step.label } : {}),
        };
        const done = settled.get(step.id);
        const attempt = (tried.get(step.id) ?? 0) + 1;
        let next: WorkflowStep[] = [];

        if (done) {
          // Settled before this runner took the run over: do not run it again.
          if (scope.steps) {
            scope.steps[step.id] =
              step.kind === 'branch'
                ? { matched: (done.output as { matched?: boolean })?.matched }
                : (done.output ?? null);
          }

          if (step.kind === 'branch') {
            next = (done.output as { branch?: string } | undefined)?.branch === 'yes' ? step.yes : step.no;
          }
        } else {
          try {
            if (step.kind === 'branch') {
              const matched = evaluateFilter(
                (scope.record ?? {}) as Record<string, unknown>,
                mapFilterFields(step.condition, (ref) => fieldNameOf(triggerFields, ref)),
              );
              put({ ...base, status: 'succeeded', output: { matched, branch: matched ? 'yes' : 'no' } });

              if (scope.steps) {
                scope.steps[step.id] = { matched };
              }

              next = matched ? step.yes : step.no;
            } else {
              const call = {
                runId: held.id,
                stepId: step.id,
                attempt,
                maxAttempts: 1 + WORKFLOW_STEP_RETRY_LIMIT,
                key: `${held.id}:${step.id}`,
              };
              const result = await runStep({ ...ctx, step: call }, step, scope, context.event, index);
              put({ ...base, ...result, ...(attempt > 1 ? { attempt } : {}) });

              if (scope.steps) {
                scope.steps[step.id] = result.output ?? null;
              }
            }
          } catch (cause) {
            const message = describeError(cause);
            const retry = step.kind === 'action' ? retryOf(cause) : null;

            if (retry && attempt <= WORKFLOW_STEP_RETRY_LIMIT) {
              retryAt = new Date(clock().getTime() + (retry.afterMs ?? workflowRetryDelayMs(attempt)));
              put({ ...base, status: 'retrying', error: message, attempt, retryAt: retryAt.toISOString() });

              return 'deferred';
            }

            put({ ...base, status: 'failed', error: message, ...(attempt > 1 ? { attempt } : {}) });
            error = `Step ${steps.length} (${step.label ?? step.kind}) failed: ${message}`;

            return 'failed';
          }

          await save();
        }

        const rest = next.length > 0 ? await runList(next) : 'done';

        if (rest !== 'done') {
          return rest;
        }
      }

      return 'done';
    };
    // A step can take longer than a lease: keep it while the run is worked on.
    const heartbeat = setInterval(
      () => {
        void engine.workflows.saveRun(workspaceId, held, leaseMs).catch(() => undefined);
      },
      Math.max(1000, Math.floor(leaseMs / 3)),
    );
    heartbeat.unref();

    try {
      const outcome = await runList(workflow.steps);

      if (outcome === 'deferred' && retryAt) {
        await engine.workflows.deferRun(workspaceId, held, retryAt, {
          steps,
          context: { ...context, record: scope.record },
        });
        logger.info(`workflow "${workflow.title}" (${workflow.id}) will try a step again at ${retryAt.toISOString()}`);

        return null;
      }

      const run = await engine.workflows.finishRun(workspaceId, held, {
        status: error ? 'failed' : 'succeeded',
        steps,
        ...(error ? { error } : {}),
      });

      if (error) {
        logger.warn(`workflow "${workflow.title}" (${workflow.id}) failed: ${error}`);
      }

      return run;
    } catch (cause) {
      if (isEngineError(cause) && cause.details && (cause.details as { lease?: string }).lease === 'lost') {
        logger.warn(`workflow "${workflow.title}" run ${held.id} was taken over by another runner`);

        return null;
      }

      throw cause;
    } finally {
      clearInterval(heartbeat);
    }
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

    if (trigger.kind === 'module_event') {
      if (event.type !== 'module.event' || !matchesModuleEventTrigger(trigger, event)) {
        return null;
      }

      const stored = await engine.webhookEvents.get(workspaceId, event.eventId);

      if (!stored) {
        return null;
      }

      return {
        trigger: {
          kind: 'module_event',
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

  /**
   * Advance every log-following workflow through the change feed and queue a run for each event that starts it. The
   * runs and the cursor are saved together, so a crash queues a batch once, never twice and never not at all.
   */
  const queueLogEvents = async (workspaceId: string, workflows: Workflow[]): Promise<void> => {
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

      // A trigger that outpaces its runs waits here: the cursor stays, the events are read when there is room.
      if ((await engine.workflows.openRuns(workspaceId, workflow.id)) >= WORKFLOW_MAX_OPEN_RUNS) {
        continue;
      }

      for (;;) {
        const batch = await engine.events.readAfter(workspaceId, cursor, batchSize);

        if (batch.length === 0) {
          break;
        }

        const drafts: RunDraft[] = [];

        for (const event of batch) {
          const start = await startOf(workspaceId, workflow, event);

          if (start) {
            drafts.push({ trigger: start.trigger, context: start.context, key: `event:${event.sequence}` });
          }
        }

        cursor = batch[batch.length - 1]?.sequence ?? cursor;
        await engine.workflows.enqueueRuns(workspaceId, workflow.id, drafts, { cursor });

        if (batch.length < batchSize) {
          break;
        }
      }
    }
  };

  /** The runs a schedule's tick owes: one, or one per matching record when it names an object. */
  const scheduleDrafts = async (
    workspaceId: string,
    workflow: Workflow,
    trigger: ScheduleTrigger,
    fireTime: string,
  ): Promise<RunDraft[]> => {
    const key = `schedule:${fireTime}`;

    if (!trigger.objectId) {
      return [{ trigger: { kind: 'schedule' }, key }];
    }

    const ctx = workflowContext(workspaceId, workflow.id);
    const { index } = await engine.metadata.getSnapshot(workspaceId);
    const objectName = index.objectsById.get(trigger.objectId)?.nameSingular ?? trigger.objectId;
    const fields = fieldsOf(index, trigger.objectId);
    const drafts: RunDraft[] = [];
    let cursor: string | undefined;

    do {
      const page = await engine.records.list(ctx, {
        object: objectName,
        ...(trigger.condition ? { filter: mapFilterFields(trigger.condition, (ref) => fieldNameOf(fields, ref)) } : {}),
        sort: [{ field: 'created_at', direction: 'asc' }],
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });

      for (const record of page.items) {
        if (drafts.length < WORKFLOW_SCHEDULE_MAX_RECORDS) {
          drafts.push({
            trigger: { kind: 'schedule', objectId: trigger.objectId, recordId: record.id },
            context: { record },
            key: `${key}:${record.id}`,
          });
        }
      }

      cursor = page.nextCursor ?? undefined;
    } while (cursor && drafts.length < WORKFLOW_SCHEDULE_MAX_RECORDS);

    return drafts;
  };

  /**
   * Queue the runs of every schedule that is due, and book its next tick in the same transaction. The next tick is the
   * next fire time after now, so a server that was down owes one run, not one for each tick it missed.
   */
  const queueSchedules = async (workspaceId: string, workflows: Workflow[]): Promise<void> => {
    const now = clock();

    for (const workflow of workflows) {
      if (workflow.trigger.kind !== 'schedule' || !workflow.nextRunAt) {
        continue;
      }

      if (new Date(workflow.nextRunAt).getTime() > now.getTime()) {
        continue;
      }

      let drafts: RunDraft[] = [];

      try {
        drafts = await scheduleDrafts(workspaceId, workflow, workflow.trigger, workflow.nextRunAt);
      } catch (error) {
        // The tick is lost, not retried every poll.
        logger.warn(`workflow "${workflow.title}" (${workflow.id}) could not list the records of its tick`, error);
      }

      await engine.workflows.enqueueRuns(workspaceId, workflow.id, drafts, {
        nextRunAt: nextScheduledRun(workflow.trigger, true, now),
      });
    }
  };

  /** Carry out the runs that are due, one after the other, until none is left. Returns how many it carried out. */
  const drain = async (workspaceId: string): Promise<number> => {
    let enabled = new Map((await engine.workflows.listEnabled(workspaceId)).map((workflow) => [workflow.id, workflow]));
    let count = 0;

    for (;;) {
      const held = await engine.workflows.claimRun(workspaceId, leaseMs);

      if (!held) {
        return count;
      }

      count += 1;
      let workflow = enabled.get(held.workflowId);

      if (!workflow) {
        // Created since the list was read, or turned off.
        enabled = new Map(
          (await engine.workflows.listEnabled(workspaceId)).map((candidate) => [candidate.id, candidate]),
        );
        workflow = enabled.get(held.workflowId);
      }

      try {
        if (!workflow) {
          await engine.workflows.finishRun(workspaceId, held, {
            status: 'failed',
            steps: held.steps,
            error: 'The workflow was turned off before this run could finish',
          });
        } else if (held.stalls > WORKFLOW_RUN_MAX_STALLS) {
          await engine.workflows.finishRun(workspaceId, held, {
            status: 'failed',
            steps: held.steps,
            error: 'The runner stopped while working on this run too many times; it is not tried again',
          });
        } else {
          await carryOut(workspaceId, workflow, held);
        }
      } catch (error) {
        // The run keeps its lease until it lapses, then another attempt takes it.
        logger.warn(`workflow run ${held.id} could not be carried out`, error);
      }
    }
  };

  const process = async (workspaceId: string): Promise<number> => {
    const workflows = await engine.workflows.listEnabled(workspaceId);

    if (workflows.length > 0) {
      await queueLogEvents(workspaceId, workflows);
      await queueSchedules(workspaceId, workflows);
    }

    return drain(workspaceId);
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

  /** Queue a run that this runner carries out at once, for a caller waiting for the outcome. */
  const runNow = async (
    ctx: EngineContext,
    workflow: Workflow,
    trigger: WorkflowRunTrigger,
    context: RunContext,
  ): Promise<WorkflowRun> => {
    const held = await engine.workflows.startRun(ctx.workspaceId, workflow.id, { trigger, context }, leaseMs);

    return (await carryOut(ctx.workspaceId, workflow, held)) ?? engine.workflows.getRun(ctx, workflow.id, held.id);
  };

  /** Run a workflow now as the caller asks; the steps still run as the workflow actor. */
  const runManual = async (
    ctx: EngineContext,
    workflowId: string,
    input: { recordId?: string; wait?: boolean },
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

    const trigger: WorkflowRunTrigger = {
      kind: 'manual',
      ...(objectId && record ? { objectId, recordId: record.id } : {}),
      actor: ctx.actor,
    };

    // Not waiting: the run is queued and handed back as it is, and a runner takes it a moment later. The queue's own
    // announcement wakes the runner, so nothing here carries it out.
    if (input.wait === false) {
      return engine.workflows.queueRun(ctx.workspaceId, workflow.id, { trigger, context: { record } });
    }

    return runNow(ctx, workflow, trigger, { record });
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

    if (trigger.kind === 'module_event' && trigger.eventId) {
      const stored = await engine.webhookEvents.get(ctx.workspaceId, trigger.eventId);

      if (!stored) {
        throw new EngineError('CONFLICT', 'The module event that run was about is no longer kept');
      }

      context.moduleEvent = { type: stored.type, module: stored.moduleId, id: stored.id, payload: stored.payload };
    }

    return runNow(ctx, workflow, { ...trigger, retryOf: previous.id, actor: ctx.actor }, context);
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
  };
};

export type WorkflowRunner = ReturnType<typeof createWorkflowRunner>;
