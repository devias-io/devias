import { z } from 'zod';
import { coreIds } from './core-ids';
import { RichTextDocSchema } from './document';
import { ActorSchema } from './events';
import type { FieldMetadata } from './metadata/schema';
import type { RichTextDoc } from './rich-text';
import {
  COMMENT_MAX_LENGTH,
  type Comment,
  CommentSchema,
  decodeTimelineCursor,
  encodeTimelineCursor,
  TIMELINE_DEFAULT_LIMIT,
  TIMELINE_MAX_LIMIT,
  type TimelineQuery,
  TimelineQuerySchema,
} from './timeline';

/**
 * A task: the unit of work handed between people and agents. Tasks are not records: they have tables of their own, so
 * nothing but the tasks service reads or writes them and every rule about who may move a task where lives in one place.
 * The description is the editor's document (`markdown` is the same text for callers that write Markdown); what
 * happens to a task is its timeline, where people and agents comment.
 */

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
export const TASKS_DEFAULT_LIMIT = 50;
export const TASKS_MAX_LIMIT = 100;
export const TASK_IDS_MAX = 100;
export const TASK_KEY_MAX_LENGTH = 200;
export const TASK_ACTIVITY_DEFAULT_LIMIT = TIMELINE_DEFAULT_LIMIT;
export const TASK_ACTIVITY_MAX_LIMIT = TIMELINE_MAX_LIMIT;
/** How deep subtasks nest: a task has depth 0, its subtasks 1, and so on up to this. */
export const TASK_MAX_DEPTH = 3;
/** The most tasks a person may link a task to as what it is about. */
export const TASK_ABOUT_MAX = 20;

// ---------------------------------------------------------------------------------------------
// Statuses, priorities, work
// ---------------------------------------------------------------------------------------------

/** Where a task is, in the order it moves. The platform fixes them and what each means (`TASK_STATUS_KINDS`). */
export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** What a status means: still to do (`open`), being worked (`active`), waiting for a decision (`review`), over (`closed`). */
export const TASK_STATUS_KINDS: Record<TaskStatus, 'open' | 'active' | 'review' | 'closed'> = {
  backlog: 'open',
  todo: 'open',
  in_progress: 'active',
  in_review: 'review',
  done: 'closed',
  canceled: 'closed',
};

export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter(
  (status) => TASK_STATUS_KINDS[status] === 'closed',
);

export const isTaskClosed = (status: string): boolean => CLOSED_TASK_STATUSES.includes(status as TaskStatus);

/** What a status reads as, and the colour the studio gives it. */
export const TASK_STATUS_OPTIONS: readonly { value: TaskStatus; label: string; color: string }[] = [
  { value: 'backlog', label: 'Backlog', color: 'neutral' },
  { value: 'todo', label: 'Todo', color: 'neutral' },
  { value: 'in_progress', label: 'In progress', color: 'orange' },
  { value: 'in_review', label: 'In review', color: 'purple' },
  { value: 'done', label: 'Done', color: 'green' },
  { value: 'canceled', label: 'Canceled', color: 'red' },
];

/** How soon it matters, most urgent first. */
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export const TASK_PRIORITY_OPTIONS: readonly { value: TaskPriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'red' },
  { value: 'high', label: 'High', color: 'orange' },
  { value: 'medium', label: 'Medium', color: 'yellow' },
  { value: 'low', label: 'Low', color: 'neutral' },
  { value: 'none', label: 'No priority', color: 'neutral' },
];

/** What an agent is doing about a task, when it is: shown on the task, written by the platform only. */
export const TASK_WORK_STATES = ['working', 'waiting_on_you', 'waiting_on_subtasks', 'failed'] as const;
export type TaskWorkState = (typeof TASK_WORK_STATES)[number];

export const TaskStatusSchema = z.enum(TASK_STATUSES).meta({ id: 'TaskStatus' });
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES).meta({ id: 'TaskPriority' });
export const TaskWorkStateSchema = z.enum(TASK_WORK_STATES).meta({ id: 'TaskWorkState' });

// ---------------------------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------------------------

export type AssigneeKind = 'user' | 'agent';

/** Who a task is for: a person, or an agent. */
export interface Assignee {
  kind: AssigneeKind;
  id: string;
}

/** `user:<id>` or `agent:<id>`: how an assignee is written everywhere. */
export const assigneeRef = (assignee: Assignee): string => `${assignee.kind}:${assignee.id}`;

