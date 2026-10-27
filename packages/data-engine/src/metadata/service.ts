import type {
  CommandItem,
  CommandItemInput,
  FieldInput,
  FieldMetadata,
  Layout,
  LayoutInput,
  NavItem,
  NavItemInput,
  ObjectCreateInput,
  ObjectInput,
  ObjectMetadata,
  ViewInput,
  ViewMetadata,
  WorkspaceSchema,
} from '@devias/core';
import { newId, ObjectCreateInputSchema } from '@devias/core';
import type { EngineContext } from '../context';
import type { Db } from '../db/exec';
import {
  EngineError,
  fromZodError,
  isEngineError,
  notFound,
  PG_INVALID_TEXT_REPRESENTATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorMessage,
  validationError,
} from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, bumpMetadataVersion, lockWorkspace, writeEvents } from '../events/feed';
import type { Logger } from '../logger';
import { authorize } from '../permissions/policy';
import type { Snapshot, SnapshotCache } from './snapshot';
import type { MetadataStore } from './store';

export interface MetadataCrudService<TRow, TInput, TCreate = TInput> {
  list(ctx: EngineContext): Promise<TRow[]>;
  get(ctx: EngineContext, id: string): Promise<TRow>;
  create(ctx: EngineContext, input: TCreate): Promise<TRow>;
  update(ctx: EngineContext, id: string, patch: Partial<TInput>): Promise<TRow>;
  delete(ctx: EngineContext, id: string): Promise<void>;
}

export interface MetadataService {
  /** Unauthenticated snapshot access for internal callers (routing, validation). */
  getSnapshot(workspaceId: string): Promise<Snapshot>;
  getSchema(ctx: EngineContext): Promise<WorkspaceSchema>;
  invalidate(workspaceId: string): void;
  /** Making an object also makes what goes with it: see `ObjectCreateInput`. */
  objects: MetadataCrudService<ObjectMetadata, ObjectInput, ObjectCreateInput>;
  fields: MetadataCrudService<FieldMetadata, FieldInput>;
  views: MetadataCrudService<ViewMetadata, ViewInput>;
  layouts: MetadataCrudService<Layout, LayoutInput>;
  navItems: MetadataCrudService<NavItem, NavItemInput> & {
    /** Move several items at once, as one change: each with its parent and its place among its siblings. */
    arrange(ctx: EngineContext, moves: { id: string; parentId: string | null; position: number }[]): Promise<NavItem[]>;
    /** Drop the workspace's overrides of an item. */
    reset(ctx: EngineContext, id: string): Promise<NavItem>;
    /** The whole sidebar back to its defaults; items the workspace created stay. */
    resetAll(ctx: EngineContext): Promise<NavItem[]>;
  };
  commandItems: MetadataCrudService<CommandItem, CommandItemInput>;
}

export interface MetadataServiceDeps {
  db: Db;
  cache: SnapshotCache;
  store: MetadataStore;
  bus: EventBus;
  clock: () => Date;
  logger: Logger;
}

type Entity = 'object' | 'field' | 'view' | 'layout' | 'nav_item' | 'command_item';

/** Translate low-level database failures that slipped past pre-checks. */
export const mapDbError = (error: unknown): never => {
  if (isEngineError(error)) {
    throw error;
  }

  if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
    throw new EngineError('CONFLICT', 'A row with the same unique key already exists');
  }

  // A name or label where an id belongs ("customer" for a uuid): say so instead of failing the query.
  if (pgErrorCode(error) === PG_INVALID_TEXT_REPRESENTATION) {
    throw validationError(pgErrorMessage(error) ?? 'A value does not fit its column');
  }

  throw error;
};

