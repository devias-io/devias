import {
  type ActivityEntry,
  type Actor,
  type Asset,
  type CommandItem,
  type Connection,
  type Document,
  type DocumentActivityEntry,
  type DocumentComment,
  type FieldMetadata,
  type InstalledModule,
  indexSchema,
  type Layout,
  type MemberRole,
  type ModuleManifest,
  type NavItem,
  type Notification,
  newId,
  type ObjectMetadata,
  personOf,
  type RecordComment,
  type RecordData,
  type SchemaIndex,
  type Task,
  type TaskActivityEntry,
  type ViewMetadata,
  type WebhookEvent,
  type Workflow,
  type WorkflowRun,
  type WorkspaceEvent,
  type WorkspaceSchema,
} from '@devias/core';

/**
 * In-memory workspace: metadata rows, records per object, the event log and subscribers. The mock
 * client, the reconciler and the seed helpers all operate on this one object, which is exposed as
 * `client.store` so tests and dev tools can inspect or tweak state directly.
 */

export interface StoredRecord extends RecordData {
  /** Soft-deleted records stay in the map (so ids stay unique) but are invisible to reads. */
  deleted_at?: string | null;
}

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event minus the envelope the store fills in (`sequence`, `workspaceId`, `actor`, `occurredAt`). */
export type MockEventInput = DistributiveOmit<WorkspaceEvent, 'sequence' | 'workspaceId' | 'actor' | 'occurredAt'>;

/** One entry of a record's activity. Seeded history has sequence 0: it predates the live event feed. */
export interface MockActivityRow {
  objectId: string;
  recordId: string;
  entry: ActivityEntry;
}

/** A comment on a record. Removed comments stay (ids stay unique) but drop out of the lists. */
export interface MockRecordComment extends RecordComment {
  objectId: string;
  deleted?: boolean;
}

/** A document. Removed documents stay (ids stay unique) but drop out of every read. */
export interface MockDocument extends Omit<Document, 'markdown'> {
  deleted?: boolean;
}

/** A file, with its bytes. Removed files stay (ids stay unique) but drop out of every read. Bytes are not part of snapshots. */
export interface MockAsset extends Omit<Asset, 'url'> {
  bytes: Uint8Array;
  deleted?: boolean;
}

/** A task, with the parts a read does not show: its rank in the tree and the links it indexes. Removed tasks stay. */
export interface MockTask extends Omit<Task, 'markdown' | 'subtasks'> {
  depth: number;
  key?: string;
  deleted?: boolean;
}

export type MockDocumentComment = DocumentComment & { deleted?: boolean };

export type MockActivityInput = DistributiveOmit<ActivityEntry, 'id' | 'sequence' | 'actor' | 'occurredAt'>;

/** A member of the mock workspace, as notification audiences resolve against them. */
export interface MockMember {
  /** The user id: what `to.users` names and `recipientId` carries. */
  id: string;
  role: MemberRole;
}

export interface MockSnapshot {
  workspaceId: string;
  version: number;
  objects: ObjectMetadata[];
  fields: FieldMetadata[];
  views: ViewMetadata[];
  layouts: Layout[];
  navItems: NavItem[];
  commandItems: CommandItem[];
  modules: InstalledModule[];
  records: Record<string, StoredRecord[]>;
  events: WorkspaceEvent[];
  /** Missing in snapshots saved before activity existed. */
  activity?: MockActivityRow[];
  /** Missing in snapshots saved before workflows existed. */
  workflows?: Workflow[];
  workflowRuns?: WorkflowRun[];
  /** Missing in snapshots saved before module connections existed. */
  connections?: Connection[];
  moduleVariables?: { moduleId: string; values: Record<string, string> }[];
  webhookEvents?: WebhookEvent[];
  /** Missing in snapshots saved before notifications existed. */
  notifications?: Notification[];
  /** Missing in snapshots saved before documents existed. */
  documents?: MockDocument[];
  documentActivity?: DocumentActivityEntry[];
  documentComments?: MockDocumentComment[];
  /** Missing in snapshots saved before tasks existed. */
  tasks?: MockTask[];
  taskActivity?: TaskActivityEntry[];
}

