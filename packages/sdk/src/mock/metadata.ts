import {
  availableBlocks,
  blockRefProblem,
  type CommandItem,
  type CommandItemInput,
  CommandItemInputSchema,
  DeviasApiError,
  type FieldInput,
  FieldInputSchema,
  type FieldMetadata,
  fieldRef,
  isObjectKey,
  LAYOUT_CONTENT_KEYS,
  type Layout,
  type LayoutInput,
  LayoutInputSchema,
  layoutActionProblem,
  layoutCells,
  layoutContentOf,
  layoutShapeProblem,
  type MetadataEvent,
  makeLayout,
  mapFilterFields,
  mergeLayoutPatch,
  type NavEdit,
  NavEditError,
  type NavItem,
  type NavItemInput,
  NavItemInputSchema,
  navEdit,
  navParentOf,
  newWorkspaceId,
  type ObjectCreateInput,
  ObjectCreateInputSchema,
  type ObjectInput,
  ObjectInputSchema,
  type ObjectMetadata,
  RESERVED_FIELD_NAMES,
  refersToObject,
  settingsSchemaForFieldType,
  systemFieldId,
  type ViewInput,
  ViewInputSchema,
  type ViewMetadata,
} from '@devias/core';
import type { z } from 'zod';
import { compact } from './reconcile';
import type { MockStore } from './store';

/**
 * Synchronous metadata CRUD over the store (the mock client wraps it in promises and latency).
 * Rows created here are workspace-owned (`moduleId: null`, `workspace.<uuid>` ids). Rows owned
 * by a module can be edited but not deleted; uninstalling the module removes them.
 */

export interface SyncCrud<TRow, TInput, TCreate = TInput> {
  list(): TRow[];
  get(id: string): TRow;
  create(input: TCreate): TRow;
  update(id: string, patch: Partial<TInput>): TRow;
  delete(id: string): void;
}

export interface SyncMetadataApi {
  objects: SyncCrud<ObjectMetadata, ObjectInput, ObjectCreateInput>;
  fields: SyncCrud<FieldMetadata, FieldInput>;
  views: SyncCrud<ViewMetadata, ViewInput>;
  layouts: SyncCrud<Layout, LayoutInput>;
  navItems: SyncCrud<NavItem, NavItemInput> & {
    arrange(moves: { id: string; parentId: string | null; position: number }[]): NavItem[];
    reset(id: string): NavItem;
    resetAll(): NavItem[];
  };
  commandItems: SyncCrud<CommandItem, CommandItemInput>;
}

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

const parse = <T>(schema: z.ZodType<T, unknown>, input: unknown, what: string): T => {
  const result = schema.safeParse(input);

  if (!result.success) {
    const summary = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

    throw validation(`Invalid ${what}: ${summary.join('; ')}`, result.error.issues);
  }

  return result.data;
};

/** Validate a partial patch and keep only the keys the caller sent, so schema defaults never overwrite a row. */
const parsePatch = <T extends object>(schema: z.ZodType<T, unknown>, patch: unknown, what: string): T => {
  const parsed = parse(schema, patch, what);
  const raw = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {};

  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(raw, key))) as T;
};

const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.position - b.position);

const nextPosition = (rows: { position: number }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.position + 1), 0);

const fail = (message: string): never => {
  throw validation(message);
};