/** The assignee a reference names; a bare id is a person's. */
export const parseAssigneeRef = (ref: string): Assignee | null => {
  const text = ref.trim();

  if (text === '') {
    return null;
  }

  const colon = text.indexOf(':');

  if (colon < 0) {
    return { kind: 'user', id: text };
  }

  const kind = text.slice(0, colon);
  const id = text.slice(colon + 1);

  return (kind === 'user' || kind === 'agent') && id !== '' ? { kind, id } : null;
};

const AssigneeRefSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((ref) => parseAssigneeRef(ref) !== null, 'An assignee is `user:<id>`, `agent:<id>` or a bare user id');

const DueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------------------------------------
// The task
// ---------------------------------------------------------------------------------------------

export const TaskSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    /** `user:<id>` or `agent:<id>`; null while nobody has it. */
    assignee: z.string().nullable(),
    /** `YYYY-MM-DD`. */
    dueDate: z.string().nullable(),
    parentId: z.string().nullable(),
    /** How many subtasks it has, and how many of them are still open. */
    subtasks: z.object({ total: z.number().int(), open: z.number().int() }),
    /** What an agent is doing about it, when one is. */
    work: TaskWorkStateSchema.nullable(),
    /** The agent run that has it now, when one does. */
    runId: z.string().nullable(),
    /** Counts every write; `expectedVersion` on a change names the one it was made from. */
    version: z.number().int(),
    createdBy: ActorSchema,
    updatedBy: ActorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    statusChangedAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .meta({ id: 'TaskSummary' });
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskLinkSchema = z
  .object({
    /** `record:<object>/<id>`, `document:<id>` or `task:<id>`. */
    link: z.string(),
    /** Mentioned in the description, or named as what the task is about. */
    role: z.enum(['mention', 'about']),
  })
  .meta({ id: 'TaskLink' });
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const TaskSchema = TaskSummarySchema.extend({
  /** The description, as the editor's document. */
  body: RichTextDocSchema,
  /** The same text as Markdown; mentions are `[Label](record:<object>/<id>)`, `[Label](document:<id>)`. */
  markdown: z.string(),
  /** What it mentions and what it is about. */
  links: z.array(TaskLinkSchema),
}).meta({ id: 'Task' });
export type Task = z.infer<typeof TaskSchema>;

const TitleSchema = z.string().trim().min(1, 'Give the task a title').max(TASK_TITLE_MAX_LENGTH);
const MarkdownSchema = z.string().max(200_000);
const LinkSchema = z.string().min(1).max(300);
const VersionSchema = z.number().int().min(1);

export const TaskInputSchema = z
  .object({
    title: TitleSchema,
    /** The description as the editor's document. Send this or `markdown`, not both; neither leaves it empty. */
    body: RichTextDocSchema.optional(),
    markdown: MarkdownSchema.optional(),
    /** Default `todo`. */
    status: TaskStatusSchema.optional(),
    /** Default `none`. */
    priority: TaskPrioritySchema.optional(),
    dueDate: DueDateSchema.nullable().optional(),
    /** `user:<id>`, `agent:<id>` or a bare user id; an agent that takes tasks starts on it as soon as it is ready. */
    assignee: AssigneeRefSchema.nullable().optional(),
    /** The task this one is a subtask of. */
    parent: z.string().min(1).nullable().optional(),
    /** What the task is about: links such as `record:company/<id>` or `document:<id>`. */
    about: z.array(LinkSchema).max(TASK_ABOUT_MAX).optional(),
    /** Asking again with the same key returns the task it made the first time instead of making another. */
    key: z.string().trim().min(1).max(TASK_KEY_MAX_LENGTH).optional(),
  })
  .refine((input) => input.body === undefined || input.markdown === undefined, 'Send `body` or `markdown`, not both')
  .meta({ id: 'TaskInput' });
export type TaskInput = z.input<typeof TaskInputSchema>;

export const TaskPatchSchema = z
  .object({
    title: TitleSchema.optional(),
    /** Replaces the whole description. Send this or `markdown`, not both. */
    body: RichTextDocSchema.optional(),
    markdown: MarkdownSchema.optional(),
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: DueDateSchema.nullable().optional(),
    assignee: AssigneeRefSchema.nullable().optional(),
    parent: z.string().min(1).nullable().optional(),
    /** Replaces what the task is about. */
    about: z.array(LinkSchema).max(TASK_ABOUT_MAX).optional(),
    /** The version this change was made from; a newer one makes it a `CONFLICT`. Leave it out to overwrite. */
    expectedVersion: VersionSchema.optional(),
  })
  .refine(
    (patch) => Object.entries(patch).some(([key, value]) => key !== 'expectedVersion' && value !== undefined),
    'Nothing to change',
  )
  .refine((patch) => patch.body === undefined || patch.markdown === undefined, 'Send `body` or `markdown`, not both')
  .meta({ id: 'TaskPatch' });
