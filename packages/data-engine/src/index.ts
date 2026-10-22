import type { ModuleManifest } from '@devias/core';
import { type ActivityService, createActivityService } from './activity/service';
import type { DataSource } from './datasource/interface';
import { createPostgresJsonbDataSource } from './datasource/postgres-jsonb';
import type { Db } from './db/exec';
import { createDocumentService, type DocumentService } from './documents/service';
import { createLocalBus, type EventBus } from './events/bus';
import { createEventService, type EventService } from './events/service';
import { consoleLogger, type Logger } from './logger';
import { createMetadataService, type MetadataService } from './metadata/service';
import { SnapshotCache } from './metadata/snapshot';
import { createMetadataStore } from './metadata/store';
import { createModuleService, type ModuleService } from './modules/apply';
import { type ConnectionsService, createConnectionsService } from './modules/connections';
import { createJobsService, type JobsService } from './modules/jobs';
import { createModuleKvService, type ModuleKvService } from './modules/kv';
import { createModuleEventsService, type ModuleEventsService } from './modules/module-events';
import { createSecretBox } from './modules/secret-box';
import { createModuleVariablesService, type ModuleVariablesService } from './modules/variables';
import { createNoteService, type NoteService } from './notes/service';
import { createNotificationService, type NotificationService } from './notifications/service';
import { authorize, can } from './permissions/policy';
import { createRecordService, type RecordService } from './records/service';
import { createTaskService, type TaskService } from './tasks/service';
import { createWorkflowService, type WorkflowService } from './workflows/service';
import { createWorkspaceService, type WorkspaceService } from './workspace/init';

export interface DataEngineOptions {
  db: Db;
  dataSource?: DataSource;
  bus?: EventBus;
  clock?: () => Date;
  logger?: Logger;
  /** Manifests applied to every workspace on initialization (the product's starting set of modules). */
  seedManifests?: ModuleManifest[];
  /**
   * Seals module connections' credentials at rest (AES-256-GCM). Without it a fixed development key is used, which keeps
   * tests simple but protects nothing; the server always passes one.
   */
  encryptionKey?: string;
}

/** The key used when none is configured: fine for tests and the mock, never for real secrets. */
export const DEV_ENCRYPTION_KEY = 'devias-dev-encryption-key-not-for-production';

export interface DataEngine {
  db: Db;
  bus: EventBus;
  logger: Logger;
  records: RecordService;
  /** A record's history. */
  activity: ActivityService;
  /** A record's notes. */
  notes: NoteService;
  /** Documents: titled pages of rich text, in tables of their own. */
  documents: DocumentService;
  /** Tasks: work handed between people and agents, in tables of their own. */
  tasks: TaskService;
  metadata: MetadataService;
  modules: ModuleService;
  events: EventService;
  /** Workspace automations and their runs. */
  workflows: WorkflowService;
  /** Connections of installed modules to their outside services: API keys and OAuth accounts. */
  connections: ConnectionsService;
  /** Workspaces' values of their modules' workspace variables. */
  moduleVariables: ModuleVariablesService;
  /** The events modules delivered through their webhooks. */
  moduleEvents: ModuleEventsService;
  /** Modules' background jobs. */
  jobs: JobsService;
  /** Modules' own small state per workspace (`ctx.kv`). */
  moduleKv: ModuleKvService;
  /** People's notifications: each one's own inbox, and sending to members. */
  notifications: NotificationService;
  permissions: { authorize: typeof authorize; can: typeof can };
  workspaces: WorkspaceService;
  close(): Promise<void>;
}