export interface MockStoreOptions {
  workspaceId: string;
  /** Actor stamped on events and `createdBy`/`updatedBy`. */
  actor?: Actor;
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Id generator for rows and records (defaults to uuid v7). */
  newId?: () => string;
  /** The modules the mock server can install (`client.modules.catalog()`). */
  catalog?: ModuleManifest[];
  /** The workspace's members, who notifications go to (default: the person behind the actor, as owner). */
  members?: MockMember[];
}

export const DEFAULT_MOCK_ACTOR: Actor = { kind: 'user', id: 'user_dev' };

/** Without a members list the person behind the actor owns the workspace alone; keys and automations bring nobody. */
const defaultMembers = (actor: Actor): MockMember[] => {
  const person = personOf(actor);

  return person ? [{ id: person, role: 'owner' }] : [];
};

const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.position - b.position);

export class MockStore {
  readonly workspaceId: string;
  /** Monotonic metadata version, bumped on every metadata write. */
  version = 0;
  actor: Actor;
  now: () => string;
  newId: () => string;
  /** While true, writes append no events and notify nobody (used for seeding). */
  silent = false;
  /** Called after every write; the mock client hooks persistence here. */
  onChange: (() => void) | undefined;

  readonly objects = new Map<string, ObjectMetadata>();
  readonly fields = new Map<string, FieldMetadata>();
  readonly views = new Map<string, ViewMetadata>();
  readonly layouts = new Map<string, Layout>();
  readonly navItems = new Map<string, NavItem>();
  readonly commandItems = new Map<string, CommandItem>();
  readonly modules = new Map<string, InstalledModule>();
  /** objectId → recordId → record */
  readonly records = new Map<string, Map<string, StoredRecord>>();
  events: WorkspaceEvent[] = [];
  /** Every record's history, oldest first. */
  activity: MockActivityRow[] = [];
  /** Every record's comments, in the order they were written. */
  comments: MockRecordComment[] = [];
  /** Every document, in the order they were made. */
  documents: MockDocument[] = [];
  /** The timelines of all documents, oldest first. */
  documentActivity: DocumentActivityEntry[] = [];
  /** Every comment on every document, in the order they were written; removed ones stay out of every read. */
  documentComments: MockDocumentComment[] = [];
  /** Every file, in the order they were made; the mock keeps their bytes in memory only. */
  assets: MockAsset[] = [];
  /** Every task, in the order they were made, and the timelines of all of them, oldest first. */
  tasks: MockTask[] = [];
  taskActivity: TaskActivityEntry[] = [];
  /** Workflows by id, and every run, oldest first. */
  readonly workflows = new Map<string, Workflow>();
  workflowRuns: WorkflowRun[] = [];
  /**
   * Connections by id (masked hints only: the mock never keeps credentials), workspace variables by module id, the
   * events modules delivered oldest first, and the installable catalog.
   */
  readonly connections = new Map<string, Connection>();
  readonly moduleVariables = new Map<string, Record<string, string>>();
  webhookEvents: WebhookEvent[] = [];
  catalog: ModuleManifest[];
  /** Everyone's notifications, newest last. */
  notifications: Notification[] = [];
  /** Who notification audiences resolve to; configuration like the catalog, so not part of snapshots. */
  members: MockMember[];

  private readonly subscribers = new Set<(event: WorkspaceEvent) => void>();
  private stamp = 0;
  private cachedIndex: { stamp: number; index: SchemaIndex } | undefined;

  constructor(options: MockStoreOptions) {
    this.workspaceId = options.workspaceId;
    this.actor = options.actor ?? DEFAULT_MOCK_ACTOR;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? newId;
    this.catalog = options.catalog ?? [];
    this.members = options.members ?? defaultMembers(this.actor);
  }

