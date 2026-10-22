import type { ImportBody, ImportReport } from './actions/records';
import type { ActivityPage, ActivityQuery } from './activity';
import type { AiClient } from './ai';
import type {
  Document,
  DocumentActivityPage,
  DocumentAppend,
  DocumentComment,
  DocumentCommentInput,
  DocumentCommentPatch,
  DocumentInput,
  DocumentPage,
  DocumentPatch,
  DocumentQuery,
  DocumentThreadPage,
  DocumentThreadsQuery,
} from './document';
import type { WorkspaceEvent } from './events';
import type { ModuleManifest } from './manifest/manifest';
import type { ApplyOptions, ApplyResult, PlanResult } from './manifest/plan';
import type {
  CommandItemInput,
  FieldInput,
  LayoutInput,
  LookupHit,
  LookupInput,
  NavItemInput,
  ObjectCreateInput,
  ObjectInput,
  ViewInput,
} from './metadata/inputs';
import type {
  CommandItem,
  FieldMetadata,
  InstalledModule,
  Layout,
  NavItem,
  ObjectMetadata,
  ViewMetadata,
  WorkspaceSchema,
} from './metadata/schema';
import type {
  Connection,
  ConnectionAuthorize,
  ConnectionAuthorizeResult,
  ConnectionCreate,
  ConnectionList,
  ConnectionPatch,
  ConnectionQuery,
  ConnectionTestResult,
  Job,
  JobPage,
  JobQuery,
  ModuleEventPage,
  ModuleEventQuery,
  ModuleVariable,
} from './module-runtime';
import type { Note, NoteInput, NotePage, NotePatch, NoteQuery } from './notes';
import type {
  MarkAllReadResult,
  Notification,
  NotificationInput,
  NotificationPage,
  NotificationQuery,
  NotificationSendResult,
  UnreadCount,
} from './notifications';
import type { AggregateQuery, AggregateResult } from './query/aggregate';
import type { Page, Query, RecordData } from './query/ir';
import type {
  Task,
  TaskActivityEntry,
  TaskActivityPage,
  TaskActivityQuery,
  TaskComment,
  TaskCounts,
  TaskCountsQuery,
  TaskInput,
  TaskPage,
  TaskPatch,
  TaskQuery,
  TaskRunPage,
} from './task';
import type { TimelineQuery } from './timeline';
import type {
  RunWorkflowInput,
  Workflow,
  WorkflowActivity,
  WorkflowActivityQuery,
  WorkflowInput,
  WorkflowRun,
  WorkflowRunPage,
  WorkflowRunQuery,
} from './workflow';

/**
 * The client contract the studio and modules code against. `@devias/sdk` implements it twice:
 * over HTTP and as an in-memory mock.
 */

export interface MetadataCrud<TRow, TInput, TCreate = TInput> {
  list(): Promise<TRow[]>;
  get(id: string): Promise<TRow>;
  create(input: TCreate): Promise<TRow>;
  update(id: string, patch: Partial<TInput>): Promise<TRow>;
  delete(id: string): Promise<void>;
}

export type EventStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SubscribeOptions {
  /** Resume after this sequence number (exclusive). */
  after?: number;
  onStatus?: (status: EventStreamStatus) => void;
}

