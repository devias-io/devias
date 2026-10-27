import { z } from 'zod';
import type { AnyActionSpec } from './actions/define';
import { cronProblem } from './cron';
import {
  ActorSchema,
  RECORD_EVENT_TYPES,
  type RecordEvent,
  TASK_EVENT_TYPES,
  type TaskChangedEvent,
  WORKFLOW_RUN_STATUSES,
} from './events';
import { IdSchema } from './ids';
import { mapFilterFields } from './metadata/view-config';
import { ANY_EVENT } from './module-runtime';
import type { Permission } from './permissions';
import { evaluateFilter } from './query/filter-eval';
import { type Filter, FilterSchema, type RecordData } from './query/ir';
import { isRichTextDoc } from './rich-text';
import { richTextToMarkdown } from './rich-text-markdown';
import { TaskStatusSchema } from './task';

/**
 * Workflows are automations people configure in a workspace; the code they run lives in actions.
 * A workflow has one trigger (a record event, a manual action on a record, a schedule, or an event a module
 * delivered) and a list of steps that run in order as the `workflow` actor. A step runs an action, core's
 * (`records.update`) or an installed module's (`acme.sendEmail`), or branches. Every execution leaves a run
 * with the outcome of each step.
 */

/** Steps in one workflow, counting those inside branches. */
export const WORKFLOW_MAX_STEPS = 50;
/** How deep branches may nest. */
export const WORKFLOW_MAX_DEPTH = 5;
/** How many records one scheduled tick fans out to at most. */
export const WORKFLOW_SCHEDULE_MAX_RECORDS = 500;
export const WORKFLOW_RUN_DEFAULT_LIMIT = 50;
export const WORKFLOW_RUN_MAX_LIMIT = 200;
/** Runs kept per workflow; older ones are pruned. */
export const WORKFLOW_RUN_RETENTION = 1000;
/** Runs of one workflow that may wait or be worked on at once; its trigger is not read further until there is room. */
export const WORKFLOW_MAX_OPEN_RUNS = 1000;
/** How long a runner keeps a run before another may take it over. */
export const WORKFLOW_RUN_LEASE_MS = 5 * 60_000;
/** Times a runner may stop working on a run (its process died) before the run is given up on. */
export const WORKFLOW_RUN_MAX_STALLS = 5;
/** Times a step that asked for a retry is tried again; after that it fails the run. */
export const WORKFLOW_STEP_RETRY_LIMIT = 5;

/** How long to wait before the `retry`th retry of a step (1 is the first): 30 seconds, doubling, at most an hour. */
export const workflowRetryDelayMs = (retry: number): number =>
  Math.min(30_000 * 2 ** Math.max(retry - 1, 0), 3_600_000);

// ---------------------------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_TRIGGER_KINDS = ['record_event', 'manual', 'schedule', 'module_event', 'task_event'] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

/**
 * A trigger names its object, its fields and its module by id. What the agent and the API send may name an object or a
 * field by its API name: the server stores the ids, and a `condition` is stored with ids in the place of names.
 */
export const RecordEventTriggerSchema = z.object({
  kind: z.literal('record_event'),
  /** The id of the object. */
  objectId: z.string().min(1),
  types: z.array(z.enum(RECORD_EVENT_TYPES)).min(1),
  /** For `record.updated`: run only when at least one of these fields (ids) changed. */
  fieldIds: z.array(z.string().min(1)).optional(),
  /** Evaluated on the record after the change (before it, for deletions). */
  condition: FilterSchema.optional(),
  /** Also run for records an import wrote, which no workflow does by default: a data load is not a business event. */
  onImport: z.boolean().optional(),
});
export type RecordEventTrigger = z.infer<typeof RecordEventTriggerSchema>;

export const ManualTriggerSchema = z.object({
  kind: z.literal('manual'),
  /** People run it from a record of this object (its id). */
  objectId: z.string().min(1),
});
export type ManualTrigger = z.infer<typeof ManualTriggerSchema>;