  /** Invalidate the cached schema index after mutating metadata maps directly. */
  touch(): void {
    this.stamp += 1;
  }

  bumpVersion(): number {
    this.version += 1;
    this.touch();

    return this.version;
  }

  schema(): WorkspaceSchema {
    return {
      workspaceId: this.workspaceId,
      version: this.version,
      objects: [...this.objects.values()],
      fields: byPosition([...this.fields.values()]),
      views: byPosition([...this.views.values()]),
      layouts: [...this.layouts.values()],
      navItems: byPosition([...this.navItems.values()]),
      commandItems: [...this.commandItems.values()],
      modules: [...this.modules.values()],
    };
  }

  /** `indexSchema` of the current state, rebuilt lazily after `touch()`/`bumpVersion()`. */
  index(): SchemaIndex {
    if (!this.cachedIndex || this.cachedIndex.stamp !== this.stamp) {
      this.cachedIndex = { stamp: this.stamp, index: indexSchema(this.schema()) };
    }

    return this.cachedIndex.index;
  }

  objectByName(name: string): ObjectMetadata | undefined {
    for (const object of this.objects.values()) {
      if (object.nameSingular === name) {
        return object;
      }
    }

    return undefined;
  }

  objectById(id: string): ObjectMetadata | undefined {
    for (const object of this.objects.values()) {
      if (object.id === id) {
        return object;
      }
    }

    return undefined;
  }

  fieldsOf(objectId: string): FieldMetadata[] {
    return byPosition([...this.fields.values()].filter((field) => field.objectId === objectId));
  }

  fieldById(id: string): FieldMetadata | undefined {
    for (const field of this.fields.values()) {
      if (field.id === id) {
        return field;
      }
    }

    return undefined;
  }

  recordsOf(objectId: string): Map<string, StoredRecord> {
    let map = this.records.get(objectId);

    if (!map) {
      map = new Map();
      this.records.set(objectId, map);
    }

    return map;
  }

  liveRecords(objectId: string): StoredRecord[] {
    return [...this.recordsOf(objectId).values()].filter((record) => !record.deleted_at);
  }

  liveRecord(objectId: string, id: string): StoredRecord | undefined {
    const record = this.recordsOf(objectId).get(id);

    return record && !record.deleted_at ? record : undefined;
  }

  /** Append an event with the next dense sequence number and notify subscribers (asynchronously). */
  emit(input: MockEventInput): WorkspaceEvent | undefined {
    if (this.silent) {
      return undefined;
    }

    const event = {
      ...input,
      sequence: this.events.length + 1,
      workspaceId: this.workspaceId,
      actor: this.actor,
      occurredAt: this.now(),
    } as WorkspaceEvent;
    this.events.push(event);

    for (const subscriber of this.subscribers) {
      queueMicrotask(() => subscriber(event));
    }

    this.onChange?.();

    return event;
  }

  /** Add to the activity of the record `event` is about, stamped like the event. No-op for silent writes. */
  track(event: WorkspaceEvent | undefined, input: MockActivityInput): void {
    if (!event || !('recordId' in event)) {
      return;
    }

    const entry = {
      ...input,
      id: String(event.sequence),
      sequence: event.sequence,
      actor: event.actor,
      occurredAt: event.occurredAt,
    } as ActivityEntry;
    this.activity.push({ objectId: event.objectId, recordId: event.recordId, entry });
  }

  /** Signal a write that produced no event (persistence hook). */
  changed(): void {
    if (!this.silent) {
      this.onChange?.();
    }
  }

  /** Deliver events with `sequence > after` (when given) and then every new event, in order. */
  subscribe(handler: (event: WorkspaceEvent) => void, after?: number): () => void {
    let active = true;
    const wrapped = (event: WorkspaceEvent) => {
      if (active) {
        handler(event);
      }
    };
    this.subscribers.add(wrapped);

    if (after !== undefined) {
      const missed = this.events.filter((event) => event.sequence > after);

      if (missed.length > 0) {
        queueMicrotask(() => {
          for (const event of missed) {
            if (active) {
              handler(event);
            }
          }
        });
      }
    }

    return () => {
      active = false;
      this.subscribers.delete(wrapped);
    };
  }