export interface DeviasClient {
  readonly workspaceId: string;
  records: {
    list<T extends RecordData = RecordData>(query: Query): Promise<Page<T>>;
    get<T extends RecordData = RecordData>(object: string, id: string): Promise<T>;
    create<T extends RecordData = RecordData>(object: string, data: Record<string, unknown>): Promise<T>;
    update<T extends RecordData = RecordData>(object: string, id: string, patch: Record<string, unknown>): Promise<T>;
    delete(object: string, ids: string[]): Promise<void>;
    /** Update the record whose unique field `match` names, or create one; `created` says which. */
    /** Rows of a file, as text, read for an object: valid ones written, the rest reported by row (see `ImportBody`). */
    import(object: string, body: ImportBody): Promise<ImportReport>;
    upsert<T extends RecordData = RecordData>(
      object: string,
      match: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ record: T; created: boolean }>;
    lookup(input: LookupInput): Promise<LookupHit[]>;
    /** Counts and measures over one object's records, per group or in total. */
    aggregate(query: AggregateQuery): Promise<AggregateResult>;
  };
  metadata: {
    getSchema(): Promise<WorkspaceSchema>;
    objects: MetadataCrud<ObjectMetadata, ObjectInput, ObjectCreateInput>;
    fields: MetadataCrud<FieldMetadata, FieldInput>;
    views: MetadataCrud<ViewMetadata, ViewInput>;
    layouts: MetadataCrud<Layout, LayoutInput>;
    navItems: MetadataCrud<NavItem, NavItemInput> & {
      /** Place several items at once, as one change: each with its parent and its place among its siblings. */
      arrange(moves: { id: string; parentId: string | null; position: number }[]): Promise<NavItem[]>;
      /** Drop the workspace's overrides of one of a module's items. */
      reset(id: string): Promise<NavItem>;
      /** Put the whole sidebar back to its defaults; items the workspace created stay. */
      resetAll(): Promise<NavItem[]>;
    };
    commandItems: MetadataCrud<CommandItem, CommandItemInput>;
  };
  modules: {
    list(): Promise<InstalledModule[]>;
    /** Every module the server can install, by manifest (installed or not). */
    catalog(): Promise<ModuleManifest[]>;
    /** Where a module's logo (its manifest's `logo`) is served from; none in the mock backend, which has no files. */
    logoUrl(moduleId: string): string | undefined;
    plan(manifest: ModuleManifest): Promise<PlanResult>;
    apply(manifest: ModuleManifest, opts?: ApplyOptions): Promise<ApplyResult>;
    uninstall(moduleId: string, opts?: ApplyOptions): Promise<ApplyResult>;
    /**
     * Connections of installed modules to their outside services: the workspace's and the caller's own. Credentials
     * never come back, only masked hints.
     */
    connections: {
      list(query?: ConnectionQuery): Promise<ConnectionList>;
      get(id: string): Promise<Connection>;
      /** Store an API key connection and test it; `status` says how it went. */
      create(input: ConnectionCreate): Promise<Connection>;
      /** Replace some values (an empty string clears an optional one) or the label; tested again. */
      update(id: string, patch: ConnectionPatch): Promise<Connection>;
      /** The consent page of an OAuth provider, to open in the person's browser. */
      authorize(input: ConnectionAuthorize): Promise<ConnectionAuthorizeResult>;
      test(id: string): Promise<ConnectionTestResult>;
      disconnect(id: string): Promise<void>;
    };
    /** Modules' background jobs, newest first, and running a failed one again. */
    jobs: {
      list(query?: JobQuery): Promise<JobPage>;
      get(id: string): Promise<Job>;
      retry(id: string): Promise<Job>;
    };
    /** An installed module's variables: what is in effect, and setting the workspace's own. */
    variables: {
      list(moduleId: string): Promise<ModuleVariable[]>;
      /** An empty string goes back to the default. */
      update(moduleId: string, values: Record<string, string>): Promise<ModuleVariable[]>;
    };
    /** Run one of a module's actions now, outside any workflow; resolves with what the action returned. */
    runAction(moduleId: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
    /** Events the module delivered (its webhook deliveries), newest first. */
    events(moduleId: string, query?: ModuleEventQuery): Promise<ModuleEventPage>;
  };
  /** A record's history. */
  activity: {
    list(object: string, id: string, query?: ActivityQuery): Promise<ActivityPage>;
  };
  /** A record's notes: titled, editable text that belongs to the record. */
  notes: {
    list(object: string, id: string, query?: NoteQuery): Promise<NotePage>;
    /** Writes a note as the caller. */
    create(object: string, id: string, input: NoteInput): Promise<Note>;
    /** Authors edit their own notes; admins any. */
    update(object: string, id: string, noteId: string, patch: NotePatch): Promise<Note>;
    /** Authors remove their own notes; admins any. */
    delete(object: string, id: string, noteId: string): Promise<void>;
  };
  /** Documents: titled pages of rich text that mention records and each other. */
  documents: {
    /** Newest change first, without their text. */
    list(query?: DocumentQuery): Promise<DocumentPage>;
    get(id: string): Promise<Document>;
    create(input: DocumentInput): Promise<Document>;
    /** `expectedVersion` makes a change made from an older version a `CONFLICT`. */
    update(id: string, patch: DocumentPatch): Promise<Document>;
    /** Adds Markdown after the last block, atomically. */
    append(id: string, input: DocumentAppend): Promise<Document>;
    /** When it was made, who edited it and the comments on it, newest first. */
    activity(id: string, query?: TimelineQuery): Promise<DocumentActivityPage>;
    /** Comment on the document, on a selection of its text (`anchor`) or on a thread (`parent`). */
    comment(id: string, input: DocumentCommentInput): Promise<DocumentComment>;
    /** Threads: top-level comments with their replies. */
    comments(id: string, query?: DocumentThreadsQuery): Promise<DocumentThreadPage>;
    /** Resolve or reopen a thread, or change a comment's text. */
    updateComment(id: string, commentId: string, patch: DocumentCommentPatch): Promise<DocumentComment>;
    deleteComment(id: string, commentId: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  /** Tasks: work handed between people and agents, with subtasks, links and a timeline. */
  tasks: {
    /** Most recently changed first (see `sort`), without their text. */
    list(query?: TaskQuery): Promise<TaskPage>;
    get(id: string): Promise<Task>;
    create(input: TaskInput): Promise<Task>;
    /** `expectedVersion` makes a change made from an older version a `CONFLICT`. */
    update(id: string, patch: TaskPatch): Promise<Task>;
    delete(id: string): Promise<void>;
    /** Comments, changes and runs of one task, newest first. */
    activity(id: string, query?: TaskActivityQuery): Promise<TaskActivityPage>;
    comment(id: string, input: TaskComment): Promise<TaskActivityEntry>;
    counts(query?: TaskCountsQuery): Promise<TaskCounts>;
    /** The attempts an agent made at the task, newest first. */
    runs(id: string): Promise<TaskRunPage>;
    /** Cancels the agent's run; the task is marked failed until it is retried. */
    stop(id: string): Promise<Task>;
    /** Puts a failed or stopped task back in the agent's queue. */
    retry(id: string): Promise<Task>;
  };
  /** The caller's notifications (people only), and sending to others. */
  notifications: {
    /** Newest first; `unread: true` keeps the unread ones. */
    list(query?: NotificationQuery): Promise<NotificationPage>;
    unreadCount(): Promise<UnreadCount>;
    /** Notify members: `to.all`, `to.roles`, `to.users` (user ids) or `to.me`. */
    send(input: NotificationInput): Promise<NotificationSendResult>;
    markRead(id: string): Promise<Notification>;
    markUnread(id: string): Promise<Notification>;
    markAllRead(): Promise<MarkAllReadResult>;
    delete(id: string): Promise<void>;
  };
  /** Automations configured in the workspace, and their runs. */
  workflows: {
    list(): Promise<Workflow[]>;
    get(id: string): Promise<Workflow>;
    create(input: WorkflowInput): Promise<Workflow>;
    update(id: string, patch: Partial<WorkflowInput>): Promise<Workflow>;
    delete(id: string): Promise<void>;
    /** A workflow's runs, newest first. */
    runs(id: string, query?: WorkflowRunQuery): Promise<WorkflowRunPage>;
    /** Runs per day over the last days, and how every workflow that has run is doing. */
    activity(query?: WorkflowActivityQuery): Promise<WorkflowActivity>;
    /** Run a workflow now; `recordId` names the record when the trigger has an object. */
    run(id: string, input?: RunWorkflowInput): Promise<WorkflowRun>;
    /** Run it again on what an earlier run was about; the new run names it in `trigger.retryOf`. */
    retryRun(id: string, runId: string): Promise<WorkflowRun>;
  };
  events: {
    subscribe(handler: (event: WorkspaceEvent) => void, opts?: SubscribeOptions): () => void;
  };
  /** The agent: conversations, streamed turns, approvals and settings. */
  ai: AiClient;
}

/** Error shape every client implementation throws for API failures. */
export class DeviasApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DeviasApiError';
  }
}

export type ApiErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'UNIQUE_VIOLATION'
  | 'INVALID_CURSOR'
  | 'DESTRUCTIVE_CHANGE'
  | 'PLAN_MISMATCH'
  | 'MISSING_DEPENDENCY'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'INTERNAL';