export const ScheduleTriggerSchema = z.object({
  kind: z.literal('schedule'),
  /** When it runs: five fields (minute hour day month weekday), read in UTC. */
  cron: z
    .string()
    .superRefine((value, ctx) => {
      const problem = cronProblem(value);

      if (problem) {
        ctx.addIssue({ code: 'custom', message: problem });
      }
    })
    .describe(
      'Five fields, minute hour day-of-month month day-of-week, read in UTC: "*/15 * * * *" is every 15 minutes, "0 9 * * 1-5" weekdays at 09:00, "0 0 1 * *" the first of each month.',
    ),
  /** When set, each tick runs the steps once per record of this object (its id) that matches `condition`. */
  objectId: z.string().min(1).optional(),
  condition: FilterSchema.optional(),
});
export type ScheduleTrigger = z.infer<typeof ScheduleTriggerSchema>;

export const ModuleEventTriggerSchema = z.object({
  kind: z.literal('module_event'),
  /** The id of the installed module whose events start the workflow (`acme`). */
  moduleId: z.string().min(1),
  /** Event types to react to, as the module names them (`invoice.paid`); `*` means every event. */
  types: z.array(z.string().min(1)).min(1),
});
export type ModuleEventTrigger = z.infer<typeof ModuleEventTriggerSchema>;

/**
 * A task was created, changed or commented on. The steps act on the task as `record` (`{{record.id}}`,
 * `{{record.title}}`, `{{record.status}}`…) and the event as `event` (`{{event.action}}`). Changes made by automations
 * do not start it, so a workflow cannot chain into itself.
 */
export const TaskEventTriggerSchema = z.object({
  kind: z.literal('task_event'),
  /** `created`, `updated` (any field), `status_changed`, `assigned` (the assignee changed) or `commented`. */
  types: z.array(z.enum(TASK_EVENT_TYPES)).min(1),
  /** For `status_changed`: run only when the task moved to one of these statuses. */
  statuses: z.array(TaskStatusSchema).min(1).optional(),
  /** Evaluated on the task after the change, over `TASK_FILTER_FIELDS` (`status`, `priority`, `assignee`, …). */
  condition: FilterSchema.optional(),
});
export type TaskEventTrigger = z.infer<typeof TaskEventTriggerSchema>;

export const WorkflowTriggerSchema = z
  .discriminatedUnion('kind', [
    RecordEventTriggerSchema,
    ManualTriggerSchema,
    ScheduleTriggerSchema,
    ModuleEventTriggerSchema,
    TaskEventTriggerSchema,
  ])
  .meta({ id: 'WorkflowTrigger' });
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

/** The id of the object whose record the steps act on, if the trigger provides one. */
export const triggerObjectIdOf = (trigger: WorkflowTrigger): string | undefined =>
  trigger.kind === 'module_event' || trigger.kind === 'task_event' ? undefined : trigger.objectId;

/** Triggers that read the change feed with a cursor (as opposed to schedules and manual runs). */
export const triggerFollowsLog = (trigger: Pick<WorkflowTrigger, 'kind'>): boolean =>
  trigger.kind === 'record_event' || trigger.kind === 'module_event' || trigger.kind === 'task_event';

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_STEP_KINDS = ['action', 'branch'] as const;
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

/**
 * What the steps of a running workflow may do: read and write records and documents, read metadata and events, run
 * modules' actions, notify people. They never manage anything, start other automations or act for a person.
 */
export const WORKFLOW_PERMISSIONS: readonly Permission[] = [
  'record.read',
  'record.write',
  'metadata.read',
  'event.read',
  'module.run',
  'notification.send',
  'document.read',
  'document.write',
  'task.read',
  'task.write',
];

/** Whether a workflow step may run this action. */
export const workflowCanRun = (spec: Pick<AnyActionSpec, 'permission' | 'sessionOnly'>): boolean =>
  !spec.sessionOnly && WORKFLOW_PERMISSIONS.includes(spec.permission);

/** The id of the record that started the run, as a template: `records.update` with it updates that record. */
export const TRIGGER_RECORD_ID = '{{record.id}}';

interface StepBase {
  id: string;
  /** What the step is called in the editor and in a run's history; the action's name when left out. */
  label?: string | undefined;
}

/** What a plain step does: run an action with an input. A `branch` holds two lists of steps and runs one of them. */
export type WorkflowStepBody = { kind: 'action'; actionId: string; input: Record<string, unknown> };