export const createMetadataService = (deps: MetadataServiceDeps): MetadataService => {
  const { db, cache, store, bus, clock } = deps;

  const getSnapshot = (workspaceId: string) => cache.get(db, workspaceId);

  /** Run one metadata write: lock → mutate → bump version → event → notify; invalidate + emit after commit. */
  const write = async <T extends { id: string }>(
    ctx: EngineContext,
    entity: Entity,
    mutate: (tx: Db) => Promise<T | null>,
    entityIdOf?: (row: T | null) => string | undefined,
  ): Promise<T | null> => {
    authorize(ctx, 'metadata.write');
    const workspaceId = ctx.workspaceId;
    const result = await db
      .transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const row = await mutate(tx);
        const metadataVersion = await bumpMetadataVersion(tx, workspaceId);
        const sequence = await allocateSequences(tx, workspaceId, 1);
        await writeEvents(tx, workspaceId, [
          {
            sequence,
            type: 'metadata.changed',
            actor: ctx.actor,
            occurredAt: clock(),
            entity,
            entityId: entityIdOf ? entityIdOf(row) : (row?.id ?? undefined),
            metadataVersion,
          },
        ]);
        await bus.publish(tx, workspaceId, { seq: sequence });

        return { row, sequence };
      })
      .catch(mapDbError);
    cache.invalidate(workspaceId);
    bus.emitLocal(workspaceId, { seq: result.sequence });

    return result.row;
  };

  /** A new object's money field names its currency field, an earlier field of the same object. */
  const currencyFieldOf = (field: string, name: unknown, made: FieldMetadata[]): string => {
    const found = made.find((one) => one.name === name);

    if (!found) {
      throw validationError(
        `The currency field "${String(name)}" of "${field}" must be an earlier field of the object`,
        {
          field,
        },
      );
    }

    return found.id;
  };

  const crud = <TRow extends { id: string }, TInput, TCreate = TInput>(spec: {
    entity: Entity;
    label: string;
    rows: (snapshot: Snapshot) => TRow[];
    insert: (tx: Db, workspaceId: string, input: TCreate, id: string) => Promise<TRow>;
    update: (tx: Db, workspaceId: string, current: TRow, patch: Partial<TInput>) => Promise<TRow>;
    remove: (tx: Db, workspaceId: string, current: TRow) => Promise<void>;
  }): MetadataCrudService<TRow, TInput, TCreate> => {
    const find = async (ctx: EngineContext, id: string): Promise<TRow> => {
      const snapshot = await getSnapshot(ctx.workspaceId);
      const row = spec.rows(snapshot).find((r) => r.id === id);

      if (!row) {
        throw notFound(spec.label, id);
      }

      return row;
    };

    return {
      list: async (ctx) => {
        authorize(ctx, 'metadata.read');

        return spec.rows(await getSnapshot(ctx.workspaceId));
      },
      get: async (ctx, id) => {
        authorize(ctx, 'metadata.read');

        return find(ctx, id);
      },
      create: async (ctx, input) => {
        const row = await write(ctx, spec.entity, (tx) => spec.insert(tx, ctx.workspaceId, input, newId()));

        return row as TRow;
      },
      update: async (ctx, id, patch) => {
        authorize(ctx, 'metadata.write');
        const current = await find(ctx, id);
        const row = await write(ctx, spec.entity, (tx) => spec.update(tx, ctx.workspaceId, current, patch));

        return row as TRow;
      },
      delete: async (ctx, id) => {
        authorize(ctx, 'metadata.write');
        const current = await find(ctx, id);
        await write(
          ctx,
          spec.entity,
          async (tx) => {
            await spec.remove(tx, ctx.workspaceId, current);

            return null;
          },
          () => current.id,
        );
      },
    };
  };

  const own = (id: string) => ({ id, moduleId: null });

  return {
    getSnapshot,
    getSchema: async (ctx) => {
      authorize(ctx, 'metadata.read');

      return (await getSnapshot(ctx.workspaceId)).schema;
    },
    invalidate: (workspaceId) => cache.invalidate(workspaceId),
    objects: crud<ObjectMetadata, ObjectInput, ObjectCreateInput>({
      entity: 'object',
      label: 'Object',
      rows: (s) => s.schema.objects,
      // The object, its fields, the table that lists them and its sidebar row: one change, so one transaction.
      insert: async (tx, ws, rawInput, uid) => {
        const parsed = ObjectCreateInputSchema.safeParse(rawInput);

        if (!parsed.success) {
          throw fromZodError(parsed.error, 'Invalid object');
        }

        const { fields = [], addToNavigation = true, ...input } = parsed.data;

        if (input.primaryFieldId) {
          throw validationError('A new object has no fields yet: create the field, then make it the primary field', {
            primaryFieldId: input.primaryFieldId,
          });
        }

        const object = await store.insertObject(tx, ws, input, own(uid));
        const made: FieldMetadata[] = [];

        for (const [position, field] of fields.entries()) {
          // What is being made has no ids the caller could know: a relation may point at the object by its API name,
          // and a money field at its currency field, an earlier field of the object, by its API name.
          const settings = Object.fromEntries(
            Object.entries(field.settings ?? {}).map(([key, value]) => [
              key,
              key === 'targetObjectId' && value === object.nameSingular
                ? object.id
                : key === 'currencyFieldId'
                  ? currencyFieldOf(field.name, value, made)
                  : value,
            ]),
          );
          made.push(
            await store.insertField(
              tx,
              ws,
              { ...field, settings, objectId: object.id, position: field.position ?? position },
              own(newId()),
            ),
          );
        }

        const row = made[0] ? await store.updateObject(tx, ws, object, { primaryFieldId: made[0].id }) : object;
        await store.insertView(
          tx,
          ws,
          {
            objectId: object.id,
            label: `All ${object.labelPlural.toLowerCase()}`,
            type: 'table',
            icon: 'table',
            isDefault: true,
            position: 0,
            config: { fields: made.map((field) => ({ fieldId: field.id, visible: true })), sorts: [] },
          },
          own(newId()),
        );

        if (addToNavigation) {
          await store.insertNavItem(
            tx,
            ws,
            {
              label: object.labelPlural,
              ...(object.icon ? { icon: object.icon } : {}),
              target: { kind: 'object', objectId: object.id },
            },
            own(newId()),
          );
        }

        return row;
      },
      update: async (tx, ws, current, patch) => {
        if (Object.hasOwn(patch, 'primaryFieldId')) {
          await store.checkPrimaryField(tx, ws, current.id, patch.primaryFieldId);
        }

        return store.updateObject(tx, ws, current, patch);
      },
      remove: (tx, ws, current) => store.deleteObject(tx, ws, current),
    }),
    fields: crud<FieldMetadata, FieldInput>({
      entity: 'field',
      label: 'Field',
      rows: (s) => s.schema.fields,
      insert: async (tx, ws, input, uid) => {
        const field = await store.insertField(tx, ws, input, own(uid));
        await store.addFieldToDefaultView(tx, ws, field);

        return field;
      },
      update: (tx, ws, current, patch) => store.updateField(tx, ws, current, patch),
      remove: async (tx, ws, current) => {
        // The workspace keeps the field that names records until another one does; a module's upgrade has already moved it.
        const owner = await store.getObject(tx, ws, current.objectId);

        if (owner?.primaryFieldId === current.id) {
          throw validationError(
            `"${current.name}" is the primary field of "${owner.nameSingular}": make another field primary first`,
            { field: current.name },
          );
        }

        return store.deleteField(tx, ws, current);
      },
    }),
    views: crud<ViewMetadata, ViewInput>({
      entity: 'view',
      label: 'View',
      rows: (s) => s.schema.views,
      insert: (tx, ws, input, uid) => store.insertView(tx, ws, input, own(uid)),
      update: (tx, ws, current, patch) => store.updateView(tx, ws, current, patch),
      remove: (tx, ws, current) => store.deleteView(tx, ws, current),
    }),
    layouts: crud<Layout, LayoutInput>({
      entity: 'layout',
      label: 'Layout',
      rows: (s) => s.schema.layouts,
      insert: (tx, ws, input, uid) => store.insertLayout(tx, ws, input, own(uid)),
      update: (tx, ws, current, patch) => store.updateLayout(tx, ws, current, patch),
      remove: (tx, ws, current) => store.deleteLayout(tx, ws, current),
    }),
    navItems: {
      ...crud<NavItem, NavItemInput>({
        entity: 'nav_item',
        label: 'Nav item',
        rows: (s) => s.schema.navItems,
        insert: (tx, ws, input, uid) => store.insertNavItem(tx, ws, input, own(uid)),
        // The workspace's edits: a module's item takes them as overrides, so a module update does not undo them.
        update: (tx, ws, current, patch) => store.editNavItem(tx, ws, current, patch),
        remove: (tx, ws, current) => store.deleteNavItem(tx, ws, current),
      }),
      arrange: async (ctx, moves) => {
        authorize(ctx, 'metadata.write');
        let arranged: NavItem[] = [];
        await write(ctx, 'nav_item', async (tx) => {
          arranged = await store.arrangeNavItems(tx, ctx.workspaceId, moves);

          return null;
        });

        return arranged;
      },
      resetAll: async (ctx) => {
        authorize(ctx, 'metadata.write');
        let left: NavItem[] = [];
        await write(ctx, 'nav_item', async (tx) => {
          left = await store.resetAllNavItems(tx, ctx.workspaceId);

          return null;
        });

        return left;
      },
      reset: async (ctx, id) => {
        authorize(ctx, 'metadata.write');
        const snapshot = await getSnapshot(ctx.workspaceId);
        const current = snapshot.schema.navItems.find((item) => item.id === id);

        if (!current) {
          throw notFound('Nav item', id);
        }

        const row = await write(ctx, 'nav_item', (tx) => store.resetNavItem(tx, ctx.workspaceId, current));

        return row as NavItem;
      },
    },
    commandItems: crud<CommandItem, CommandItemInput>({
      entity: 'command_item',
      label: 'Command item',
      rows: (s) => s.schema.commandItems,
      insert: (tx, ws, input, uid) => store.insertCommandItem(tx, ws, input, own(uid)),
      update: (tx, ws, current, patch) => store.updateCommandItem(tx, ws, current, patch),
      remove: (tx, ws, current) => store.deleteCommandItem(tx, ws, current),
    }),
  };
};
