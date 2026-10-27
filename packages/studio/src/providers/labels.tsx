import {
  type DeviasClient,
  DOCUMENT_MENTION,
  DOCUMENTS_MAX_LIMIT,
  type FieldMetadata,
  type ObjectMetadata,
  primaryFieldOf,
  type RecordData,
  TASK_MENTION,
  TASKS_MAX_LIMIT,
} from '@devias/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useClient } from './client';
import { useSchema } from './schema';

/** Text shown for a record: its label field, falling back to the id. */
export const recordLabel = (record: RecordData, primaryField: FieldMetadata | undefined): string => {
  const value = primaryField ? record[primaryField.name] : undefined;

  if (value === null || value === undefined || value === '') {
    return record.id;
  }

  return typeof value === 'string' ? value : String(value);
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
};

/** Loads the labels of some ids: what a label resolver asks for in one batch. */
export type LabelLoader = (ids: string[]) => Promise<Record<string, string>>;

/**
 * Dataloader-style label resolver: many cells ask for labels in the same tick, one batch is loaded per resolver (one
 * `in` query for an object's records, one list call for documents). Labels are cached until live updates invalidate
 * them.
 */
export class LabelResolver {
  private readonly cache = new Map<string, string>();
  private queue = new Set<string>();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly loader: LabelLoader,
    private readonly labelOf: (record: RecordData) => string = (record) => record.id,
  ) {}

  /** The labels of an object's records, loaded with an `in` query on its API name. */
  static forObject(client: DeviasClient, object: ObjectMetadata, primaryField: FieldMetadata | undefined) {
    return new LabelResolver(
      async (ids) => {
        const page = await client.records.list({
          object: object.nameSingular,
          filter: { field: 'id', op: 'in', value: ids },
          limit: 200,
        });

        return Object.fromEntries(page.items.map((record) => [record.id, recordLabel(record, primaryField)]));
      },
      (record) => recordLabel(record, primaryField),
    );
  }

  /** The titles of documents. */
  static forDocuments(client: DeviasClient) {
    return new LabelResolver(async (ids) => {
      const page = await client.documents.list({ ids: ids.join(','), limit: DOCUMENTS_MAX_LIMIT });

      return Object.fromEntries(page.items.map((document) => [document.id, document.title]));
    });
  }

  /** The titles of tasks. */
  static forTasks(client: DeviasClient) {
    return new LabelResolver(async (ids) => {
      const page = await client.tasks.list({ ids: ids.join(','), limit: TASKS_MAX_LIMIT });

      return Object.fromEntries(page.items.map((task) => [task.id, task.title]));
    });
  }

  seed(records: RecordData[]): void {
    for (const record of records) {
      this.cache.set(record.id, this.labelOf(record));
    }
  }

  invalidate(ids?: string[]): void {
    if (!ids) {
      this.cache.clear();
    } else {
      for (const id of ids) {
        this.cache.delete(id);
      }
    }
  }

  peek(id: string): string | undefined {
    return this.cache.get(id);
  }

  async load(ids: readonly string[]): Promise<Record<string, string>> {
    const missing = ids.filter((id) => !this.cache.has(id));

    if (missing.length > 0) {
      await this.enqueue(missing);
    }

    const out: Record<string, string> = {};

    for (const id of ids) {
      out[id] = this.cache.get(id) ?? id;
    }

    return out;
  }

  private enqueue(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.queue.add(id);
    }

    if (!this.flushing) {
      this.flushing = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => this.flush());
    }

    return this.flushing;
  }

  private async flush(): Promise<void> {
    const ids = [...this.queue];
    this.queue = new Set();
    this.flushing = null;

    for (const batch of chunk(ids, 100)) {
      try {
        for (const [id, label] of Object.entries(await this.loader(batch))) {
          this.cache.set(id, label);
        }
      } catch {
        // leave ids unresolved; the query layer will retry on the next request
      }

      for (const id of batch) {
        if (!this.cache.has(id)) {
          this.cache.set(id, id);
        }
      }
    }
  }
}

export interface LabelsContextValue {
  /** Resolver for an object by `nameSingular` or id; undefined for unknown objects. */
  get: (object: string) => LabelResolver | undefined;
  invalidate: (object: string, ids?: string[]) => void;
}

const LabelsContext = createContext<LabelsContextValue | null>(null);

export function LabelsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { index } = useSchema();
  const value = useMemo<LabelsContextValue>(() => {
    const resolvers = new Map<string, LabelResolver>();
    const get = (name: string) => {
      // Documents and tasks are not objects: their titles come from their own lists.
      if (name === DOCUMENT_MENTION) {
        let resolver = resolvers.get(DOCUMENT_MENTION);

        if (!resolver) {
          resolver = LabelResolver.forDocuments(client);
          resolvers.set(DOCUMENT_MENTION, resolver);
        }

        return resolver;
      }

      if (name === TASK_MENTION) {
        let resolver = resolvers.get(TASK_MENTION);

        if (!resolver) {
          resolver = LabelResolver.forTasks(client);
          resolvers.set(TASK_MENTION, resolver);
        }

        return resolver;
      }

      const object = index.objectsByName.get(name) ?? index.objectsById.get(name);

      if (!object) {
        return undefined;
      }

      let resolver = resolvers.get(object.id);

      if (!resolver) {
        resolver = LabelResolver.forObject(client, object, primaryFieldOf(index, object));
        resolvers.set(object.id, resolver);
      }

      return resolver;
    };

    return { get, invalidate: (object, ids) => get(object)?.invalidate(ids) };
  }, [client, index]);

  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>;
}

export const useLabels = (): LabelsContextValue => {
  const value = useContext(LabelsContext);

  if (!value) {
    throw new Error('useLabels must be used inside a workspace route');
  }

  return value;
};
