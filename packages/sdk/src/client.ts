import type {
  ActivityPage,
  AggregateQuery,
  AggregateResult,
  ApplyOptions,
  ApplyResult,
  CommandItem,
  CommandItemInput,
  Connection,
  ConnectionAuthorize,
  ConnectionAuthorizeResult,
  ConnectionCreate,
  ConnectionList,
  ConnectionPatch,
  ConnectionQuery,
  ConnectionTestResult,
  DeviasClient,
  Document,
  DocumentActivityPage,
  DocumentAppend,
  DocumentComment,
  DocumentInput,
  DocumentPage,
  DocumentPatch,
  DocumentQuery,
  DocumentThreadPage,
  FieldInput,
  FieldMetadata,
  ImportReport,
  InstalledModule,
  Job,
  JobPage,
  JobQuery,
  Layout,
  LayoutInput,
  LookupHit,
  LookupInput,
  MarkAllReadResult,
  MetadataCrud,
  ModuleEventPage,
  ModuleEventQuery,
  ModuleManifest,
  ModuleVariable,
  NavItem,
  NavItemInput,
  Note,
  NotePage,
  Notification,
  NotificationInput,
  NotificationPage,
  NotificationQuery,
  NotificationSendResult,
  ObjectCreateInput,
  ObjectInput,
  ObjectMetadata,
  Page,
  PlanResult,
  Query,
  RecordData,
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
  TimelineQuery,
  UnreadCount,
  ViewInput,
  ViewMetadata,
  Workflow,
  WorkflowActivity,
  WorkflowActivityQuery,
  WorkflowInput,
  WorkflowRun,
  WorkflowRunPage,
  WorkflowRunQuery,
  WorkspaceSchema,
} from '@devias/core';
import { createAiApi } from './ai';
import { createHttpClient, type HttpClient } from './http';
import { subscribeEvents } from './sse';
import type { ClientOptions, MeResponse, WorkspaceApi, WorkspaceApiOptions, WorkspaceSummary } from './types';

/**
 * `DeviasClient` over the REST contract (`/api/workspaces/:workspace/...`). Module code that needs custom
 * routes can reuse the underlying `http` client so auth and error mapping stay identical.
 */
export interface HttpDeviasClient extends DeviasClient {
  readonly http: HttpClient;
}

const enc = encodeURIComponent;

