import { z } from 'zod';

export const ActorSchema = z
  .object({
    kind: z.enum(['user', 'api_key', 'function', 'workflow', 'system', 'agent', 'module']),
    id: z.string(),
    /**
     * The person behind it: who an agent acts for (the agent in someone's chat), or who started a module's code
     * (a module action someone ran). A module acting for someone keeps its own role; the person is for history.
     */
    onBehalfOf: z.object({ kind: z.literal('user'), id: z.string() }).optional(),
  })
  .meta({ id: 'Actor' });
export type Actor = z.infer<typeof ActorSchema>;

/** The person behind an actor: a signed-in user, or the user an agent acts for. Null for keys and automations. */
export const personOf = (actor: Actor): string | null =>
  actor.kind === 'user' ? actor.id : actor.kind === 'agent' ? (actor.onBehalfOf?.id ?? null) : null;

export const RECORD_EVENT_TYPES = ['record.created', 'record.updated', 'record.deleted'] as const;
export type RecordEventType = (typeof RECORD_EVENT_TYPES)[number];

const base = {
  sequence: z.number().int(),
  workspaceId: z.string(),
  actor: ActorSchema,
  occurredAt: z.string(),
};

export const RecordEventSchema = z.object({
  ...base,
  type: z.enum(RECORD_EVENT_TYPES),
  objectId: z.string(),
  object: z.string(),
  recordId: z.string(),
  changedFields: z.array(z.string()).optional(),
  /** The import that wrote the record, when one did: a data load is not a business event (see `onImport`). */
  importId: z.string().optional(),
});
export type RecordEvent = z.infer<typeof RecordEventSchema>;

/** A comment on a record was written, edited or removed; the record itself did not change. */
export const RECORD_COMMENT_EVENT_TYPES = ['comment.created', 'comment.updated', 'comment.deleted'] as const;
export type RecordCommentEventType = (typeof RECORD_COMMENT_EVENT_TYPES)[number];

export const RecordCommentEventSchema = z.object({
  ...base,
  type: z.enum(RECORD_COMMENT_EVENT_TYPES),
  objectId: z.string(),
  object: z.string(),
  recordId: z.string(),
  commentId: z.string(),
});
export type RecordCommentEvent = z.infer<typeof RecordCommentEventSchema>;

export const MetadataEventSchema = z.object({
  ...base,
  type: z.literal('metadata.changed'),
  entity: z.enum(['object', 'field', 'view', 'layout', 'nav_item', 'command_item', 'module']),
  entityId: z.string().optional(),
  metadataVersion: z.number().int(),
});
export type MetadataEvent = z.infer<typeof MetadataEventSchema>;

export const ModuleAppliedEventSchema = z.object({
  ...base,
  type: z.literal('module.applied'),
  moduleId: z.string(),
  version: z.string(),
  metadataVersion: z.number().int(),
});
export type ModuleAppliedEvent = z.infer<typeof ModuleAppliedEventSchema>;

/** A workflow was created, changed or removed. */
export const WorkflowChangedEventSchema = z.object({
  ...base,
  type: z.literal('workflow.changed'),
  workflowId: z.string(),
  action: z.enum(['created', 'updated', 'deleted']),
});
export type WorkflowChangedEvent = z.infer<typeof WorkflowChangedEventSchema>;

/** A workflow finished a run. */
export const WorkflowRunEventSchema = z.object({
  ...base,
  type: z.literal('workflow.run'),
  workflowId: z.string(),
  runId: z.string(),
  status: z.enum(['succeeded', 'failed']),
});
export type WorkflowRunEvent = z.infer<typeof WorkflowRunEventSchema>;

/** A document was created, changed or removed. */
export const DocumentChangedEventSchema = z.object({
  ...base,
  type: z.literal('document.changed'),
  documentId: z.string(),
  action: z.enum(['created', 'updated', 'commented', 'deleted']),
});
export type DocumentChangedEvent = z.infer<typeof DocumentChangedEventSchema>;

/**
 * A task was created, changed, commented on or removed. `changes` names what an update changed (`status`,
 * `assignee`, …); `cause` names the run of an agent that made it, so an agent's own writes can be told from a person's.
 */
export const TASK_CHANGES = [
  'created',
  'updated',
  'status_changed',
  'assigned',
  'commented',
  'work_changed',
  'run_started',
  'handed_in',
  'run_failed',
  'run_stopped',
  'run_retried',
  'deleted',
] as const;
export type TaskChangeAction = (typeof TASK_CHANGES)[number];
/**
 * The task events that are lines on a task's timeline (one per write, carrying the whole change); the others
 * (`status_changed`, `assigned`, `commented`, `work_changed`, `deleted`) are signals for triggers and live refresh.
 */
export const TASK_TIMELINE_ACTIONS = [
  'created',
  'updated',
  'run_started',
  'handed_in',
  'run_failed',
  'run_stopped',
  'run_retried',
] as const;