export type TaskPatch = z.input<typeof TaskPatchSchema>;

export const TASK_SORTS = ['updated', 'created', 'due', 'priority', 'closed', 'title'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** Which way each sort runs unless asked otherwise: the newest first, the most pressing first. */
export const TASK_SORT_DEFAULT_ORDER: Record<TaskSort, 'asc' | 'desc'> = {
  updated: 'desc',
  created: 'desc',
  due: 'asc',
  priority: 'asc',
  closed: 'desc',
  title: 'asc',
};

export const TASK_DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const TaskQuerySchema = z
  .object({
    /** Words of the title or the description. */
    search: z.string().trim().min(1).max(200).optional(),
    /** Only these statuses: separated by commas. */
    status: z.string().min(1).optional(),
    /** Only open tasks, or only closed ones. */
    scope: z.enum(['open', 'closed']).optional(),
    /** Who has it: `me`, `unassigned`, `agents`, `people`, or `user:<id>` / `agent:<id>`; several separated by commas. */
    assignee: z.string().min(1).optional(),
    /** Only these priorities: separated by commas. */
    priority: z.string().min(1).optional(),
    /** Due `overdue` (open tasks past their date), `today`, `week` (today and the next six days) or `none`. */
    due: z.enum(TASK_DUE_FILTERS).optional(),
    /** The caller's date (`YYYY-MM-DD`), which `due` counts from; today in UTC when left out. */
    today: DueDateSchema.optional(),
    /** Only subtasks of this task, or `none` for top-level tasks. */
    parent: z.string().min(1).optional(),
    /** Only tasks that mention or are about this: `record:<object>/<id>`, `document:<id>` or `task:<id>`. */
    mentions: z.string().min(1).optional(),
    /** Only these work states: separated by commas. */
    work: z.string().min(1).optional(),
    /** Only these tasks: ids separated by commas, at most 100. */
    ids: z.string().min(1).optional(),
    sort: z.enum(TASK_SORTS).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(TASKS_MAX_LIMIT).optional(),
  })
  .meta({ id: 'TaskQuery' });
export type TaskQuery = z.infer<typeof TaskQuerySchema>;

export const TaskPageSchema = z
  .object({
    items: z.array(TaskSummarySchema),
    nextCursor: z.string().nullable(),
    /** How many tasks match in all. */
    total: z.number().int(),
  })
  .meta({ id: 'TaskPage' });
export type TaskPage = z.infer<typeof TaskPageSchema>;

/** The items of a comma-separated query value. */
export const listOf = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];

/** Task cursors continue after one task: the sort and order it was made for, the sort key of the last task and its id. */
export const encodeTaskCursor = (sort: TaskSort, order: 'asc' | 'desc', key: string, id: string): string =>
  btoa(JSON.stringify([sort, order, key, id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const decodeTaskCursor = (
  cursor: string,
): { sort: TaskSort; order: 'asc' | 'desc'; key: string; id: string } | undefined => {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const value: unknown = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));

    if (
      Array.isArray(value) &&
      value.length === 4 &&
      (TASK_SORTS as readonly unknown[]).includes(value[0]) &&
      (value[1] === 'asc' || value[1] === 'desc') &&
      typeof value[2] === 'string' &&
      typeof value[3] === 'string'
    ) {
      return { sort: value[0] as TaskSort, order: value[1], key: value[2], id: value[3] };
    }
  } catch {
    // fall through: not a cursor
  }

  return undefined;
};

// ---------------------------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------------------------

export const TASK_ACTIVITY_KINDS = ['created', 'changed', 'comment', 'run', 'review'] as const;
export type TaskActivityKind = (typeof TASK_ACTIVITY_KINDS)[number];

/** What a `changed` entry records for one field: the value before and after, as the API shows them. */
export interface TaskChange {
  field: 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'parent' | 'about';
  from?: unknown;
  to?: unknown;
}

