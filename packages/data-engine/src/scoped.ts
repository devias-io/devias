import type {
  Actor,
  AggregateQuery,
  AggregateResult,
  Document,
  DocumentAppend,
  DocumentInput,
  DocumentPage,
  DocumentPatch,
  DocumentQuery,
  LookupHit,
  LookupInput,
  Page,
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
  WorkspaceSchema,
} from '@devias/core';
import type { EngineContext } from './context';
import type { DataEngine } from './index';

/** Engine methods pre-bound to one caller context; what module functions receive. */
export interface ScopedEngine {
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly context: EngineContext;
  records: {
    list(query: Query): Promise<Page>;
    get(object: string, id: string): Promise<RecordData>;
    create(object: string, data: Record<string, unknown>): Promise<RecordData>;
    update(object: string, id: string, patch: Record<string, unknown>): Promise<RecordData>;
    delete(object: string, ids: string[]): Promise<void>;
    /** Update the record whose unique field `match` names, or create one: syncing by an outside id. */
    upsert(
      object: string,
      match: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ record: RecordData; created: boolean }>;
    lookup(input: LookupInput): Promise<LookupHit[]>;
    /** Count, sum, average, min or max over the records that match, grouped by one field or as one total. */
    aggregate(query: AggregateQuery): Promise<AggregateResult>;
  };
  documents: {
    list(query?: DocumentQuery): Promise<DocumentPage>;
    get(id: string): Promise<Document>;
    create(input: DocumentInput): Promise<Document>;
    update(id: string, patch: DocumentPatch): Promise<Document>;
    append(id: string, input: DocumentAppend): Promise<Document>;
    delete(id: string): Promise<void>;
  };
  tasks: {
    list(query?: TaskQuery): Promise<TaskPage>;
    get(id: string): Promise<Task>;
    create(input: TaskInput): Promise<Task>;
    update(id: string, patch: TaskPatch): Promise<Task>;
    delete(id: string): Promise<void>;
    activity(id: string, query?: TaskActivityQuery): Promise<TaskActivityPage>;
    comment(id: string, input: TaskComment): Promise<TaskActivityEntry>;
    counts(query?: TaskCountsQuery): Promise<TaskCounts>;
  };
  metadata: {
    getSchema(): Promise<WorkspaceSchema>;
  };
}

export const scopeEngine = (engine: DataEngine, ctx: EngineContext): ScopedEngine => ({
  workspaceId: ctx.workspaceId,
  actor: ctx.actor,
  context: ctx,
  records: {
    list: (query) => engine.records.list(ctx, query),
    get: (object, id) => engine.records.get(ctx, object, id),
    create: (object, data) => engine.records.create(ctx, object, data),
    update: (object, id, patch) => engine.records.update(ctx, object, id, patch),
    delete: (object, ids) => engine.records.delete(ctx, object, ids),
    upsert: (object, match, values) => engine.records.upsert(ctx, object, match, values),
    lookup: (input) => engine.records.lookup(ctx, input),
    aggregate: (query) => engine.records.aggregate(ctx, query),
  },
  documents: {
    list: (query) => engine.documents.list(ctx, query),
    get: (id) => engine.documents.get(ctx, id),
    create: (input) => engine.documents.create(ctx, input),
    update: (id, patch) => engine.documents.update(ctx, id, patch),
    append: (id, input) => engine.documents.append(ctx, id, input),
    delete: (id) => engine.documents.delete(ctx, id),
  },
  tasks: {
    list: (query) => engine.tasks.list(ctx, query),
    get: (id) => engine.tasks.get(ctx, id),
    create: (input) => engine.tasks.create(ctx, input),
    update: (id, patch) => engine.tasks.update(ctx, id, patch),
    delete: (id) => engine.tasks.delete(ctx, id),
    activity: (id, query) => engine.tasks.activity(ctx, id, query),
    comment: (id, input) => engine.tasks.comment(ctx, id, input),
    counts: (query) => engine.tasks.counts(ctx, query),
  },
  metadata: {
    getSchema: () => engine.metadata.getSchema(ctx),
  },
});