export interface WorkflowBranchStep extends StepBase {
  kind: 'branch';
  /** Evaluated on the record as it is when the branch is reached. */
  condition: Filter;
  yes: WorkflowStep[];
  no: WorkflowStep[];
}

export type WorkflowStep = (StepBase & WorkflowStepBody) | WorkflowBranchStep;

interface StepInputBase {
  id?: string | undefined;
  label?: string | undefined;
}

export interface WorkflowBranchStepInput extends StepInputBase {
  kind: 'branch';
  condition: Filter;
  yes: WorkflowStepInput[];
  no: WorkflowStepInput[];
}

/** As clients send steps: the server assigns ids that are missing. */
export type WorkflowStepInput = (StepInputBase & WorkflowStepBody) | WorkflowBranchStepInput;

const StepIdSchema = z.string().min(1).max(64);

const stepSchemas = <I extends z.ZodType<string> | z.ZodOptional<z.ZodType<string>>, S>(id: I, self: z.ZodType<S>) => {
  const base = { id, label: z.string().trim().max(120).optional() };

  return [
    z.object({
      ...base,
      kind: z.literal('action'),
      /** An action id: core's or an installed module's. */
      actionId: z.string().min(1),
      /** The action's input; strings may use `{{…}}` templates. */
      input: z.record(z.string(), z.unknown()),
    }),
    z.object({
      ...base,
      kind: z.literal('branch'),
      /** Evaluated on the record as it is when the branch is reached. */
      condition: FilterSchema,
      yes: z.array(z.lazy(() => self)),
      no: z.array(z.lazy(() => self)),
    }),
  ] as const;
};

export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z
  .lazy(() => z.discriminatedUnion('kind', stepSchemas(StepIdSchema, WorkflowStepSchema)))
  .meta({ id: 'WorkflowStep' });

export const WorkflowStepInputSchema: z.ZodType<WorkflowStepInput> = z
  .lazy(() => z.discriminatedUnion('kind', stepSchemas(StepIdSchema.optional(), WorkflowStepInputSchema)))
  .meta({ id: 'WorkflowStepInput' });

// ---------------------------------------------------------------------------------------------
// Step trees
// ---------------------------------------------------------------------------------------------

/** Where a step sits: its nesting depth and, inside a branch, which lane. */
export interface StepPlace {
  depth: number;
  parent?: string | undefined;
  lane?: 'yes' | 'no' | undefined;
}

/** Visit every step, branches before their lanes, in execution order. */
export const walkSteps = <S extends WorkflowStepInput>(
  steps: S[],
  visit: (step: S, place: StepPlace) => void,
  place: StepPlace = { depth: 0 },
): void => {
  for (const step of steps) {
    visit(step, place);

    if (step.kind === 'branch') {
      walkSteps(step.yes as S[], visit, { depth: place.depth + 1, parent: step.id, lane: 'yes' });
      walkSteps(step.no as S[], visit, { depth: place.depth + 1, parent: step.id, lane: 'no' });
    }
  }
};

/** Every step in execution order, lanes included. */
export const flattenSteps = <S extends WorkflowStepInput>(steps: S[]): S[] => {
  const out: S[] = [];
  walkSteps(steps, (step) => out.push(step));

  return out;
};

export const countSteps = (steps: WorkflowStepInput[]): number => flattenSteps(steps).length;

/** How deep branches nest: 0 without branches, 1 for a branch, 2 for a branch inside a lane. */
export const stepDepth = (steps: WorkflowStepInput[]): number => {
  let depth = 0;
  walkSteps(steps, (step, place) => {
    if (step.kind === 'branch') {
      depth = Math.max(depth, place.depth + 1);
    }
  });

  return depth;
};

export const findStep = <S extends WorkflowStepInput>(steps: S[], id: string): S | undefined => {
  let found: S | undefined;
  walkSteps(steps, (step) => {
    if (step.id === id && !found) {
      found = step;
    }
  });

  return found;
};