export const TaskActivityEntrySchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    kind: z.enum(TASK_ACTIVITY_KINDS),
    actor: ActorSchema,
    /** A comment's text, as Markdown. */
    body: z.string().nullable(),
    /** The changes of a `changed` entry (`{ changes: TaskChange[] }`), or what a run or a review did. */
    data: z.record(z.string(), z.unknown()).nullable(),
    /** The run that made it, when an agent did. */
    cause: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'TaskActivityEntry' });
export type TaskActivityEntry = z.infer<typeof TaskActivityEntrySchema>;

export const TaskActivityQuerySchema = TimelineQuerySchema;
export type TaskActivityQuery = TimelineQuery;

export const TaskActivityPageSchema = z
  .object({
    /** Newest first. */
    items: z.array(TaskActivityEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'TaskActivityPage' });
export type TaskActivityPage = z.infer<typeof TaskActivityPageSchema>;

export const TaskCommentSchema = CommentSchema;
export type TaskComment = Comment;

/** Task timelines page like every timeline. */
export const encodeTaskActivityCursor = encodeTimelineCursor;
export const decodeTaskActivityCursor = decodeTimelineCursor;

// ---------------------------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------------------------

/** Where one attempt of an agent at a task is: working, waiting for a person to approve what it proposes, or over. */
export const TASK_RUN_STATUSES = ['running', 'awaiting_review', 'completed', 'failed', 'cancelled'] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export const TaskRunSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    agentId: z.string(),
    /** The conversation the agent worked in: its steps, proposals and questions. */
    conversationId: z.string(),
    status: z.enum(TASK_RUN_STATUSES),
    /** 1 for the first try at a task, plus one for every retry. */
    attempt: z.number().int(),
    /** The person the agent acted for: it did only what they could do. */
    requestedBy: z.string(),
    /** What the agent said it did, for whoever reviews it. */
    summary: z.string().nullable(),
    error: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'TaskRun' });
export type TaskRun = z.infer<typeof TaskRunSchema>;

export const TaskRunPageSchema = z.object({ items: z.array(TaskRunSchema) }).meta({ id: 'TaskRunPage' });
export type TaskRunPage = z.infer<typeof TaskRunPageSchema>;

// ---------------------------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------------------------

export const TaskCountsQuerySchema = z
  .object({
    /** The caller's date (`YYYY-MM-DD`), which overdue and due dates count from; today in UTC when left out. */
    today: DueDateSchema.optional(),
  })
  .meta({ id: 'TaskCountsQuery' });
export type TaskCountsQuery = z.infer<typeof TaskCountsQuerySchema>;

export const TaskCountsSchema = z
  .object({
    /** Not done or canceled. */
    open: z.number().int(),
    overdue: z.number().int(),
    dueToday: z.number().int(),
    /** Today and the next six days. */
    dueThisWeek: z.number().int(),
    inReview: z.number().int(),
    /** Open tasks the caller has. */
    mine: z.number().int(),
    /** Tasks an agent is working on now. */
    agentsWorking: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
  })
  .meta({ id: 'TaskCounts' });
export type TaskCounts = z.infer<typeof TaskCountsSchema>;

// ---------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------

/**
 * The fields a workflow condition can test on a task, declared as field metadata so the condition builder and the
 * filter evaluator work on them like on any record: the task as a flat object has these keys (`assignee` is its
 * reference, `parent` the parent's id).
 */
export const TASK_FILTER_FIELDS: FieldMetadata[] = [
  { name: 'title', label: 'Title', type: 'text', settings: {} },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    settings: { options: TASK_STATUS_OPTIONS.map(({ value, label, color }) => ({ value, label, color })) },
  },
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    settings: { options: TASK_PRIORITY_OPTIONS.map(({ value, label, color }) => ({ value, label, color })) },
  },
  { name: 'assignee', label: 'Assignee', type: 'text', settings: {} },
  { name: 'due_date', label: 'Due date', type: 'date', settings: {} },
  { name: 'parent', label: 'Parent task', type: 'text', settings: {} },
].map((field, position) => ({
  workspaceId: '',
  objectId: coreIds.objects.task,
  id: coreIds.task_fields[field.name as keyof typeof coreIds.task_fields],
  ...field,
  isRequired: false,
  isUnique: false,
  position,
  moduleId: null,
}));

/** A task as a flat object a workflow condition is tested on. */
export const taskConditionRecord = (
  task: Pick<TaskSummary, 'id' | 'title' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'parentId'>,
) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  assignee: task.assignee,
  due_date: task.dueDate,
  parent: task.parentId,
});

export type { RichTextDoc };