/** The task events a workflow can start from (a removed task cannot be read by the run). */
export const TASK_EVENT_TYPES = [
  'created',
  'updated',
  'status_changed',
  'assigned',
  'commented',
  'run_failed',
] as const;
export const TaskChangedEventSchema = z.object({
  ...base,
  type: z.literal('task.changed'),
  taskId: z.string(),
  action: z.enum(TASK_CHANGES),
  /** The fields an update changed. */
  changes: z.array(z.string()).optional(),
  /** The status a `status_changed` event moved the task to. */
  status: z.string().optional(),
  /** `user:<id>` or `agent:<id>` of the new assignee of an `assigned` event; null when it was unassigned. */
  assignee: z.string().nullable().optional(),
  /** The agent run that made the change, when one did. */
  runId: z.string().optional(),
});
export type TaskChangedEvent = z.infer<typeof TaskChangedEventSchema>;

/**
 * A connection to a module's outside service was made, changed or tested fine (`module.connected`), removed
 * (`module.disconnected`), or refused by the service (`module.connection.failed`: its status is `auth_failed`).
 */
export const MODULE_CONNECTION_EVENT_TYPES = [
  'module.connected',
  'module.disconnected',
  'module.connection.failed',
] as const;
export type ModuleConnectionEventType = (typeof MODULE_CONNECTION_EVENT_TYPES)[number];

export const ModuleConnectionEventSchema = z.object({
  ...base,
  type: z.enum(MODULE_CONNECTION_EVENT_TYPES),
  moduleId: z.string(),
  connectionId: z.string(),
  providerId: z.string(),
});
export type ModuleConnectionEvent = z.infer<typeof ModuleConnectionEventSchema>;

/** A module delivered an event (through its webhook); the stored event carries the payload. */
export const ModuleEventReceivedSchema = z.object({
  ...base,
  type: z.literal('module.event'),
  moduleId: z.string(),
  /** The module's event type (`invoice.paid`, `email.delivered`). */
  eventType: z.string(),
  /** The stored `ModuleEvent` id. */
  eventId: z.string(),
});
export type ModuleEventReceived = z.infer<typeof ModuleEventReceivedSchema>;

/** A module's job failed for good: its retries are spent, or it threw an error that is not worth retrying. */
export const JobFailedEventSchema = z.object({
  ...base,
  type: z.literal('job.failed'),
  moduleId: z.string(),
  jobId: z.string(),
  /** The job's name (`sync`), as its module defines it. */
  name: z.string(),
});
export type JobFailedEvent = z.infer<typeof JobFailedEventSchema>;

/**
 * A notification of one person was created, read (or unread again) or deleted. Only its recipient sees these on the
 * feed (`isEventVisibleTo`); `notificationId` is null when every notification of theirs was marked read at once.
 */
export const NotificationEventSchema = z.object({
  ...base,
  type: z.literal('notification.changed'),
  recipientId: z.string(),
  notificationId: z.string().nullable(),
  action: z.enum(['created', 'read', 'deleted']),
});
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

export const WorkspaceEventSchema = z
  .discriminatedUnion('type', [
    RecordEventSchema,
    RecordCommentEventSchema,
    MetadataEventSchema,
    ModuleAppliedEventSchema,
    WorkflowChangedEventSchema,
    WorkflowRunEventSchema,
    DocumentChangedEventSchema,
    TaskChangedEventSchema,
    ModuleConnectionEventSchema,
    ModuleEventReceivedSchema,
    JobFailedEventSchema,
    NotificationEventSchema,
  ])
  .meta({ id: 'WorkspaceEvent' });
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;

export const isRecordEvent = (event: WorkspaceEvent): event is RecordEvent => event.type.startsWith('record.');

export const isRecordCommentEvent = (event: WorkspaceEvent): event is RecordCommentEvent =>
  event.type.startsWith('comment.');

export const isWorkflowEvent = (event: WorkspaceEvent): event is WorkflowChangedEvent | WorkflowRunEvent =>
  event.type.startsWith('workflow.');

export const isDocumentEvent = (event: WorkspaceEvent): event is DocumentChangedEvent =>
  event.type === 'document.changed';

export const isTaskEvent = (event: WorkspaceEvent): event is TaskChangedEvent => event.type === 'task.changed';

export const isModuleConnectionEvent = (event: WorkspaceEvent): event is ModuleConnectionEvent =>
  (MODULE_CONNECTION_EVENT_TYPES as readonly string[]).includes(event.type);

export const isModuleRuntimeEvent = (
  event: WorkspaceEvent,
): event is ModuleConnectionEvent | ModuleEventReceived | JobFailedEvent =>
  isModuleConnectionEvent(event) || event.type === 'module.event' || event.type === 'job.failed';

export const isNotificationEvent = (event: WorkspaceEvent): event is NotificationEvent =>
  event.type === 'notification.changed';

/**
 * Whether a reader of the feed may see an event. Everything is shared across the workspace except notification
 * events, which only their recipient sees: the person behind the actor (a signed-in user, or the one an agent acts
 * for). Api keys and automations see none of them.
 */
export const isEventVisibleTo = (event: WorkspaceEvent, actor: Actor): boolean =>
  !isNotificationEvent(event) || personOf(actor) === event.recipientId;