/** Why a step tree is too large, or `null` when it fits the limits. */
export const stepLimitsProblem = (steps: WorkflowStepInput[]): string | null => {
  const count = countSteps(steps);

  if (count === 0) {
    return 'Add at least one step';
  }

  if (count > WORKFLOW_MAX_STEPS) {
    return `A workflow may have at most ${WORKFLOW_MAX_STEPS} steps; this one has ${count}`;
  }

  const depth = stepDepth(steps);

  if (depth > WORKFLOW_MAX_DEPTH) {
    return `Branches may nest at most ${WORKFLOW_MAX_DEPTH} deep; this one nests ${depth}`;
  }

  return null;
};

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------

export const WorkflowSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    enabled: z.boolean(),
    trigger: WorkflowTriggerSchema,
    steps: z.array(WorkflowStepSchema),
    lastRunAt: z.string().nullable(),
    /** Schedules only: when the next tick is due. */
    nextRunAt: z.string().nullable(),
    /**
     * The module that ships the workflow, when one does: its title, trigger and steps are the module's, and only
     * `enabled` is the workspace's to change. A copy made from it is the workspace's own.
     */
    moduleId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Workflow' });
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the workflow a title').max(120),
    description: z.string().max(2000).optional(),
    enabled: z.boolean().optional(),
    trigger: WorkflowTriggerSchema,
    /** At least one step; the total across branches and the nesting depth are checked on save. */
    steps: z.array(WorkflowStepInputSchema).min(1, 'Add at least one step'),
  })
  .meta({ id: 'WorkflowInput' });
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

/**
 * A workflow a module ships: made when the module is installed, updated with it and removed with it. Its `id` and the
 * ids of its steps are uuids a module writes out (`devias id`), like everything else a manifest declares. It names
 * objects, fields and its own module by id, as every trigger does. `enabled` is where it starts; the workspace then
 * decides, and an update of the module leaves its choice alone.
 */
export const WorkflowDefinitionSchema = z
  .object({
    id: IdSchema,
    title: z.string().trim().min(1, 'Give the workflow a title').max(120),
    description: z.string().max(2000).optional(),
    enabled: z.boolean().optional(),
    trigger: WorkflowTriggerSchema,
    steps: z.array(WorkflowStepSchema).min(1, 'Add at least one step'),
  })
  .meta({ id: 'WorkflowDefinition' });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export const WorkflowRunTriggerSchema = z
  .object({
    kind: z.enum(WORKFLOW_TRIGGER_KINDS),
    /** The id of the object the record belongs to. */
    objectId: z.string().optional(),
    recordId: z.string().optional(),
    /** A record event type, or the module's event type for module_event triggers. */
    eventType: z.string().optional(),
    /** The change-feed sequence of the event that started the run. */
    sequence: z.number().int().optional(),
    /** Who started a manual run. */
    actor: ActorSchema.optional(),
    /** Event triggers: the module and the stored event. */
    moduleId: z.string().optional(),
    eventId: z.string().optional(),
    /** Task triggers: the task. */
    taskId: z.string().optional(),
    /** A retry: the run it repeats, on the same record or event. */
    retryOf: z.string().optional(),
  })
  .meta({ id: 'WorkflowRunTrigger' });
export type WorkflowRunTrigger = z.infer<typeof WorkflowRunTriggerSchema>;

export const WorkflowRunStepSchema = z
  .object({
    id: z.string(),
    kind: z.enum(WORKFLOW_STEP_KINDS),
    /** The action the step ran. */
    actionId: z.string().optional(),
    label: z.string().optional(),
    /** `retrying`: the step failed in a way worth another try, which is booked for `retryAt`. */
    status: z.enum(['succeeded', 'failed', 'skipped', 'retrying']),
    output: z.unknown().optional(),
    error: z.string().optional(),
    /** Which try this entry is about; left out for a step that went right the first time. */
    attempt: z.number().int().positive().optional(),
    /** When a `retrying` step is tried again. */
    retryAt: z.string().optional(),
  })
  .meta({ id: 'WorkflowRunStep' });
