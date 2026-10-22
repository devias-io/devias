import {
  type AggregateResult,
  BATCH_MAX,
  cascadeRelationsOf,
  type FieldMetadata,
  finishGroups,
  type ImportBody,
  type ImportReport,
  isDeletable,
  type LookupHit,
  type LookupInput,
  measureKey,
  newId,
  type ObjectMetadata,
  type Page,
  primaryFieldOf,
  type Query,
  type RecordData,
  type SchemaIndex,
  stableStringify,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorString, type EngineContext } from '../context';
import type { DataSource, StoredRecord } from '../datasource/interface';
import { toRecordData } from '../datasource/interface';
import { type Db, runRaw } from '../db/exec';
import { EngineError, fromZodError, isEngineError, notFound, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, type EventRow, lockWorkspace, writeEvents } from '../events/feed';
import { RecordSchemaCache } from '../metadata/record-schema';
import type { MetadataService } from '../metadata/service';
import { relationTargetOf } from '../metadata/store';
import { authorize, can } from '../permissions/policy';
import { resolveObject, validateAggregate, validateQuery } from '../query/validate';
import { type MemberDirectory, runImport } from './import';

export { BATCH_MAX };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BatchInput {
  create?: Record<string, unknown>[];
  update?: { id: string; patch: Record<string, unknown> }[];
  delete?: string[];
}

export interface BatchResult {
  created: RecordData[];
  updated: RecordData[];
  deleted: string[];
}

export interface RecordService {
  list(ctx: EngineContext, query: Query): Promise<Page>;
  get(ctx: EngineContext, object: string, id: string): Promise<RecordData>;
  create(ctx: EngineContext, object: string, data: Record<string, unknown>): Promise<RecordData>;
  update(ctx: EngineContext, object: string, id: string, patch: Record<string, unknown>): Promise<RecordData>;
  delete(ctx: EngineContext, object: string, ids: string[]): Promise<void>;
  /**
   * Update the record whose unique field has the value `match` names, or create one with `values` and the match.
   * Two writers racing on the same value end with one record: the loser updates what the winner created.
   */
  upsert(
    ctx: EngineContext,
    object: string,
    match: Record<string, unknown>,
    values: Record<string, unknown>,
  ): Promise<{ record: RecordData; created: boolean }>;
  batch(ctx: EngineContext, object: string, input: BatchInput, options?: { importId?: string }): Promise<BatchResult>;
  /**
   * Rows of a file, as text, read for one object: the valid ones are created (or updated, matching on a unique field),
   * the rest are reported by row. At most `BATCH_MAX` rows; `dryRun` writes nothing.
   */
  import(ctx: EngineContext, object: string, input: ImportBody): Promise<ImportReport>;
  /** Where a cell naming a member is looked up: the server's directory. Until it is bound a member cell is a user id. */
  bindMembers(directory: MemberDirectory): void;
  lookup(ctx: EngineContext, input: LookupInput): Promise<LookupHit[]>;
  /** Counts and measures over an object's records, per group or in total (see `AggregateQuerySchema`). */
  aggregate(ctx: EngineContext, input: unknown): Promise<AggregateResult>;
}

export interface RecordServiceDeps {
  db: Db;
  metadata: MetadataService;
  dataSource: DataSource;
  bus: EventBus;
  clock: () => Date;
}

const parseOrThrow = (schema: z.ZodType<Record<string, unknown>>, input: unknown, where: string) => {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw fromZodError(result.error, `Invalid record data (${where})`);
  }

  return result.data;
};

const assertUuid = (id: string, where: string) => {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw validationError(`Invalid record id "${id}" (${where})`, { id });
  }
};

const same = (a: unknown, b: unknown): boolean => stableStringify(a ?? null) === stableStringify(b ?? null);

const pickKeys = (data: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, data[k] === undefined ? null : data[k]]));

