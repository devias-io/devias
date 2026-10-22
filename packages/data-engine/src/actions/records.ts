import { activityActions as activity, noteActions as notes, recordActions as records } from '@devias/core';
import { EngineError } from '../errors';
import { type Action, type EngineActionDeps, implement } from './types';

/** Records (query, CRUD, batch, search) and a record's activity and notes. */
export const recordActions = ({ engine }: EngineActionDeps): Action[] => [
  implement(records.list, ({ object, ...query }, ctx) => engine.records.list(ctx, { ...query, object })),
  implement(records.aggregate, ({ object, ...query }, ctx) => engine.records.aggregate(ctx, { ...query, object })),
  implement(records.get, ({ object, id }, ctx) => engine.records.get(ctx, object, id)),
  implement(records.getWithLabels, async ({ object: ref, id }, ctx) => {
    const { index } = await engine.metadata.getSnapshot(ctx.workspaceId);
    const object = index.objectsByName.get(ref) ?? index.objectsById.get(ref);

    if (!object) {
      throw new EngineError('NOT_FOUND', `Unknown object "${ref}"`);
    }

    const relations = (index.fieldsByObjectId.get(object.id) ?? []).filter((field) => field.type === 'relation');
    const page = await engine.records.list(ctx, {
      object: object.nameSingular,
      filter: { field: 'id', op: 'eq', value: id },
      limit: 1,
      ...(relations.length > 0
        ? { include: Object.fromEntries(relations.map((field) => [field.name, true as const])) }
        : {}),
    });
    const record = page.items[0];

    if (!record) {
      throw new EngineError('NOT_FOUND', `${object.labelSingular} "${id}" not found`);
    }

    return { record, ...(page.included ? { included: page.included } : {}) };
  }),
  implement(records.create, ({ object, values }, ctx) => engine.records.create(ctx, object, values)),
  implement(records.update, ({ object, id, values }, ctx) => engine.records.update(ctx, object, id, values)),
  implement(records.delete, ({ object, id }, ctx) => engine.records.delete(ctx, object, [id])),
  implement(records.deleteMany, ({ object, ids }, ctx) => engine.records.delete(ctx, object, ids)),
  implement(records.upsert, ({ object, match, values }, ctx) => engine.records.upsert(ctx, object, match, values)),
  implement(records.batch, ({ object, ...batch }, ctx) => engine.records.batch(ctx, object, batch)),
  implement(records.import, ({ object, ...body }, ctx) => engine.records.import(ctx, object, body)),
  implement(records.lookup, (input, ctx) => engine.records.lookup(ctx, input)),
  implement(activity.list, ({ object, id, ...query }, ctx) => engine.activity.list(ctx, object, id, query)),
  implement(notes.list, ({ object, id, ...query }, ctx) => engine.notes.list(ctx, object, id, query)),
  implement(notes.create, ({ object, id, ...input }, ctx) => engine.notes.create(ctx, object, id, input)),
  implement(notes.update, ({ object, id, noteId, ...patch }, ctx) =>
    engine.notes.update(ctx, object, id, noteId, patch),
  ),
  implement(notes.delete, ({ object, id, noteId }, ctx) => engine.notes.delete(ctx, object, id, noteId)),
];