export type WorkflowRunStep = z.infer<typeof WorkflowRunStepSchema>;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WorkflowRunSchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    status: z.enum(WORKFLOW_RUN_STATUSES),
    trigger: WorkflowRunTriggerSchema,
    /** The steps that have settled so far, in the order they ran. */
    steps: z.array(WorkflowRunStepSchema),
    error: z.string().optional(),
    /** When the trigger queued the run. */
    createdAt: z.string(),
    /** When a runner first took the run; null while it waits. */
    startedAt: z.string().nullable(),
    /** When the run ended; null until then. */
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'WorkflowRun' });
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowRunPageSchema = z
  .object({ items: z.array(WorkflowRunSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'WorkflowRunPage' });
export type WorkflowRunPage = z.infer<typeof WorkflowRunPageSchema>;

export const WorkflowRunQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(WORKFLOW_RUN_MAX_LIMIT).optional(),
  })
  .meta({ id: 'WorkflowRunQuery' });
export type WorkflowRunQuery = z.infer<typeof WorkflowRunQuerySchema>;

export const RunWorkflowInputSchema = z
  .object({
    /** The record to run on; required when the trigger names an object. */
    recordId: z.string().optional(),
    /**
     * Wait for the run to finish and return it (the default). With `false` the run is queued and returned at once,
     * `pending`: a runner takes it a moment later, and its progress is read from the run's workflow or from
     * `GET /workflow-runs?recordId=…`.
     */
    wait: z.boolean().optional(),
  })
  .meta({ id: 'RunWorkflowInput' });
export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>;

/** Runs that were about one record, whichever workflow they belong to. */
export const RECORD_WORKFLOW_RUNS_DEFAULT_LIMIT = 10;
export const RECORD_WORKFLOW_RUNS_MAX_LIMIT = 200;

export const RecordWorkflowRunsQuerySchema = z
  .object({
    /** The record the runs were about. */
    recordId: z.string().min(1).optional(),
    /** Or the object: the runs about any of its records, which is how a table tells which rows are being worked on. */
    objectId: z.string().min(1).optional(),
    /** `open`: only the runs that wait for a runner, are being worked on, or wait to try a step again. */
    state: z.enum(['open', 'all']).optional(),
    limit: z.coerce.number().int().min(1).max(RECORD_WORKFLOW_RUNS_MAX_LIMIT).optional(),
  })
  .meta({ id: 'RecordWorkflowRunsQuery' });
export type RecordWorkflowRunsQuery = z.infer<typeof RecordWorkflowRunsQuerySchema>;

export const WorkflowRunListSchema = z.object({ items: z.array(WorkflowRunSchema) }).meta({ id: 'WorkflowRunList' });
export type WorkflowRunList = z.infer<typeof WorkflowRunListSchema>;

export const WORKFLOW_ACTIVITY_DEFAULT_DAYS = 30;
export const WORKFLOW_ACTIVITY_MAX_DAYS = 366;

/** Whether the runtime knows an IANA time zone ("Europe/Bucharest"). */
export const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });

    return true;
  } catch {
    return false;
  }
};

/** The calendar day of `at` in a time zone, as `YYYY-MM-DD`. */
export const calendarDay = (at: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** A `YYYY-MM-DD` day moved by some days. */
export const shiftDay = (day: string, days: number): string => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];

  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
};

/** The days of an activity period: `days` of them, oldest first, ending with today in `tz`. */
export const activityDays = (now: Date, days: number, tz: string): string[] => {
  const today = calendarDay(now, tz);

  return Array.from({ length: days }, (_, i) => shiftDay(today, i - days + 1));
};

export const WorkflowActivityQuerySchema = z
  .object({
    /** Days to count back, today included (default 30). */
    days: z.coerce.number().int().min(1).max(WORKFLOW_ACTIVITY_MAX_DAYS).optional(),
    /** The IANA time zone the days are counted in (default UTC). */
    tz: z.string().refine(isTimeZone, 'Unknown time zone').optional(),
  })
  .meta({ id: 'WorkflowActivityQuery' });
export type WorkflowActivityQuery = z.infer<typeof WorkflowActivityQuerySchema>;