export const createRecordService = (deps: RecordServiceDeps): RecordService => {
  const { db, metadata, dataSource, bus, clock } = deps;
  const schemaCache = new RecordSchemaCache();
  let memberDirectory: MemberDirectory | undefined;

  const resolve = async (ctx: EngineContext, objectName: string) => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);
    const object = resolveObject(snapshot.index, objectName);
    const fields = snapshot.index.fieldsByObjectId.get(object.id) ?? [];

    return { snapshot, object, fields };
  };

  /** Every relation value must point at a live record of the target object (batched per target). */
  const validateRelations = async (
    tx: Db,
    workspaceId: string,
    index: SchemaIndex,
    fields: FieldMetadata[],
    payloads: Record<string, unknown>[],
  ) => {
    const relations = fields.filter((f) => f.type === 'relation');

    if (relations.length === 0) {
      return;
    }

    const wanted = new Map<string, { object: ObjectMetadata; ids: Set<string>; field: FieldMetadata }>();

    for (const payload of payloads) {
      for (const field of relations) {
        const value = payload[field.name];

        if (value === null || value === undefined) {
          continue;
        }

        if (typeof value !== 'string' || !UUID.test(value)) {
          throw validationError(`Field "${field.name}" expects a record id`, { field: field.name, id: value });
        }

        const targetUid = relationTargetOf(field.settings);
        const target = targetUid ? index.objectsById.get(targetUid) : undefined;

        if (!target) {
          throw validationError(`Relation field "${field.name}" has no valid target object`, { field: field.name });
        }

        const entry = wanted.get(target.id) ?? { object: target, ids: new Set<string>(), field };
        entry.ids.add(value);
        wanted.set(target.id, entry);
      }
    }

    for (const { object, ids, field } of wanted.values()) {
      const existing = await dataSource.existingIds(tx, workspaceId, object.id, [...ids]);

      for (const id of ids) {
        if (!existing.has(id)) {
          throw validationError(`Related ${object.labelSingular} "${id}" not found for field "${field.name}"`, {
            field: field.name,
            id,
          });
        }
      }
    }
  };

  /**
   * The records that go with `ids` when they are deleted: those whose relation field says `onDelete: cascade` and
   * points at them, and, in turn, those that point at those. The cascaded records' own delete rules do not apply:
   * the rule that matters is the one of the record being deleted.
   */
  const cascadeOf = async (
    tx: Db,
    workspaceId: string,
    index: SchemaIndex,
    root: ObjectMetadata,
    ids: string[],
  ): Promise<{ object: ObjectMetadata; fields: FieldMetadata[]; rows: StoredRecord[] }[]> => {
    const found: { object: ObjectMetadata; fields: FieldMetadata[]; rows: StoredRecord[] }[] = [];
    const seen = new Set(ids);
    let frontier = [{ object: root, ids }];

    while (frontier.length > 0) {
      const next: typeof frontier = [];

      for (const level of frontier) {
        for (const { object, field } of cascadeRelationsOf(index, level.object)) {
          const rows = (await dataSource.getReferencing(tx, workspaceId, object, field.name, level.ids)).filter(
            (row) => !seen.has(row.id),
          );

          if (rows.length === 0) {
            continue;
          }

          for (const row of rows) {
            seen.add(row.id);
          }

          found.push({ object, fields: index.fieldsByObjectId.get(object.id) ?? [], rows });
          next.push({ object, ids: rows.map((row) => row.id) });
        }
      }

      frontier = next;
    }

    return found;
  };

  const batch = async (
    ctx: EngineContext,
    objectName: string,
    input: BatchInput,
    options: { importId?: string } = {},
  ): Promise<BatchResult> => {
    const { snapshot, object, fields } = await resolve(ctx, objectName);
    authorize(ctx, 'record.write', { object });
    const creates = input.create ?? [];
    const updates = input.update ?? [];
    const deletes = [...new Set(input.delete ?? [])];
    const total = creates.length + updates.length + deletes.length;

    if (total === 0) {
      return { created: [], updated: [], deleted: [] };
    }

    if (total > BATCH_MAX) {
      throw validationError(`A batch may contain at most ${BATCH_MAX} operations`, { total });
    }

    const schemas = schemaCache.get(object.id, snapshot.version, fields);
    const createRows = creates.map((data, i) => ({
      id: newId(),
      data: parseOrThrow(schemas.create, data, `create[${i}]`),
    }));
    const updateInputs = updates.map((u, i) => {
      assertUuid(u.id, `update[${i}]`);

      return { id: u.id, patch: parseOrThrow(schemas.update, u.patch, `update[${i}]`) };
    });

    for (const [i, id] of deletes.entries()) {
      assertUuid(id, `delete[${i}]`);
    }

    const now = clock();
    const meta = { actor: actorString(ctx.actor), now };
    const workspaceId = ctx.workspaceId;

    const result = await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      await validateRelations(tx, workspaceId, snapshot.index, fields, [
        ...createRows.map((r) => r.data),
        ...updateInputs.map((u) => u.patch),
      ]);

      const currentUpdates = await dataSource.getMany(
        tx,
        workspaceId,
        object,
        updateInputs.map((u) => u.id),
      );
      const currentById = new Map(currentUpdates.map((r) => [r.id, r]));
      const plannedUpdates: { current: StoredRecord; data: Record<string, unknown>; changed: string[] }[] = [];
      const unchanged: StoredRecord[] = [];

      for (const u of updateInputs) {
        const current = currentById.get(u.id);

        if (!current) {
          throw notFound(object.labelSingular, u.id);
        }

        const changed = Object.keys(u.patch).filter((k) => !same(current.data[k], u.patch[k]));

        if (changed.length === 0) {
          unchanged.push(current);
          continue;
        }

        plannedUpdates.push({ current, data: { ...current.data, ...u.patch }, changed });
      }

      const currentDeletes = await dataSource.getMany(tx, workspaceId, object, deletes);
      const deleteById = new Map(currentDeletes.map((r) => [r.id, r]));

      for (const id of deletes) {
        if (!deleteById.has(id)) {
          throw notFound(object.labelSingular, id);
        }
      }

      // The object's own rule says which records may be deleted, for the studio, the API and the agent alike.
      for (const row of currentDeletes) {
        if (!isDeletable(object, row.data)) {
          throw new EngineError(
            'CONFLICT',
            `${object.labelSingular} "${row.id}" cannot be deleted in its current state (the object's delete rule)`,
            { id: row.id, deleteWhen: object.deleteWhen },
          );
        }
      }

      const cascaded = await cascadeOf(
        tx,
        workspaceId,
        snapshot.index,
        object,
        currentDeletes.map((row) => row.id),
      );
      const cascadedCount = cascaded.reduce((sum, level) => sum + level.rows.length, 0);
      const eventCount = createRows.length + plannedUpdates.length + currentDeletes.length + cascadedCount;
      let sequence = eventCount > 0 ? await allocateSequences(tx, workspaceId, eventCount) : 0;
      const events: EventRow[] = [];
      const base = { actor: ctx.actor, occurredAt: now, objectId: object.id, objectName: object.nameSingular };
      // The records an import wrote say so in their events, so what follows them can tell a data load from a business event.
      const via = options.importId ? { payload: { importId: options.importId } } : {};

      const inserted = await dataSource.insert(tx, workspaceId, object, fields, createRows, meta);

      for (const row of inserted) {
        events.push({
          ...base,
          sequence: sequence++,
          type: 'record.created',
          recordId: row.id,
          changedFields: Object.keys(row.data),
          diff: { before: null, after: row.data },
          ...via,
        });
      }

      const updated: StoredRecord[] = [];

      for (const planned of plannedUpdates) {
        const row = await dataSource.update(tx, workspaceId, object, fields, planned.current, planned.data, meta);
        updated.push(row);
        events.push({
          ...base,
          sequence: sequence++,
          type: 'record.updated',
          recordId: row.id,
          changedFields: planned.changed,
          diff: {
            before: pickKeys(planned.current.data, planned.changed),
            after: pickKeys(planned.data, planned.changed),
          },
          ...via,
        });
      }

      const deletedIds = await dataSource.softDelete(
        tx,
        workspaceId,
        object,
        currentDeletes.map((r) => r.id),
        meta,
      );

      const cascadedDeletes: { object: ObjectMetadata; before: Map<string, StoredRecord>; ids: string[] }[] = [];

      for (const level of cascaded) {
        const ids = await dataSource.softDelete(
          tx,
          workspaceId,
          level.object,
          level.rows.map((row) => row.id),
          meta,
        );
        cascadedDeletes.push({ object: level.object, before: new Map(level.rows.map((row) => [row.id, row])), ids });
      }

      const allDeletedIds = [...deletedIds, ...cascadedDeletes.flatMap((level) => level.ids)];

      // A record's notes go with it; the record's history stays in the event log.
      if (allDeletedIds.length > 0) {
        await runRaw(
          tx,
          sql`UPDATE comment SET deleted_at = ${now.toISOString()}::timestamptz
            WHERE workspace_id = ${workspaceId} AND entity_kind = 'record' AND deleted_at IS NULL
              AND entity_id IN (${sql.join(
                allDeletedIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
        );
      }

      for (const id of deletedIds) {
        events.push({
          ...base,
          sequence: sequence++,
          type: 'record.deleted',
          recordId: id,
          diff: { before: deleteById.get(id)?.data ?? null, after: null },
        });
      }

      for (const level of cascadedDeletes) {
        for (const id of level.ids) {
          events.push({
            ...base,
            objectId: level.object.id,
            objectName: level.object.nameSingular,
            sequence: sequence++,
            type: 'record.deleted',
            recordId: id,
            diff: { before: level.before.get(id)?.data ?? null, after: null },
          });
        }
      }

      await writeEvents(tx, workspaceId, events);
      const lastSequence = sequence - 1;

      if (events.length > 0) {
        await bus.publish(tx, workspaceId, { seq: lastSequence });
      }

      // keep the caller's order for updates, including unchanged rows
      const updatedById = new Map([...updated, ...unchanged].map((r) => [r.id, r]));

      return {
        created: inserted.map((r) => toRecordData(r, fields)),
        updated: updateInputs.map((u) => toRecordData(updatedById.get(u.id) as StoredRecord, fields)),
        deleted: deletedIds,
        lastSequence,
        eventCount: events.length,
      };
    });

    if (result.eventCount > 0) {
      bus.emitLocal(workspaceId, { seq: result.lastSequence });
    }

    return { created: result.created, updated: result.updated, deleted: result.deleted };
  };

  const get = async (ctx: EngineContext, objectName: string, id: string): Promise<RecordData> => {
    const { object, fields } = await resolve(ctx, objectName);
    authorize(ctx, 'record.read', { object });
    assertUuid(id, 'get');
    const rows = await dataSource.getMany(db, ctx.workspaceId, object, [id]);
    const row = rows[0];

    if (!row) {
      throw notFound(object.labelSingular, id);
    }

    return toRecordData(row, fields);
  };

  const lookup = async (ctx: EngineContext, input: LookupInput): Promise<LookupHit[]> => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);
    const limit = input.limit ?? 20;
    // Named objects must all be readable; otherwise the search covers the ones the caller may read (a module's role
    // may list a few).
    const named = input.objects?.map((name) => resolveObject(snapshot.index, name));

    for (const object of named ?? []) {
      authorize(ctx, 'record.read', { object });
    }

    const objects = named ?? snapshot.schema.objects.filter((object) => can(ctx, 'record.read', { object }));

    if (objects.length === 0) {
      authorize(ctx, 'record.read');
    }

    const hits: LookupHit[] = [];

    for (const object of objects) {
      if (hits.length >= limit) {
        break;
      }

      const primaryField = primaryFieldOf(snapshot.index, object);
      const validated = validateQuery(snapshot.index, {
        object: object.nameSingular,
        search: input.text,
        limit: limit - hits.length,
      });
      const page = await dataSource.query(db, ctx.workspaceId, snapshot.index, validated);

      for (const item of page.items) {
        const raw = primaryField ? item[primaryField.name] : undefined;
        hits.push({
          object: object.nameSingular,
          objectId: object.id,
          recordId: item.id,
          title: typeof raw === 'string' && raw ? raw : String(raw ?? item.id),
          subtitle: object.labelSingular,
        });
      }
    }

    return hits.slice(0, limit);
  };

  const aggregate = async (ctx: EngineContext, input: unknown): Promise<AggregateResult> => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);
    const validated = validateAggregate(snapshot.index, input);
    authorize(ctx, 'record.read', { object: validated.object });
    const keys = validated.measures.map(measureKey);
    const raw = await dataSource.aggregate(db, ctx.workspaceId, validated, keys);
    const groupBy = validated.groupBy;

    if (!groupBy) {
      return { object: validated.object.nameSingular, groupBy: null, groups: [], total: raw.total, truncated: false };
    }

    const finished = finishGroups(raw.groups, groupBy, validated.measures, validated.limit);
    const targetUid = groupBy.type === 'relation' ? relationTargetOf(groupBy.settings) : undefined;
    const target = targetUid ? snapshot.index.objectsById.get(targetUid) : undefined;

    if (target) {
      // Name each related record, so a group reads "Acme" rather than an id.
      const label = primaryFieldOf(snapshot.index, target);
      const ids = finished.groups.map((group) => group.key).filter((key): key is string => typeof key === 'string');
      const related = label ? await dataSource.getMany(db, ctx.workspaceId, target, ids) : [];
      const names = new Map(related.map((record) => [record.id, record.data[label?.name ?? '']]));

      for (const group of finished.groups) {
        const name = typeof group.key === 'string' ? names.get(group.key) : undefined;

        if (typeof name === 'string' && name !== '') {
          group.label = name;
        }
      }
    }

    return { object: validated.object.nameSingular, groupBy: groupBy.name, total: raw.total, ...finished };
  };

  return {
    aggregate,
    list: async (ctx, query) => {
      const snapshot = await metadata.getSnapshot(ctx.workspaceId);
      const validated = validateQuery(snapshot.index, query);
      authorize(ctx, 'record.read', { object: validated.object });

      return dataSource.query(db, ctx.workspaceId, snapshot.index, validated);
    },
    get,
    create: async (ctx, object, data) => {
      const result = await batch(ctx, object, { create: [data] });
      const created = result.created[0];

      if (!created) {
        throw new EngineError('INTERNAL', 'Create returned no record');
      }

      return created;
    },
    update: async (ctx, object, id, patch) => {
      const result = await batch(ctx, object, { update: [{ id, patch }] });
      const updated = result.updated[0];

      if (!updated) {
        throw new EngineError('INTERNAL', 'Update returned no record');
      }

      return updated;
    },
    delete: async (ctx, object, ids) => {
      await batch(ctx, object, { delete: ids });
    },
    upsert: async (ctx, objectName, match, values) => {
      const { snapshot, object, fields } = await resolve(ctx, objectName);
      authorize(ctx, 'record.write', { object });
      const entries = Object.entries(match ?? {});
      const [name, value] = entries[0] ?? [];

      if (entries.length !== 1 || name === undefined) {
        throw validationError('Match on exactly one unique field: { field: value }', { path: 'match' });
      }

      const field = fields.find((candidate) => candidate.name === name);

      if (!field) {
        throw validationError(`${object.labelSingular} has no field "${name}"`, { path: `match.${name}` });
      }

      if (!field.isUnique) {
        throw validationError(`"${name}" is not unique, so it cannot identify one ${object.labelSingular}`, {
          path: `match.${name}`,
        });
      }

      if (value === null || value === undefined || value === '') {
        throw validationError(`Give a value to match "${name}" on`, { path: `match.${name}` });
      }

      if (name in values && !same(values[name], value)) {
        throw validationError(`values.${name} differs from the value it matches on`, { path: `values.${name}` });
      }

      const find = async () => {
        const query = validateQuery(snapshot.index, {
          object: object.nameSingular,
          filter: { field: name, op: 'eq', value },
          limit: 1,
        });

        return (await dataSource.query(db, ctx.workspaceId, snapshot.index, query)).items[0];
      };
      const update = async (id: string) => {
        const result = await batch(ctx, objectName, { update: [{ id, patch: values }] });

        return { record: result.updated[0] as RecordData, created: false };
      };
      const existing = await find();

      if (existing) {
        return update(existing.id);
      }

      try {
        const result = await batch(ctx, objectName, { create: [{ ...values, [name]: value }] });

        return { record: result.created[0] as RecordData, created: true };
      } catch (error) {
        // Someone else created it between the lookup and the insert: update theirs.
        if (!isEngineError(error) || error.code !== 'UNIQUE_VIOLATION') {
          throw error;
        }

        const winner = await find();

        if (!winner) {
          throw error;
        }

        return update(winner.id);
      }
    },
    batch,
    import: (ctx, objectName, input) =>
      runImport(
        {
          db,
          metadata,
          dataSource,
          batch,
          schemas: (objectId, version, fields) => schemaCache.get(objectId, version, fields),
          members: () => memberDirectory,
        },
        ctx,
        objectName,
        input,
      ),
    bindMembers: (directory) => {
      memberDirectory = directory;
    },
    lookup,
  };
};
