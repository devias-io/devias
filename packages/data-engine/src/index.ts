import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_MAX_BYTES_DEFAULT, type ModuleManifest } from '@devias/core';
import { type ActivityService, createActivityService } from './activity/service';
import { type AssetService, createAssetService } from './assets/service';
import type { DataSource } from './datasource/interface';
import { createPostgresJsonbDataSource } from './datasource/postgres-jsonb';
import type { Db } from './db/exec';
import { createDocumentService, type DocumentService } from './documents/service';
import { createLocalBus, type EventBus } from './events/bus';
import { createEventService, type EventService } from './events/service';
import type { ImageProcessor } from './files/images';
import { createLocalFileStore } from './files/local-store';
import { createFileService, type FileService } from './files/service';
import type { FileStore } from './files/store';
import { createFileUrlSigner, DEV_FILE_URL_SECRET, type FileUrlSigner } from './files/urls';
import { consoleLogger, type Logger } from './logger';
import { createMetadataService, type MetadataService } from './metadata/service';
import { SnapshotCache } from './metadata/snapshot';
import { createMetadataStore } from './metadata/store';
import { createModuleService, type ModuleService } from './modules/apply';
import { type ConnectionsService, createConnectionsService } from './modules/connections';
import { createKvService, type KvService } from './modules/kv';
import { createSecretBox } from './modules/secret-box';
import { createVariablesService, type VariablesService } from './modules/variables';
import { createWebhookEventsService, type WebhookEventsService } from './modules/webhook-events';
import { createNotificationService, type NotificationService } from './notifications/service';
import { authorize, can } from './permissions/policy';
import { createRecordCommentService, type RecordCommentService } from './record-comments/service';
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
  /** Where the bytes of files live. Without it they go to a folder under the system's temporary directory: fine for tests, lost on reboot. */
  fileStore?: FileStore;
  /** Makes and checks the links that open a file without credentials. Without it a fixed development key signs them. */
  fileUrls?: FileUrlSigner;
  /** The largest file in bytes; default 25 MB. */
  fileMaxBytes?: number;
  /** The most one workspace may store in bytes; unlimited by default. */
  fileQuotaBytes?: number;
  /** How old an object without a row must be, in milliseconds, before the sweeper removes it; default one hour. */
  fileSweepGraceMs?: number;
  /** The image library: the size of pictures at upload and thumbnails on demand. Without it pictures are stored and served as they are. */
  imageProcessor?: ImageProcessor;
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
  /** A record's comments. */
  comments: RecordCommentService;
  /** Documents: titled pages of rich text, in tables of their own. */
  documents: DocumentService;
  /** Tasks: work handed between people and agents, in tables of their own. */
  tasks: TaskService;
  /** Files: stored bytes, under assets and under what belongs to no library (a picture). It decides nobody's access. */
  files: FileService;
  /** Assets: a workspace's library of files, what people and agents manage and link to. */
  assets: AssetService;
  metadata: MetadataService;
  modules: ModuleService;
  events: EventService;
  /** Workspace automations and their runs. */
  workflows: WorkflowService;
  /** Connections of installed modules to their outside services: API keys and OAuth accounts. */
  connections: ConnectionsService;
  /** Workspaces' values of their modules' variables, by variable id; the secret ones sealed. */
  variables: VariablesService;
  /** The events modules delivered through their webhooks. */
  webhookEvents: WebhookEventsService;
  /** Modules' own small state per workspace (`ctx.kv`). */
  kv: KvService;
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
  const comments = createRecordCommentService({ db, metadata, dataSource, bus, clock });
  const documents = createDocumentService({ db, metadata, bus, clock });
  const tasks = createTaskService({ db, metadata, bus, clock });
  const fileUrls = options.fileUrls ?? createFileUrlSigner({ secret: DEV_FILE_URL_SECRET, clock });
  const files = createFileService({
    db,
    clock,
    logger,
    store: options.fileStore ?? createLocalFileStore(join(tmpdir(), `devias-files-${process.pid}`)),
    urls: fileUrls,
    maxBytes: options.fileMaxBytes ?? FILE_MAX_BYTES_DEFAULT,
    quotaBytes: options.fileQuotaBytes ?? null,
    sweepGraceMs: options.fileSweepGraceMs ?? 60 * 60 * 1000,
    ...(options.imageProcessor ? { images: options.imageProcessor } : {}),
  });
  const assets = createAssetService({ db, bus, clock, files, urls: fileUrls });
  const modules = createModuleService({ db, cache, store, dataSource, bus, clock, logger });
  const events = createEventService(db, bus);
  const connections = createConnectionsService({
    db,
    bus,
    clock,
    secrets: createSecretBox(options.encryptionKey ?? DEV_ENCRYPTION_KEY),
    metadata,
  });
  const variables = createVariablesService({
    db,
    clock,
    secrets: createSecretBox(options.encryptionKey ?? DEV_ENCRYPTION_KEY),
    metadata,
  });
  const webhookEvents = createWebhookEventsService({ db, bus, clock, metadata });
  const kv = createKvService({ db, clock });
  const workflows = createWorkflowService({ db, metadata, bus, clock });
  const notifications = createNotificationService({ db, bus, clock });
  const workspaces = createWorkspaceService({
    db,
    cache,
    dataSource,
    logger,
    purgeFiles: (workspaceId) => files.purgeWorkspace(workspaceId),
    seedManifests: options.seedManifests ?? [],
    apply: (ctx, manifest, opts) => modules.apply(ctx, manifest, opts),
  });

  return {
    db,
    bus,
    logger,
    records,
    activity,
    comments,
    documents,
    tasks,
    files,
    assets,
    metadata,
    modules,
    events,
    workflows,
    connections,
    variables,
    webhookEvents,
    kv,
    notifications,
    permissions: { authorize, can },
    workspaces,
    close: () => bus.close(),
  };
};

export * from './actions';
export type { ActivityService } from './activity/service';
export type { AssetCreateInput, AssetService } from './assets/service';
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
export type { ImageInfo, ImageProcessor } from './files/images';
export * from './files/local-store';
export type {
  FileFacts,
  FileOwner,
  FileService,
  FileSweepResult,
  FileUsage,
  OpenedFile,
  WrittenFile,
} from './files/service';
export * from './files/store';
export * from './files/urls';
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
export { KV_VALUE_MAX_BYTES, type KvService } from './modules/kv';
export * from './modules/reconcile';
export { createSecretBox, deriveKey, isSealed, type SecretBox } from './modules/secret-box';
export type { VariablesService } from './modules/variables';
export type { IncomingEvent, WebhookEventsService } from './modules/webhook-events';
export {
  createNotificationService,
  type NotificationSendInput,
  type NotificationService,
  type NotificationServiceDeps,
} from './notifications/service';
export * from './permissions/policy';
export * from './query/validate';
export type { RecordCommentService } from './record-comments/service';
export { BATCH_MAX, type BatchInput, type BatchResult, type RecordService } from './records/service';
export * from './scoped';
export type { AssigneePort, TaskService } from './tasks/service';
export {
  type FinishedRun,
  type HeldRun,
  nextScheduledRun,
  type RunAdvance,
  type RunDraft,
  type RunOutcome,
  type RunProgress,
  validateWorkflow,
  type WorkflowService,
} from './workflows/service';
export type { WorkspaceService } from './workspace/init';