export const WorkflowActivityDaySchema = z
  .object({
    /** `YYYY-MM-DD`, in the query's time zone. */
    date: z.string(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  })
  .meta({ id: 'WorkflowActivityDay' });
export type WorkflowActivityDay = z.infer<typeof WorkflowActivityDaySchema>;

export const WorkflowHealthSchema = z
  .object({
    workflowId: z.string(),
    /** Runs in the period, and how many of them failed. */
    runs: z.number().int(),
    failed: z.number().int(),
    /** The latest run, whenever it was. */
    lastRunId: z.string(),
    lastStatus: z.enum(['succeeded', 'failed']),
    /** The latest run's error, when it failed. */
    lastError: z.string().optional(),
  })
  .meta({ id: 'WorkflowHealth' });
export type WorkflowHealth = z.infer<typeof WorkflowHealthSchema>;

export const WorkflowActivitySchema = z
  .object({
    /** Every day of the period, oldest first and today last; a day without runs counts zero. */
    days: z.array(WorkflowActivityDaySchema),
    /** Every workflow that has ever run. */
    workflows: z.array(WorkflowHealthSchema),
  })
  .meta({ id: 'WorkflowActivity' });
export type WorkflowActivity = z.infer<typeof WorkflowActivitySchema>;

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

/** The record event as templates see it. */
export type RecordEventScope = Pick<
  RecordEvent,
  'type' | 'object' | 'recordId' | 'changedFields' | 'sequence' | 'occurredAt'
>;

/** A module's event as templates see it: `{{event.payload.data.object.email}}`. */
export interface ModuleEventScope {
  type: string;
  module: string;
  id: string;
  payload: unknown;
}

/** The task event as templates see it: `{{event.action}}`, `{{event.status}}`. */
export type TaskEventScope = Pick<TaskChangedEvent, 'type' | 'taskId' | 'action' | 'sequence' | 'occurredAt'> &
  Partial<Pick<TaskChangedEvent, 'changes' | 'status' | 'assignee'>>;

/** What `{{…}}` templates in step values can reference. */
export interface WorkflowScope {
  workflow: { id: string; title: string };
  trigger: { kind: WorkflowTriggerKind };
  /** The record the run is about, when the trigger provides one. */
  record?: RecordData | Record<string, unknown> | null;
  /** The record event or the module event that started the run. */
  event?: RecordEventScope | ModuleEventScope | TaskEventScope | null;
  /** Outputs of the steps that already ran, by step id. */
  steps?: Record<string, unknown>;
  /** ISO timestamp of the run. */
  now: string;
  /** `YYYY-MM-DD` of the run. */
  today: string;
}

const TEMPLATE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const WHOLE_TEMPLATE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/;

/** Look a dotted path up in the scope; `undefined` when any segment is missing. */
export const resolveTemplatePath = (scope: WorkflowScope, path: string): unknown => {
  let current: unknown = scope;

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

const asText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (isRichTextDoc(value)) {
    // Rich text inside a sentence reads as the Markdown it was written as, not as the editor's JSON.
    return richTextToMarkdown(value);
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * Render `{{path}}` templates in a value. A string that is exactly one template resolves to the referenced value
 * with its type intact (numbers, booleans, ids); templates inside longer strings are interpolated as text.
 * Objects and arrays are rendered recursively; other values pass through.
 */
export const renderTemplate = (value: unknown, scope: WorkflowScope): unknown => {
  if (typeof value === 'string') {
    const whole = WHOLE_TEMPLATE.exec(value);

    if (whole?.[1]) {
      const resolved = resolveTemplatePath(scope, whole[1]);

      return resolved === undefined ? null : resolved;
    }

    return value.replace(TEMPLATE, (_, path: string) => asText(resolveTemplatePath(scope, path)));
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, scope));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, scope)]));
  }

  return value;
};

/** Every `{{path}}` a value references, in order of appearance, without duplicates. */
export const templateReferences = (value: unknown, into: Set<string> = new Set()): string[] => {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TEMPLATE)) {
      if (match[1]) {
        into.add(match[1]);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      templateReferences(item, into);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) {
      templateReferences(item, into);
    }
  }

  return [...into];
};

export const workflowScope = (input: {
  workflow: { id: string; title: string };
  trigger: { kind: WorkflowTriggerKind };
  record?: WorkflowScope['record'];
  event?: WorkflowScope['event'];
  now?: Date;
}): WorkflowScope => {
  const now = input.now ?? new Date();

  return {
    workflow: input.workflow,
    trigger: input.trigger,
    record: input.record ?? null,
    event: input.event ?? null,
    steps: {},
    now: now.toISOString(),
    today: now.toISOString().slice(0, 10),
  };
};

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Actors whose writes never start workflows, so automations cannot chain into a loop. */
export const isAutomationActor = (actor: { kind: string }): boolean =>
  actor.kind === 'function' || actor.kind === 'workflow' || actor.kind === 'module';