export const createClient = (options: ClientOptions): HttpDeviasClient => {
  const http = createHttpClient(options);
  const { workspaceId } = options;
  const ws = `/api/workspaces/${enc(workspaceId)}`;

  const crud = <TRow, TInput, TCreate = TInput>(segment: string): MetadataCrud<TRow, TInput, TCreate> => ({
    list: () => http.get<TRow[]>(`${ws}/metadata/${segment}`),
    get: (id) => http.get<TRow>(`${ws}/metadata/${segment}/${enc(id)}`),
    create: (input) => http.post<TRow>(`${ws}/metadata/${segment}`, input),
    update: (id, patch) => http.patch<TRow>(`${ws}/metadata/${segment}/${enc(id)}`, patch),
    delete: async (id) => {
      await http.delete(`${ws}/metadata/${segment}/${enc(id)}`);
    },
  });

  return {
    workspaceId,
    http,
    records: {
      list: <T extends RecordData = RecordData>(query: Query) =>
        http.post<Page<T>>(`${ws}/records/${enc(query.object)}/list`, query),
      get: <T extends RecordData = RecordData>(object: string, id: string) =>
        http.get<T>(`${ws}/records/${enc(object)}/${enc(id)}`),
      create: <T extends RecordData = RecordData>(object: string, data: Record<string, unknown>) =>
        http.post<T>(`${ws}/records/${enc(object)}`, data),
      update: <T extends RecordData = RecordData>(object: string, id: string, patch: Record<string, unknown>) =>
        http.patch<T>(`${ws}/records/${enc(object)}/${enc(id)}`, patch),
      delete: async (object, ids) => {
        await http.delete(`${ws}/records/${enc(object)}`, { body: { ids } });
      },
      import: (object, body) => http.post<ImportReport>(`${ws}/records/${enc(object)}/import`, body),
      upsert: <T extends RecordData = RecordData>(
        object: string,
        match: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => http.post<{ record: T; created: boolean }>(`${ws}/records/${enc(object)}/upsert`, { match, values }),
      lookup: (input: LookupInput) => http.post<LookupHit[]>(`${ws}/lookup`, input),
      aggregate: ({ object, ...query }: AggregateQuery) =>
        http.post<AggregateResult>(`${ws}/records/${enc(object)}/aggregate`, query),
    },
    metadata: {
      getSchema: () => http.get<WorkspaceSchema>(`${ws}/metadata`),
      objects: crud<ObjectMetadata, ObjectInput, ObjectCreateInput>('objects'),
      fields: crud<FieldMetadata, FieldInput>('fields'),
      views: crud<ViewMetadata, ViewInput>('views'),
      layouts: crud<Layout, LayoutInput>('layouts'),
      navItems: {
        ...crud<NavItem, NavItemInput>('nav-items'),
        arrange: (items) => http.post<NavItem[]>(`${ws}/metadata/nav-items/arrange`, { items }),
        reset: (id) => http.post<NavItem>(`${ws}/metadata/nav-items/${enc(id)}/reset`, {}),
        resetAll: () => http.post<NavItem[]>(`${ws}/metadata/nav-items/reset`, {}),
      },
      commandItems: crud<CommandItem, CommandItemInput>('command-items'),
    },
    modules: {
      list: () => http.get<InstalledModule[]>(`${ws}/modules`),
      catalog: () => http.get<ModuleManifest[]>(`${ws}/modules/catalog`),
      logoUrl: (moduleId) => http.url(`/api/modules/${enc(moduleId)}/logo`),
      plan: (manifest: ModuleManifest) => http.post<PlanResult>(`${ws}/modules/plan`, { manifest }),
      apply: (manifest: ModuleManifest, opts?: ApplyOptions) =>
        http.post<ApplyResult>(`${ws}/modules/apply`, {
          manifest,
          ...(opts?.expectedPlanHash !== undefined ? { expectedPlanHash: opts.expectedPlanHash } : {}),
          ...(opts?.allowDestructive !== undefined ? { allowDestructive: opts.allowDestructive } : {}),
        }),
      uninstall: (moduleId: string, opts?: ApplyOptions) =>
        http.delete<ApplyResult>(`${ws}/modules/${enc(moduleId)}`, {
          query: {
            allowDestructive: opts?.allowDestructive ? 'true' : undefined,
            expectedPlanHash: opts?.expectedPlanHash,
          },
        }),
      connections: {
        list: (query?: ConnectionQuery) => http.get<ConnectionList>(`${ws}/connections`, { module: query?.module }),
        get: (id) => http.get<Connection>(`${ws}/connections/${enc(id)}`),
        create: (input: ConnectionCreate) => http.post<Connection>(`${ws}/connections`, input),
        update: (id, patch: ConnectionPatch) => http.patch<Connection>(`${ws}/connections/${enc(id)}`, patch),
        authorize: (input: ConnectionAuthorize) =>
          http.post<ConnectionAuthorizeResult>(`${ws}/connections/authorize`, input),
        test: (id) => http.post<ConnectionTestResult>(`${ws}/connections/${enc(id)}/test`, {}),
        disconnect: async (id) => {
          await http.delete(`${ws}/connections/${enc(id)}`);
        },
      },
      jobs: {
        list: (query?: JobQuery) =>
          http.get<JobPage>(`${ws}/jobs`, {
            module: query?.module,
            status: query?.status,
            name: query?.name,
            cursor: query?.cursor,
            limit: query?.limit,
          }),
        get: (id) => http.get<Job>(`${ws}/jobs/${enc(id)}`),
        retry: (id) => http.post<Job>(`${ws}/jobs/${enc(id)}/retry`, {}),
      },
      variables: {
        list: (moduleId) => http.get<ModuleVariable[]>(`${ws}/modules/${enc(moduleId)}/variables`),
        update: (moduleId, values) =>
          http.patch<ModuleVariable[]>(`${ws}/modules/${enc(moduleId)}/variables`, { values }),
      },
      runAction: (moduleId, action, input) =>
        http.post<unknown>(`${ws}/modules/${enc(moduleId)}/actions/${enc(action)}`, input ?? {}),
      events: (moduleId, query?: ModuleEventQuery) =>
        http.get<ModuleEventPage>(`${ws}/modules/${enc(moduleId)}/events`, {
          cursor: query?.cursor,
          limit: query?.limit,
          type: query?.type,
        }),
    },
    activity: {
      list: (object, id, query) =>
        http.get<ActivityPage>(`${ws}/records/${enc(object)}/${enc(id)}/activity`, {
          cursor: query?.cursor,
          limit: query?.limit,
        }),
    },
    notes: {
      list: (object, id, query) =>
        http.get<NotePage>(`${ws}/records/${enc(object)}/${enc(id)}/notes`, {
          cursor: query?.cursor,
          limit: query?.limit,
        }),
      create: (object, id, input) => http.post<Note>(`${ws}/records/${enc(object)}/${enc(id)}/notes`, input),
      update: (object, id, noteId, patch) =>
        http.patch<Note>(`${ws}/records/${enc(object)}/${enc(id)}/notes/${enc(noteId)}`, patch),
      delete: async (object, id, noteId) => {
        await http.delete(`${ws}/records/${enc(object)}/${enc(id)}/notes/${enc(noteId)}`);
      },
    },
    documents: {
      list: (query?: DocumentQuery) =>
        http.get<DocumentPage>(`${ws}/documents`, {
          search: query?.search,
          mentions: query?.mentions,
          ids: query?.ids,
          updatedAfter: query?.updatedAfter,
          cursor: query?.cursor,
          limit: query?.limit,
        }),
      get: (id) => http.get<Document>(`${ws}/documents/${enc(id)}`),
      create: (input: DocumentInput) => http.post<Document>(`${ws}/documents`, input),
      update: (id, patch: DocumentPatch) => http.patch<Document>(`${ws}/documents/${enc(id)}`, patch),
      append: (id, input: DocumentAppend) => http.post<Document>(`${ws}/documents/${enc(id)}/append`, input),
      activity: (id, query?: TimelineQuery) =>
        http.get<DocumentActivityPage>(`${ws}/documents/${enc(id)}/activity`, {
          cursor: query?.cursor,
          limit: query?.limit,
        }),
      comment: (id, input) => http.post<DocumentComment>(`${ws}/documents/${enc(id)}/comments`, input),
      comments: (id, query) =>
        http.get<DocumentThreadPage>(`${ws}/documents/${enc(id)}/comments`, { status: query?.status }),
      updateComment: (id, commentId, patch) =>
        http.patch<DocumentComment>(`${ws}/documents/${enc(id)}/comments/${enc(commentId)}`, patch),
      deleteComment: async (id, commentId) => {
        await http.delete(`${ws}/documents/${enc(id)}/comments/${enc(commentId)}`);
      },
      delete: async (id) => {
        await http.delete(`${ws}/documents/${enc(id)}`);
      },
    },
    tasks: {
      list: (query?: TaskQuery) =>
        http.get<TaskPage>(`${ws}/tasks`, {
          search: query?.search,
          status: query?.status,
          scope: query?.scope,
          assignee: query?.assignee,
          priority: query?.priority,
          due: query?.due,
          today: query?.today,
          parent: query?.parent,
          mentions: query?.mentions,
          work: query?.work,
          ids: query?.ids,
          sort: query?.sort,
          order: query?.order,
          cursor: query?.cursor,
          limit: query?.limit,
        }),
      get: (id) => http.get<Task>(`${ws}/tasks/${enc(id)}`),
      create: (input: TaskInput) => http.post<Task>(`${ws}/tasks`, input),
      update: (id, patch: TaskPatch) => http.patch<Task>(`${ws}/tasks/${enc(id)}`, patch),
      delete: async (id) => {
        await http.delete(`${ws}/tasks/${enc(id)}`);
      },
      activity: (id, query?: TaskActivityQuery) =>
        http.get<TaskActivityPage>(`${ws}/tasks/${enc(id)}/activity`, {
          cursor: query?.cursor,
          limit: query?.limit,
        }),
      comment: (id, input: TaskComment) => http.post<TaskActivityEntry>(`${ws}/tasks/${enc(id)}/comments`, input),
      counts: (query?: TaskCountsQuery) => http.get<TaskCounts>(`${ws}/tasks/counts`, { today: query?.today }),
      runs: (id) => http.get<TaskRunPage>(`${ws}/tasks/${enc(id)}/runs`),
      stop: (id) => http.post<Task>(`${ws}/tasks/${enc(id)}/stop`, {}),
      retry: (id) => http.post<Task>(`${ws}/tasks/${enc(id)}/retry`, {}),
    },
    notifications: {
      list: (query?: NotificationQuery) =>
        http.get<NotificationPage>(`${ws}/notifications`, {
          cursor: query?.cursor,
          limit: query?.limit,
          unread: query?.unread,
        }),
      unreadCount: () => http.get<UnreadCount>(`${ws}/notifications/unread-count`),
      send: (input: NotificationInput) => http.post<NotificationSendResult>(`${ws}/notifications`, input),
      markRead: (id) => http.post<Notification>(`${ws}/notifications/${enc(id)}/read`, {}),
      markUnread: (id) => http.post<Notification>(`${ws}/notifications/${enc(id)}/unread`, {}),
      markAllRead: () => http.post<MarkAllReadResult>(`${ws}/notifications/read-all`, {}),
      delete: async (id) => {
        await http.delete(`${ws}/notifications/${enc(id)}`);
      },
    },
    workflows: {
      list: () => http.get<Workflow[]>(`${ws}/workflows`),
      get: (id) => http.get<Workflow>(`${ws}/workflows/${enc(id)}`),
      create: (input: WorkflowInput) => http.post<Workflow>(`${ws}/workflows`, input),
      update: (id, patch: Partial<WorkflowInput>) => http.patch<Workflow>(`${ws}/workflows/${enc(id)}`, patch),
      delete: async (id) => {
        await http.delete(`${ws}/workflows/${enc(id)}`);
      },
      runs: (id, query?: WorkflowRunQuery) =>
        http.get<WorkflowRunPage>(`${ws}/workflows/${enc(id)}/runs`, { cursor: query?.cursor, limit: query?.limit }),
      activity: (query?: WorkflowActivityQuery) =>
        http.get<WorkflowActivity>(`${ws}/workflow-activity`, { days: query?.days, tz: query?.tz }),
      run: (id, input) => http.post<WorkflowRun>(`${ws}/workflows/${enc(id)}/run`, input ?? {}),
      retryRun: (id, runId) => http.post<WorkflowRun>(`${ws}/workflows/${enc(id)}/runs/${enc(runId)}/retry`, {}),
    },
    events: {
      subscribe: (handler, opts) =>
        subscribeEvents({
          url: http.url(`${ws}/events`),
          headers: http.headers(),
          after: opts?.after,
          onEvent: handler,
          onStatus: opts?.onStatus,
          fetch: http.fetch,
          credentials: http.credentials,
        }),
    },
    ai: createAiApi(http, ws),
  };
};

/** Calls that do not belong to a workspace: session, workspace list, workspace creation. */
export const createWorkspaceApi = (options: WorkspaceApiOptions): WorkspaceApi => {
  const http = createHttpClient(options);

  return {
    me: () => http.get<MeResponse>('/api/me'),
    listWorkspaces: () => http.get<WorkspaceSummary[]>('/api/workspaces'),
    createWorkspace: (input) => http.post<WorkspaceSummary>('/api/workspaces', input),
  };
};