export const createDataEngine = (options: DataEngineOptions): DataEngine => {
  const { db } = options;
  const bus = options.bus ?? createLocalBus();
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? consoleLogger;
  const dataSource = options.dataSource ?? createPostgresJsonbDataSource();
  const cache = new SnapshotCache();
  const store = createMetadataStore({ dataSource, clock });

  const metadata = createMetadataService({ db, cache, store, bus, clock, logger });
  const records = createRecordService({ db, metadata, dataSource, bus, clock });
  const activity = createActivityService({ db, metadata });
  const notes = createNoteService({ db, metadata, dataSource, bus, clock });
  const documents = createDocumentService({ db, metadata, bus, clock });
  const tasks = createTaskService({ db, metadata, bus, clock });
  const modules = createModuleService({ db, cache, store, dataSource, bus, clock, logger });
  const events = createEventService(db, bus);
  const connections = createConnectionsService({
    db,
    bus,
    clock,
    secrets: createSecretBox(options.encryptionKey ?? DEV_ENCRYPTION_KEY),
    metadata,
  });
  const moduleVariables = createModuleVariablesService({ db, clock, metadata });
  const moduleEvents = createModuleEventsService({ db, bus, clock, metadata });
  const jobs = createJobsService({ db, bus, clock });
  const moduleKv = createModuleKvService({ db, clock });
  const workflows = createWorkflowService({ db, metadata, bus, clock });
  const notifications = createNotificationService({ db, bus, clock });
  const workspaces = createWorkspaceService({
    db,
    cache,
    dataSource,
    logger,
    seedManifests: options.seedManifests ?? [],
    apply: (ctx, manifest, opts) => modules.apply(ctx, manifest, opts),
  });

  return {
    db,
    bus,
    logger,
    records,
    activity,
    notes,
    documents,
    tasks,
    metadata,
    modules,
    events,
    workflows,
    connections,
    moduleVariables,
    moduleEvents,
    jobs,
    moduleKv,
    notifications,
    permissions: { authorize, can },
    workspaces,
    close: () => bus.close(),
  };
};

export * from './actions';
export type { ActivityService } from './activity/service';
export * from './context';
export * from './datasource/interface';
export {
  compileFilter,
  compileQuery,
  compileSearch,
  compileSorts,
  createPostgresJsonbDataSource,
  decodeCursor,
  encodeCursor,
  keysetPredicate,
  normalizeUnique,
  orderByClause,
  queryHash,
  sortKeysOf,
} from './datasource/postgres-jsonb';
export type { Db } from './db/exec';
export { parseJson, runRaw, toIso, toNumber } from './db/exec';
export type { DocumentService } from './documents/service';
export * from './errors';
export * from './events/bus';
export {
  allocateSequences,
  bumpMetadataVersion,
  currentSequence,
  lockWorkspace,
  readEventDiff,
  readEventsAfter,
  writeEvents,
} from './events/feed';
export type { EventService } from './events/service';
export * from './logger';
export { buildRecordSchemas, RecordSchemaCache, type RecordSchemas } from './metadata/record-schema';
export type { MetadataCrudService, MetadataService } from './metadata/service';
export { loadSnapshot, type Snapshot, SnapshotCache } from './metadata/snapshot';
export {
  createMetadataStore,
  isCompatibleTypeChange,
  type MetadataStore,
  type Ownership,
  relationTargetOf,
} from './metadata/store';
export type { ModuleService } from './modules/apply';
export {
  type BeginOAuth,
  type ConnectionsService,
  type GrantedTokens,
  type OAuthCredentials,
  type OAuthStateRecord,
  type ResolveOptions,
  type SaveOAuth,
  type StoredConnection,
  WEBHOOK_PATH_PREFIX,
  webhookPathOf,
} from './modules/connections';
export type { ClaimedJob, EnqueueJob, JobsService } from './modules/jobs';
export { KV_VALUE_MAX_BYTES, type ModuleKvService } from './modules/kv';
export type { IncomingEvent, ModuleEventsService } from './modules/module-events';
export * from './modules/reconcile';
export { createSecretBox, deriveKey, isSealed, type SecretBox } from './modules/secret-box';
export type { ModuleVariablesService } from './modules/variables';
export type { NoteService } from './notes/service';
export {
  createNotificationService,
  type NotificationSendInput,
  type NotificationService,
  type NotificationServiceDeps,
} from './notifications/service';
export * from './permissions/policy';
export * from './query/validate';
export { BATCH_MAX, type BatchInput, type BatchResult, type RecordService } from './records/service';
export * from './scoped';
export type { AssigneePort, TaskService } from './tasks/service';
export {
  nextScheduledRun,
  validateWorkflow,
  type WorkflowService,
} from './workflows/service';
export type { WorkspaceService } from './workspace/init';