/**
 * Does a record event start this trigger, before looking at the record? Checks the object, the event type and, for
 * updates, the watched fields. The condition needs the record: see `matchesTriggerCondition`.
 */
export const matchesRecordEventTrigger = (
  trigger: RecordEventTrigger,
  event: RecordEvent,
  /** The id of the field of the event's object with this API name. */
  fieldIdOf: (name: string) => string,
): boolean => {
  if (event.objectId !== trigger.objectId) {
    return false;
  }

  if (!trigger.types.includes(event.type)) {
    return false;
  }

  if (event.importId && !trigger.onImport) {
    return false;
  }

  if (event.type === 'record.updated' && trigger.fieldIds && trigger.fieldIds.length > 0) {
    const changed = new Set((event.changedFields ?? []).map(fieldIdOf));

    if (!trigger.fieldIds.some((id) => changed.has(id))) {
      return false;
    }
  }

  return true;
};

export const matchesTriggerCondition = (
  trigger: RecordEventTrigger | ScheduleTrigger,
  record: Record<string, unknown> | null | undefined,
  /** The API name of the field with this id (or name) on the trigger's object. */
  fieldNameOf: (ref: string) => string,
): boolean => {
  if (!trigger.condition) {
    return true;
  }

  if (!record) {
    return false;
  }

  return evaluateFilter(record, mapFilterFields(trigger.condition, fieldNameOf));
};

/**
 * Does a task event start this trigger, before looking at the task? Checks the event's action and, for status changes,
 * the status it moved to. The condition needs the task: see `matchesTaskCondition`.
 */
export const matchesTaskEventTrigger = (trigger: TaskEventTrigger, event: TaskChangedEvent): boolean => {
  if (!(TASK_EVENT_TYPES as readonly string[]).includes(event.action)) {
    return false;
  }

  if (!trigger.types.includes(event.action as (typeof TASK_EVENT_TYPES)[number])) {
    return false;
  }

  return (
    event.action !== 'status_changed' ||
    !trigger.statuses ||
    (event.status !== undefined && (trigger.statuses as string[]).includes(event.status))
  );
};

/** Does the task as it is now meet the trigger's condition? */
export const matchesTaskCondition = (trigger: TaskEventTrigger, task: Record<string, unknown>): boolean =>
  trigger.condition === undefined || evaluateFilter(task, trigger.condition);

/** Does a module's event start this trigger? The module must match and the type be listed (or `*`). */
export const matchesModuleEventTrigger = (
  trigger: ModuleEventTrigger,
  event: { moduleId: string; eventType: string },
): boolean =>
  event.moduleId === trigger.moduleId && (trigger.types.includes(ANY_EVENT) || trigger.types.includes(event.eventType));

// ---------------------------------------------------------------------------------------------
// Checking an action step's input
// ---------------------------------------------------------------------------------------------

const isTemplate = (value: unknown): boolean => typeof value === 'string' && WHOLE_TEMPLATE.test(value);

/**
 * Why a step's input does not fit the action, or null: an unknown key, or a required one missing. Values are not
 * checked further, since templates only resolve when the step runs.
 */
export const stepInputProblem = (
  spec: Pick<AnyActionSpec, 'input'>,
  input: Record<string, unknown>,
): { message: string; key: string } | null => {
  const shape = spec.input.shape as Record<string, z.ZodType>;

  for (const key of Object.keys(input)) {
    if (!(key in shape)) {
      return { message: `Unknown input "${key}"`, key };
    }
  }

  for (const [key, schema] of Object.entries(shape)) {
    if (input[key] === undefined && !schema.safeParse(undefined).success) {
      return { message: `"${key}" is required`, key };
    }
  }

  return null;
};

/** The object a records action's input names, when it is written out rather than a template. */
export const literalObjectOf = (input: Record<string, unknown>): string | undefined =>
  typeof input.object === 'string' && !isTemplate(input.object) ? input.object : undefined;
