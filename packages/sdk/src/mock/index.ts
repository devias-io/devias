import {
  type ActivityQuery,
  type Actor,
  type AggregateQuery,
  type ApplyOptions,
  type ConnectionAuthorize,
  type ConnectionCreate,
  type ConnectionPatch,
  type ConnectionQuery,
  type DeviasClient,
  type DocumentAppend,
  type DocumentCommentInput,
  type DocumentCommentPatch,
  type DocumentInput,
  type DocumentPatch,
  type DocumentQuery,
  type DocumentThreadsQuery,
  isEventVisibleTo,
  type LookupInput,
  type MetadataCrud,
  type ModuleManifest,
  type NotificationInput,
  type NotificationQuery,
  type Page,
  type Query,
  type RecordCommentInput,
  type RecordCommentPatch,
  type RecordCommentQuery,
  type RecordData,
  type RunWorkflowInput,
  type SubscribeOptions,
  type TaskActivityQuery,
  type TaskComment,
  type TaskCountsQuery,
  type TaskInput,
  type TaskPatch,
  type TaskQuery,
  type TimelineQuery,
  type WebhookEventQuery,
  type WorkflowActivityQuery,
  type WorkflowRunQuery,
  type WorkspaceEvent,
} from '@devias/core';
import { listActivity } from './activity';
import { createMockAi, type MockAiOptions } from './ai';
import {
  appendToDocument,
  commentOnDocument,
  createDocument,
  deleteDocument,
  deleteDocumentComment,
  getDocument,
  listDocumentActivity,
  listDocumentComments,
  listDocuments,
  updateDocument,
  updateDocumentComment,
} from './documents';
import { createMetadataApi, type SyncCrud } from './metadata';
import {
  authorizeConnection,
  createConnection,
  disconnectConnection,
  getConnection,
  listCatalog,
  listConnections,
  listModuleVariables,
  listWebhookEvents,
  runModuleAction,
  testConnection,
  updateConnection,
  updateModuleVariables,
} from './module-connections';
import {
  countUnreadNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  sendNotification,
} from './notifications';
import { applyManifest, planManifest, uninstallModule } from './reconcile';
import { createRecordComment, deleteRecordComment, listRecordComments, updateRecordComment } from './record-comments';
import {
  aggregateMockRecords,
  createRecord,
  deleteRecords,
  getRecord,
  importRecords,
  listRecords,
  lookupRecords,
  updateRecord,
  upsertRecord,
} from './records';
import { type MockMember, type MockSnapshot, MockStore } from './store';
import {
  commentOnTask,
  countTasks,
  createTask,
  deleteTask,
  getTask,
  listTaskActivity,
  listTaskRuns,
  listTasks,
  retryTask,
  stopTask,
  updateTask,
} from './tasks';
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listRecordWorkflowRuns,
  listWorkflowRuns,
  listWorkflows,
  retryWorkflowRun,
  runWorkflow,
  runWorkflowsForEvent,
  updateWorkflow,
  workflowActivity,
} from './workflows';

/**
 * `DeviasClient` backed by an in-memory store: same contract, same errors, no server. Metadata comes from
 * the manifests passed in (reconciled exactly like the server would), records from what callers insert, and the
 * whole state can optionally persist to `localStorage`.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockClientOptions {
  workspaceId: string;
  /** Manifests to install at start-up (e.g. a contacts module); any manifest is accepted. */
  manifests?: ModuleManifest[];
  /** Artificial delay for every call, in ms. */
  latency?: number;
  /** Persist state under `key` (in `localStorage` when available, or the given storage). */
  persist?: { key: string; storage?: StorageLike };
  actor?: Actor;
  now?: () => string;
  /** Scripted agent options (see `createMockAi`). */
  ai?: MockAiOptions;
  /** Modules the mock server can install besides `manifests` (e.g. ones that need a server, like a payment provider). */
  catalog?: ModuleManifest[];
  /**
   * The workspace's members, who notifications go to: `to.users` must name them, `to.roles` and `to.all` pick from
   * them. Default: the person behind `actor`, as owner.
   */
  members?: MockMember[];
}

export interface MockClient extends DeviasClient {
  readonly store: MockStore;
  /** Rebuild from the manifests, discarding all changes (and the persisted copy). */
  reset(): void;
}