  snapshot(): MockSnapshot {
    const records: Record<string, StoredRecord[]> = {};

    for (const [objectId, map] of this.records) {
      records[objectId] = [...map.values()];
    }

    return structuredClone({
      workspaceId: this.workspaceId,
      version: this.version,
      objects: [...this.objects.values()],
      fields: [...this.fields.values()],
      views: [...this.views.values()],
      layouts: [...this.layouts.values()],
      navItems: [...this.navItems.values()],
      commandItems: [...this.commandItems.values()],
      modules: [...this.modules.values()],
      records,
      events: this.events,
      activity: this.activity,
      workflows: [...this.workflows.values()],
      workflowRuns: this.workflowRuns,
      connections: [...this.connections.values()],
      moduleVariables: [...this.moduleVariables.entries()].map(([moduleId, values]) => ({ moduleId, values })),
      webhookEvents: this.webhookEvents,
      notifications: this.notifications,
      documents: this.documents,
      documentActivity: this.documentActivity,
      documentComments: this.documentComments,
      tasks: this.tasks,
      taskActivity: this.taskActivity,
    });
  }

  restore(input: MockSnapshot): void {
    const snapshot = structuredClone(input);
    this.clear();
    this.version = snapshot.version;

    for (const row of snapshot.objects) {
      this.objects.set(row.id, row);
    }

    for (const row of snapshot.fields) {
      this.fields.set(row.id, row);
    }

    for (const row of snapshot.views) {
      this.views.set(row.id, row);
    }

    for (const row of snapshot.layouts) {
      this.layouts.set(row.id, row);
    }

    for (const row of snapshot.navItems) {
      this.navItems.set(row.id, row);
    }

    for (const row of snapshot.commandItems) {
      this.commandItems.set(row.id, row);
    }

    for (const row of snapshot.modules) {
      this.modules.set(row.id, row);
    }

    for (const [objectId, rows] of Object.entries(snapshot.records)) {
      this.records.set(objectId, new Map(rows.map((row) => [row.id, row])));
    }

    this.events = snapshot.events;
    this.activity = snapshot.activity ?? [];

    for (const row of snapshot.workflows ?? []) {
      this.workflows.set(row.id, row);
    }

    this.workflowRuns = snapshot.workflowRuns ?? [];

    for (const row of snapshot.connections ?? []) {
      this.connections.set(row.id, row);
    }

    for (const row of snapshot.moduleVariables ?? []) {
      this.moduleVariables.set(row.moduleId, row.values);
    }

    this.webhookEvents = snapshot.webhookEvents ?? [];
    this.notifications = snapshot.notifications ?? [];
    this.documents = snapshot.documents ?? [];
    this.documentActivity = snapshot.documentActivity ?? [];
    this.documentComments = snapshot.documentComments ?? [];
    this.tasks = snapshot.tasks ?? [];
    this.taskActivity = snapshot.taskActivity ?? [];
    this.touch();
  }

  /** Drop every row, record and event (subscribers stay attached). */
  clear(): void {
    this.version = 0;

    for (const map of [
      this.objects,
      this.fields,
      this.views,
      this.layouts,
      this.navItems,
      this.commandItems,
      this.modules,
      this.records,
      this.workflows,
      this.connections,
      this.moduleVariables,
    ]) {
      map.clear();
    }

    this.events = [];
    this.activity = [];
    this.workflowRuns = [];
    this.webhookEvents = [];
    this.notifications = [];
    this.documents = [];
    this.documentActivity = [];
    this.documentComments = [];
    this.assets = [];
    this.tasks = [];
    this.taskActivity = [];
    this.touch();
  }
}