export const createMetadataApi = (store: MockStore): SyncMetadataApi => {
  /** While one change is made of several (an object with its fields), they are one event, like the engine's. */
  let grouped = 0;

  const commit = (entity: MetadataEvent['entity'], entityId: string) => {
    if (grouped > 0) {
      return;
    }

    const metadataVersion = store.bumpVersion();
    store.emit({ type: 'metadata.changed', entity, entityId, metadataVersion });
    store.changed();
  };

  /** The object an `objectId` input names: its id, or its API name, plural name or id (like the engine). */
  const requireObject = (key: string): ObjectMetadata => {
    const object = [...store.objects.values()].find((o) => isObjectKey(key, o));

    if (!object) {
      throw validation(`Unknown objectId "${key}"`);
    }

    return object;
  };

  /** A shape holds exactly its own keys, like the engine. */
  const ensureShapeFits = (layout: Parameters<typeof layoutShapeProblem>[0]) => {
    const problem = layoutShapeProblem(layout);

    if (problem) {
      throw validation(problem);
    }
  };

  /** Every layout cell names a declared record block, like the engine (see `blockRefProblem`). */
  const validateLayoutBlocks = (layout: LayoutInput, moduleId: string | null) => {
    const available = availableBlocks(store.modules.values());

    for (const { where, cell } of layoutCells(layout)) {
      const problem = blockRefProblem(cell.blockId, available, moduleId, cell.optional);

      if (problem) {
        throw validation(`${where}, cell "${cell.name}": ${problem}`);
      }
    }
  };

  /** A workspace's layout offers only actions installed modules declare, like the engine. */
  const validateLayoutActions = (
    actions: Layout['actions'] | undefined,
    objectAddress: string,
    moduleId: string | null,
  ) => {
    if (!actions || moduleId !== null) {
      return;
    }

    const installed = [...store.modules.values()];

    for (const entry of actions) {
      const problem = layoutActionProblem(entry, installed, objectAddress);

      if (problem) {
        throw validation(`Actions: ${problem}`);
      }
    }
  };

  /** Refuse a patch that would move a row to another object; the object key itself is dropped from the patch. */
  const withoutObjectMove = <T extends { objectId?: string }>(parsed: T, currentObjectId: string, what: string) => {
    const { objectId, ...rest } = parsed;

    if (objectId !== undefined && requireObject(objectId).id !== currentObjectId) {
      throw validation(`A ${what} cannot move to another object`);
    }

    return rest;
  };

  const getRow = <TRow>(map: Map<string, TRow>, id: string, what: string): TRow => {
    const row = map.get(id);

    if (!row) {
      throw new DeviasApiError(404, 'NOT_FOUND', `${what} "${id}" not found`);
    }

    return row;
  };

  const assertDeletable = (row: { moduleId: string | null }, what: string) => {
    if (row.moduleId !== null) {
      throw new DeviasApiError(
        409,
        'CONFLICT',
        `${what} is owned by module "${row.moduleId}"; uninstall the module to remove it`,
      );
    }
  };

  const assertObjectNamesFree = (input: { nameSingular?: string; namePlural?: string }, excludeId?: string) => {
    for (const other of store.objects.values()) {
      if (other.id === excludeId) {
        continue;
      }

      if (input.nameSingular !== undefined && other.nameSingular === input.nameSingular) {
        throw new DeviasApiError(409, 'CONFLICT', `An object named "${input.nameSingular}" already exists`);
      }

      if (input.namePlural !== undefined && other.namePlural === input.namePlural) {
        throw new DeviasApiError(409, 'CONFLICT', `An object named "${input.namePlural}" already exists`);
      }
    }
  };

  const validateFieldShape = (
    objectId: string,
    field: { name: string; type: string; settings?: Record<string, unknown> | undefined },
    excludeId?: string,
  ) => {
    if (RESERVED_FIELD_NAMES.has(field.name)) {
      throw validation(`Field name "${field.name}" is reserved`);
    }

    if (store.fieldsOf(objectId).some((other) => other.id !== excludeId && other.name === field.name)) {
      throw new DeviasApiError(409, 'CONFLICT', `A field named "${field.name}" already exists on this object`);
    }

    const settings = settingsSchemaForFieldType(field.type).safeParse(field.settings ?? {});

    if (!settings.success) {
      throw validation(`Invalid settings for type "${field.type}"`, settings.error.issues);
    }

    if (field.type === 'relation') {
      const target = (field.settings as { targetObjectId?: unknown } | undefined)?.targetObjectId;

      if (typeof target !== 'string' || !store.objectById(target)) {
        throw validation(`Relation target "${String(target)}" does not exist`);
      }
    }
  };

  const objects: SyncCrud<ObjectMetadata, ObjectInput, ObjectCreateInput> = {
    list: () => [...store.objects.values()],
    get: (id) => getRow(store.objects, id, 'Object'),
    create: (input) => {
      const {
        fields: fieldInputs = [],
        addToNavigation = true,
        ...own
      } = parse(ObjectCreateInputSchema, input, 'object');
      const parsed = parse(ObjectInputSchema, own, 'object');
      assertObjectNamesFree(parsed);

      if (parsed.primaryFieldId) {
        throw validation('A new object has no fields yet: create the field, then make it the primary field');
      }

      const now = store.now();
      const row: ObjectMetadata = compact({
        workspaceId: store.workspaceId,
        id: newWorkspaceId(),
        ...parsed,
        readOnly: parsed.readOnly ?? false,
        deleteWhen: parsed.deleteWhen ?? undefined,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
        moduleId: null,
      });
      store.objects.set(row.id, row);

      // The fields, the table that lists them and the sidebar row are part of making the object: all or nothing.
      grouped += 1;

      try {
        const made: FieldMetadata[] = [];

        for (const field of fieldInputs) {
          made.push(
            fields.create({
              ...field,
              objectId: row.id,
              settings: Object.fromEntries(
                Object.entries(field.settings ?? {}).map(([key, value]) => [
                  key,
                  key === 'targetObjectId' && value === row.nameSingular
                    ? row.id
                    : key === 'currencyFieldId'
                      ? (made.find((one) => one.name === value)?.id ??
                        fail(`The currency field "${String(value)}" must be an earlier field of the object`))
                      : value,
                ]),
              ),
            }),
          );
        }

        if (made[0]) {
          row.primaryFieldId = made[0].id;
        }

        views.create({
          objectId: row.id,
          label: `All ${row.labelPlural.toLowerCase()}`,
          type: 'table',
          icon: 'table',
          isDefault: true,
          position: 0,
          config: { fields: made.map((field) => ({ fieldId: field.id, visible: true })), sorts: [] },
        });

        if (addToNavigation) {
          navItems.create({
            label: row.labelPlural,
            ...(row.icon ? { icon: row.icon } : {}),
            target: { kind: 'object', objectId: row.id },
          });
        }
      } catch (error) {
        objects.delete(row.id);
        grouped -= 1;
        throw error;
      }

      grouped -= 1;

      commit('object', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.objects, id, 'Object');
      const parsed = parsePatch(ObjectInputSchema.partial(), patch, 'object');
      assertObjectNamesFree(parsed, id);

      if (parsed.primaryFieldId && store.fields.get(parsed.primaryFieldId)?.objectId !== id) {
        throw validation(`"${parsed.primaryFieldId}" is not a field of this object`);
      }

      const { deleteWhen, ...rest } = parsed;
      Object.assign(row, compact(rest), { updatedAt: store.now() });

      // `null` removes the rule.
      if (deleteWhen === null) {
        delete row.deleteWhen;
      } else if (deleteWhen) {
        row.deleteWhen = deleteWhen;
      }

      commit('object', id);

      return row;
    },
    delete: (id) => {
      const row = getRow(store.objects, id, 'Object');
      assertDeletable(row, 'Object');

      for (const field of [...store.fields.values()]) {
        if (field.objectId === id) {
          store.fields.delete(field.id);
        }
      }

      for (const view of [...store.views.values()]) {
        if (view.objectId === id) {
          store.views.delete(view.id);
        }
      }

      for (const layout of [...store.layouts.values()]) {
        if (layout.objectId === id) {
          store.layouts.delete(layout.id);
        }
      }

      // Nav items and command items name the object inside their target: drop the ones pointing at it, like the engine.
      for (const item of [...store.navItems.values()]) {
        if (refersToObject(item.target, row)) {
          store.navItems.delete(item.id);
        }
      }

      for (const item of [...store.commandItems.values()]) {
        if (refersToObject(item.action, row)) {
          store.commandItems.delete(item.id);
        }
      }

      store.records.delete(id);
      store.objects.delete(id);
      commit('object', id);
    },
  };

  const fields: SyncCrud<FieldMetadata, FieldInput> = {
    list: () => byPosition([...store.fields.values()]),
    get: (id) => getRow(store.fields, id, 'Field'),
    create: (input) => {
      const parsed = parse(FieldInputSchema, input, 'field');
      const objectId = requireObject(parsed.objectId).id;
      validateFieldShape(objectId, parsed);
      const row: FieldMetadata = compact({
        workspaceId: store.workspaceId,
        id: newWorkspaceId(),
        ...parsed,
        objectId,
        settings: parsed.settings ?? {},
        isRequired: parsed.isRequired ?? false,
        isUnique: parsed.isUnique ?? false,
        position: parsed.position ?? nextPosition(store.fieldsOf(objectId)),
        moduleId: null,
      });
      store.fields.set(row.id, row);

      // A new field shows in the object's default table, as the engine does.
      const table = [...store.views.values()].find(
        (view) => view.objectId === objectId && view.isDefault && view.moduleId === null,
      );

      if (table && !table.config.fields.some((one) => one.fieldId === row.id)) {
        table.config = { ...table.config, fields: [...table.config.fields, { fieldId: row.id, visible: true }] };
      }

      commit('field', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.fields, id, 'Field');
      const parsed = withoutObjectMove(parsePatch(FieldInputSchema.partial(), patch, 'field'), row.objectId, 'field');
      const next = { ...row, ...compact(parsed) };
      validateFieldShape(row.objectId, next, id);
      Object.assign(row, compact(parsed));
      commit('field', id);

      return row;
    },
    delete: (id) => {
      const row = getRow(store.fields, id, 'Field');
      assertDeletable(row, 'Field');

      if (store.objects.get(row.objectId)?.primaryFieldId === id) {
        throw validation(`"${row.name}" is the primary field of its object: make another field primary first`);
      }

      store.fields.delete(id);
      commit('field', id);
    },
  };

  /** Every field a view config names, as the field's id: the server stores ids, and accepts API names. */
  const normalizeViewConfig = <C extends NonNullable<ViewInput['config']>>(objectId: string, config: C): C => {
    const fields = store.fieldsOf(objectId);
    const resolve = (ref: string): string => {
      const id = fieldRef(fields, ref)?.id ?? systemFieldId(ref);

      if (id) {
        return id;
      }

      throw validation(`View references unknown field "${ref}"`);
    };

    return {
      ...config,
      ...(config.fields ? { fields: config.fields.map((f) => ({ ...f, fieldId: resolve(f.fieldId) })) } : {}),
      ...(config.sorts ? { sorts: config.sorts.map((s) => ({ ...s, fieldId: resolve(s.fieldId) })) } : {}),
      ...(config.groupById ? { groupById: resolve(config.groupById) } : {}),
      ...(config.filter ? { filter: mapFilterFields(config.filter, resolve) } : {}),
    };
  };

  const views: SyncCrud<ViewMetadata, ViewInput> = {
    list: () => byPosition([...store.views.values()]),
    get: (id) => getRow(store.views, id, 'View'),
    create: (input) => {
      const parsed = parse(ViewInputSchema, input, 'view');
      const object = requireObject(parsed.objectId);
      const config = normalizeViewConfig(object.id, parsed.config ?? {});
      const row: ViewMetadata = compact({
        workspaceId: store.workspaceId,
        objectId: object.id,
        id: newWorkspaceId(),
        label: parsed.label,
        type: parsed.type ?? 'table',
        icon: parsed.icon,
        isDefault: parsed.isDefault ?? false,
        position: parsed.position ?? nextPosition([...store.views.values()].filter((v) => v.objectId === object.id)),
        config: compact({
          fields: config.fields ?? store.fieldsOf(object.id).map((field) => ({ fieldId: field.id, visible: true })),
          filter: config.filter ?? undefined,
          sorts: config.sorts ?? [],
          groupById: config.groupById ?? undefined,
          settings: config.settings ?? {},
        }),
        moduleId: null,
      });
      store.views.set(row.id, row);
      commit('view', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.views, id, 'View');
      const parsed = withoutObjectMove(parsePatch(ViewInputSchema.partial(), patch, 'view'), row.objectId, 'view');
      const { config, ...rest } = parsed;
      Object.assign(row, compact(rest));

      if (config) {
        const rawConfig = (patch as { config?: Record<string, unknown> }).config ?? {};
        const normalized = normalizeViewConfig(row.objectId, config);
        // `null` clears a key, like an explicit `undefined` (the real server receives JSON).
        const sent = Object.fromEntries(
          Object.entries(normalized)
            .filter(([key]) => Object.hasOwn(rawConfig, key))
            .map(([key, value]) => [key, value ?? undefined]),
        );
        row.config = compact({ ...row.config, ...sent }) as ViewMetadata['config'];
      }

      commit('view', id);

      return row;
    },
    delete: (id) => {
      const row = getRow(store.views, id, 'View');
      assertDeletable(row, 'View');
      store.views.delete(id);
      commit('view', id);
    },
  };

  const layouts: SyncCrud<Layout, LayoutInput> = {
    list: () => [...store.layouts.values()],
    get: (id) => getRow(store.layouts, id, 'Layout'),
    create: (input) => {
      const parsed = parse(LayoutInputSchema, input, 'layout');
      const object = requireObject(parsed.objectId);
      ensureShapeFits(parsed);
      validateLayoutBlocks(parsed, null);
      validateLayoutActions(parsed.actions, object.id, null);
      const row = makeLayout(
        {
          workspaceId: store.workspaceId,
          objectId: object.id,
          id: newWorkspaceId(),
          label: parsed.label,
          kind: 'record',
          isDefault: parsed.isDefault ?? false,
          actions: parsed.actions ?? [],
          moduleId: null,
        },
        parsed.shell,
        layoutContentOf(parsed),
      );
      store.layouts.set(row.id, row);
      commit('layout', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.layouts, id, 'Layout');
      const parsed = withoutObjectMove(
        parsePatch(LayoutInputSchema.partial(), patch, 'layout'),
        row.objectId,
        'layout',
      );
      const merged = parse(LayoutInputSchema, mergeLayoutPatch(row, parsed), 'layout');
      ensureShapeFits(merged);

      // Only a changed layout's cells are checked, so one saved before a block went away can still be renamed.
      if (parsed.shell !== undefined || LAYOUT_CONTENT_KEYS.some((key) => Object.hasOwn(parsed, key))) {
        validateLayoutBlocks(merged, row.moduleId);
      }

      if (parsed.actions !== undefined) {
        validateLayoutActions(parsed.actions, requireObject(row.objectId).id, row.moduleId);
      }

      const next = makeLayout(
        {
          workspaceId: row.workspaceId,
          objectId: row.objectId,
          id: row.id,
          label: merged.label,
          kind: 'record',
          isDefault: merged.isDefault ?? false,
          actions: merged.actions ?? [],
          moduleId: row.moduleId,
        },
        merged.shell,
        layoutContentOf(merged),
      );

      // The row keeps its identity; the keys of the old shape go.
      for (const key of LAYOUT_CONTENT_KEYS) {
        delete (row as Record<string, unknown>)[key];
      }

      Object.assign(row, next);
      commit('layout', id);

      return row;
    },
    delete: (id) => {
      const row = getRow(store.layouts, id, 'Layout');
      assertDeletable(row, 'Layout');
      store.layouts.delete(id);
      commit('layout', id);
    },
  };

  /** An edit by the workspace, applied the way the engine does (see `navEdit`). */
  const editNav = (row: NavItem, patch: Partial<NavItemInput>) => {
    let edit: NavEdit;

    try {
      edit = navEdit(row, patch);
    } catch (error) {
      if (error instanceof NavEditError) {
        throw validation(error.message, { id: row.id });
      }

      throw error;
    }

    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (!store.navItems.has(patch.parentId)) {
        throw validation(`Parent nav item "${patch.parentId}" does not exist`);
      }

      // A parent may not be the item or anything below it.
      const seen = new Set<string>();
      let cursor: string | null = patch.parentId;

      while (cursor && !seen.has(cursor)) {
        if (cursor === row.id) {
          throw validation('A nav item cannot sit under itself or one of its own items');
        }

        seen.add(cursor);
        const next = store.navItems.get(cursor);
        cursor = next ? navParentOf(next) : null;
      }
    }

    Object.assign(row, compact(edit.columns));
    row.overrides = edit.overrides;
  };

  const navItems: SyncMetadataApi['navItems'] = {
    list: () => byPosition([...store.navItems.values()]),
    get: (id) => getRow(store.navItems, id, 'Nav item'),
    create: (input) => {
      const { hidden, ...parsed } = parse(NavItemInputSchema, input, 'nav item');
      const row: NavItem = compact({
        workspaceId: store.workspaceId,
        id: newWorkspaceId(),
        ...parsed,
        position: parsed.position ?? nextPosition([...store.navItems.values()]),
        parentId: parsed.parentId ?? null,
        pinned: parsed.pinned ?? false,
        overrides: hidden ? { hidden: true } : null,
        moduleId: null,
      });
      store.navItems.set(row.id, row);
      commit('nav_item', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.navItems, id, 'Nav item');
      const parsed = parsePatch(NavItemInputSchema.partial(), patch, 'nav item');
      editNav(row, parsed);
      commit('nav_item', id);

      return row;
    },
    arrange: (moves) => {
      for (const move of moves) {
        getRow(store.navItems, move.id, 'Nav item');
      }

      for (const move of moves) {
        const row = getRow(store.navItems, move.id, 'Nav item');
        editNav(row, { parentId: move.parentId, position: move.position });
      }

      for (const move of moves) {
        commit('nav_item', move.id);
      }

      return byPosition([...store.navItems.values()]);
    },
    reset: (id) => {
      const row = getRow(store.navItems, id, 'Nav item');
      row.overrides = null;
      commit('nav_item', id);

      return row;
    },
    resetAll: () => {
      for (const row of [...store.navItems.values()]) {
        row.overrides = null;
        commit('nav_item', row.id);
      }

      return byPosition([...store.navItems.values()]);
    },
    delete: (id) => {
      const row = getRow(store.navItems, id, 'Nav item');
      assertDeletable(row, 'Nav item');
      store.navItems.delete(id);
      commit('nav_item', id);
    },
  };

  const commandItems: SyncCrud<CommandItem, CommandItemInput> = {
    list: () => [...store.commandItems.values()],
    get: (id) => getRow(store.commandItems, id, 'Command item'),
    create: (input) => {
      const parsed = parse(CommandItemInputSchema, input, 'command item');
      const row: CommandItem = compact({
        workspaceId: store.workspaceId,
        id: newWorkspaceId(),
        ...parsed,
        moduleId: null,
      });
      store.commandItems.set(row.id, row);
      commit('command_item', row.id);

      return row;
    },
    update: (id, patch) => {
      const row = getRow(store.commandItems, id, 'Command item');
      const parsed = parsePatch(CommandItemInputSchema.partial(), patch, 'command item');
      Object.assign(row, compact(parsed));
      commit('command_item', id);

      return row;
    },
    delete: (id) => {
      const row = getRow(store.commandItems, id, 'Command item');
      assertDeletable(row, 'Command item');
      store.commandItems.delete(id);
      commit('command_item', id);
    },
  };

  return { objects, fields, views, layouts, navItems, commandItems };
};