const resolveStorage = (persist: MockClientOptions['persist']): StorageLike | undefined => {
  if (!persist) {
    return undefined;
  }

  if (persist.storage) {
    return persist.storage;
  }

  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;

    return storage && typeof storage.getItem === 'function' ? storage : undefined;
  } catch {
    return undefined;
  }
};

const isSnapshot = (value: unknown): value is MockSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { version?: unknown }).version === 'number' &&
  Array.isArray((value as { objects?: unknown }).objects) &&
  Array.isArray((value as { events?: unknown }).events);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createMockClient = (options: MockClientOptions): MockClient => {
  const { workspaceId } = options;
  const manifests = options.manifests ?? [];
  const latency = options.latency ?? 0;
  const store = new MockStore({
    workspaceId,
    actor: options.actor,
    now: options.now,
    catalog: [...manifests, ...(options.catalog ?? []).filter((m) => !manifests.some((own) => own.id === m.id))],
    members: options.members,
  });
  const storage = resolveStorage(options.persist);
  const persistKey = options.persist?.key;

  let saveScheduled = false;
  const save = () => {
    if (!storage || !persistKey || saveScheduled) {
      return;
    }

    saveScheduled = true;
    queueMicrotask(() => {
      saveScheduled = false;

      try {
        storage.setItem(persistKey, JSON.stringify(store.snapshot()));
      } catch {
        // storage full or unavailable: keep going in memory
      }
    });
  };

  const load = (): boolean => {
    if (!storage || !persistKey) {
      return false;
    }

    try {
      const raw = storage.getItem(persistKey);

      if (!raw) {
        return false;
      }

      const parsed: unknown = JSON.parse(raw);

      if (!isSnapshot(parsed) || parsed.workspaceId !== workspaceId) {
        return false;
      }

      store.restore(parsed);

      return true;
    } catch {
      return false;
    }
  };

  const initialize = () => {
    store.silent = true;

    try {
      for (const manifest of manifests) {
        applyManifest(store, manifest, { allowDestructive: true });
      }
    } finally {
      store.silent = false;
    }

    store.touch();
    save();
  };

  load();
  initialize();
  store.onChange = save;
  // Record-event and module-event workflows react to the store's own events, like the server runner follows the log.
  store.subscribe((event) => {
    runWorkflowsForEvent(store, event);
  });

  const run = async <T>(fn: () => T): Promise<T> => {
    if (latency > 0) {
      await sleep(latency);
    }

    return fn();
  };

  const asyncCrud = <TRow, TInput>(sync: SyncCrud<TRow, TInput>): MetadataCrud<TRow, TInput> => ({
    list: () => run(() => structuredClone(sync.list())),
    get: (id) => run(() => structuredClone(sync.get(id))),
    create: (input) => run(() => structuredClone(sync.create(input))),
    update: (id, patch) => run(() => structuredClone(sync.update(id, patch))),
    delete: (id) => run(() => sync.delete(id)),
  });
  const metadata = createMetadataApi(store);
  const ai = createMockAi(store, { ...(options.now ? { now: options.now } : {}), ...options.ai });

  return {
    workspaceId,
    store,
    reset: () => {
      store.clear();

      try {
        if (storage && persistKey) {
          storage.removeItem(persistKey);
        }
      } catch {
        // ignore
      }

      initialize();
    },
    records: {
      list: <T extends RecordData = RecordData>(query: Query) => run(() => listRecords(store, query) as Page<T>),
      get: <T extends RecordData = RecordData>(object: string, id: string) =>
        run(() => getRecord(store, object, id) as T),
      create: <T extends RecordData = RecordData>(object: string, data: Record<string, unknown>) =>
        run(() => createRecord(store, object, data) as T),
      update: <T extends RecordData = RecordData>(object: string, id: string, patch: Record<string, unknown>) =>
        run(() => updateRecord(store, object, id, patch) as T),
      delete: (object: string, ids: string[]) => run(() => deleteRecords(store, object, ids)),
      import: (object, body) => run(() => importRecords(store, object, body)),
      upsert: <T extends RecordData = RecordData>(
        object: string,
        match: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => run(() => upsertRecord(store, object, match, values) as { record: T; created: boolean }),
      lookup: (input: LookupInput) => run(() => lookupRecords(store, input)),
      aggregate: (query: AggregateQuery) => run(() => aggregateMockRecords(store, query)),
    },
    metadata: {
      getSchema: () => run(() => structuredClone(store.schema())),
      objects: asyncCrud(metadata.objects),
      fields: asyncCrud(metadata.fields),
      views: asyncCrud(metadata.views),
      layouts: asyncCrud(metadata.layouts),
      navItems: {
        ...asyncCrud(metadata.navItems),
        arrange: (moves) => run(() => structuredClone(metadata.navItems.arrange(moves))),
        reset: (id) => run(() => structuredClone(metadata.navItems.reset(id))),
        resetAll: () => run(() => structuredClone(metadata.navItems.resetAll())),
      },
      commandItems: asyncCrud(metadata.commandItems),
    },
    modules: {
      list: () => run(() => structuredClone([...store.modules.values()])),
      catalog: () => run(() => listCatalog(store)),
      logoUrl: () => undefined,
      plan: (manifest: ModuleManifest) => run(() => planManifest(store, manifest)),
      apply: (manifest: ModuleManifest, opts?: ApplyOptions) => run(() => applyManifest(store, manifest, opts)),
      uninstall: (moduleId: string, opts?: ApplyOptions) => run(() => uninstallModule(store, moduleId, opts)),
      connections: {
        list: (query?: ConnectionQuery) => run(() => listConnections(store, query)),
        get: (id: string) => run(() => getConnection(store, id)),
        create: (input: ConnectionCreate) => run(() => createConnection(store, input)),
        update: (id: string, patch: ConnectionPatch) => run(() => updateConnection(store, id, patch)),
        authorize: (input: ConnectionAuthorize) => run(() => authorizeConnection(store, input)),
        test: (id: string) => run(() => testConnection(store, id)),
        disconnect: (id: string) => run(() => disconnectConnection(store, id)),
      },
      variables: {
        list: (moduleId: string) => run(() => listModuleVariables(store, moduleId)),
        update: (moduleId: string, values: Record<string, string>) =>
          run(() => updateModuleVariables(store, moduleId, { values })),
      },
      runAction: (moduleId: string, action: string, input?: Record<string, unknown>) =>
        run(() => runModuleAction(store, moduleId, action, input)),
      events: (moduleId: string, query?: WebhookEventQuery) => run(() => listWebhookEvents(store, moduleId, query)),
    },
    activity: {
      list: (object: string, id: string, query?: ActivityQuery) => run(() => listActivity(store, object, id, query)),
    },
    comments: {
      list: (object: string, id: string, query?: RecordCommentQuery) =>
        run(() => listRecordComments(store, object, id, query)),
      create: (object: string, id: string, input: RecordCommentInput) =>
        run(() => createRecordComment(store, object, id, input)),
      update: (object: string, id: string, commentId: string, patch: RecordCommentPatch) =>
        run(() => updateRecordComment(store, object, id, commentId, patch)),
      delete: (object: string, id: string, commentId: string) =>
        run(() => deleteRecordComment(store, object, id, commentId)),
    },
    documents: {
      list: (query?: DocumentQuery) => run(() => listDocuments(store, query)),
      get: (id: string) => run(() => getDocument(store, id)),
      create: (input: DocumentInput) => run(() => createDocument(store, input)),
      update: (id: string, patch: DocumentPatch) => run(() => updateDocument(store, id, patch)),
      append: (id: string, input: DocumentAppend) => run(() => appendToDocument(store, id, input)),
      activity: (id: string, query?: TimelineQuery) => run(() => listDocumentActivity(store, id, query)),
      comment: (id: string, input: DocumentCommentInput) => run(() => commentOnDocument(store, id, input)),
      comments: (id: string, query?: DocumentThreadsQuery) => run(() => listDocumentComments(store, id, query)),
      updateComment: (id: string, commentId: string, patch: DocumentCommentPatch) =>
        run(() => updateDocumentComment(store, id, commentId, patch)),
      deleteComment: (id: string, commentId: string) => run(() => deleteDocumentComment(store, id, commentId)),
      delete: (id: string) => run(() => deleteDocument(store, id)),
    },
    tasks: {
      list: (query?: TaskQuery) => run(() => listTasks(store, query)),
      get: (id: string) => run(() => getTask(store, id)),
      create: (input: TaskInput) => run(() => createTask(store, input)),
      update: (id: string, patch: TaskPatch) => run(() => updateTask(store, id, patch)),
      delete: (id: string) => run(() => deleteTask(store, id)),
      activity: (id: string, query?: TaskActivityQuery) => run(() => listTaskActivity(store, id, query)),
      comment: (id: string, input: TaskComment) => run(() => commentOnTask(store, id, input)),
      counts: (query?: TaskCountsQuery) => run(() => countTasks(store, query)),
      runs: (id: string) => run(() => listTaskRuns(store, id)),
      stop: (id: string) => run(() => stopTask(store, id)),
      retry: (id: string) => run(() => retryTask(store, id)),
    },
    notifications: {
      list: (query?: NotificationQuery) => run(() => listNotifications(store, query)),
      unreadCount: () => run(() => countUnreadNotifications(store)),
      send: (input: NotificationInput) => run(() => sendNotification(store, input)),
      markRead: (id: string) => run(() => markNotificationRead(store, id)),
      markUnread: (id: string) => run(() => markNotificationUnread(store, id)),
      markAllRead: () => run(() => markAllNotificationsRead(store)),
      delete: (id: string) => run(() => deleteNotification(store, id)),
    },
    workflows: {
      list: () => run(() => listWorkflows(store)),
      get: (id: string) => run(() => getWorkflow(store, id)),
      create: (input) => run(() => createWorkflow(store, input)),
      update: (id: string, patch) => run(() => updateWorkflow(store, id, patch)),
      delete: (id: string) => run(() => deleteWorkflow(store, id)),
      runs: (id: string, query?: WorkflowRunQuery) => run(() => listWorkflowRuns(store, id, query)),
      activity: (query?: WorkflowActivityQuery) => run(() => workflowActivity(store, query)),
      recordRuns: (query) => run(() => listRecordWorkflowRuns(store, query)),
      run: (id: string, input?: RunWorkflowInput) => run(() => runWorkflow(store, id, input)),
      retryRun: (id: string, runId: string) => run(() => retryWorkflowRun(store, id, runId)),
    },
    events: {
      subscribe: (handler: (event: WorkspaceEvent) => void, opts?: SubscribeOptions) => {
        let closed = false;
        opts?.onStatus?.('connecting');
        // Like the server's feed: a person sees their own notification events only, keys and automations none.
        const unsubscribe = store.subscribe((event) => {
          if (isEventVisibleTo(event, store.actor)) {
            handler(event);
          }
        }, opts?.after);
        queueMicrotask(() => {
          if (!closed) {
            opts?.onStatus?.('open');
          }
        });

        return () => {
          if (closed) {
            return;
          }

          closed = true;
          unsubscribe();
          opts?.onStatus?.('closed');
        };
      },
    },
    ai,
  };
};

export { listActivity } from './activity';
export { createMockAi, type MockAiOptions } from './ai';

export { createMockAuthAdapter, MOCK_TEAMMATES, type MockAuthAdapter, type MockAuthOptions } from './auth';
export { createMetadataApi, type SyncCrud, type SyncMetadataApi } from './metadata';
export {
  authorizeConnection,
  createConnection,
  disconnectConnection,
  getConnection,
  listCatalog,
  listConnections,
  listModuleVariables,
  listWebhookEvents,
  receiveWebhookEvent,
  runModuleAction,
  testConnection,
  updateConnection,
  updateModuleVariables,
} from './module-connections';
export {
  countUnreadNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  resolveNotificationAudience,
  sendNotification,
} from './notifications';
export { applyManifest, planManifest, uninstallModule } from './reconcile';
export {
  createRecord,
  deleteRecords,
  getRecord,
  type InsertOptions,
  listRecords,
  lookupRecords,
  updateRecord,
} from './records';
export {
  DEFAULT_MOCK_ACTOR,
  type MockActivityInput,
  type MockActivityRow,
  type MockEventInput,
  type MockMember,
  type MockSnapshot,
  MockStore,
  type MockStoreOptions,
  type StoredRecord,
} from './store';
export {
  createWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getWorkflow,
  listWorkflowRuns,
  listWorkflows,
  runDueWorkflows,
  runWorkflow,
  runWorkflowsForEvent,
  updateWorkflow,
  validateMockWorkflow,
  workflowActivity,
} from './workflows';
