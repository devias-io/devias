import {
  type ApplyOptions,
  type ApplyResult,
  availableBlocks,
  blockRefProblem,
  type CommandItem,
  type CommandItemDefinition,
  DeviasApiError,
  declarationsOf,
  type FieldDefinition,
  type FieldMetadata,
  hashManifest,
  hashValue,
  LAYOUT_CONTENT_KEYS,
  type Layout,
  type LayoutDefinition,
  layoutCells,
  layoutContentOf,
  type ModuleManifest,
  manifestFields,
  type NavItem,
  type NavItemDefinition,
  type ObjectDefinition,
  type ObjectMetadata,
  type PlanChange,
  type PlanResult,
  parseManifest,
  RESERVED_FIELD_NAMES,
  refersToObject,
  stableStringify,
  type ViewDefinition,
  type ViewMetadata,
} from '@devias/core';
import type { MockStore } from './store';

/**
 * Plan/apply a module manifest against the store by id, mirroring the server's
 * reconciler: rows owned by the module are created, updated or deleted; rows owned by the workspace
 * (`moduleId === null`) or by another module are never touched and surface as conflicts.
 * Deleting objects or fields and changing a field's type are destructive and need `allowDestructive`.
 */

const MISSING_DEPENDENCY = 'Missing dependency: ';

type Attrs = Record<string, unknown>;
type Diff = NonNullable<PlanChange['diff']>;
type ManifestField = FieldDefinition & { objectId: string };

const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

const diffAttrs = (desired: Attrs, existing: Attrs): Diff | undefined => {
  const diff: Diff = {};

  for (const [key, to] of Object.entries(desired)) {
    const from = existing[key];

    if (!same(from, to)) {
      diff[key] = { from, to };
    }
  }

  return Object.keys(diff).length > 0 ? diff : undefined;
};

/** Drop `undefined` values so rows serialize cleanly and compare equal after a JSON round trip. */
export const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const assignAttrs = (row: object, attrs: Attrs): void => {
  const target = row as Attrs;

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
};

interface Ctx {
  store: MockStore;
  manifest: ModuleManifest;
  changes: PlanChange[];
  manifestObjects: Map<string, ObjectDefinition>;
  fields: ManifestField[];
}

const createContext = (store: MockStore, manifest: ModuleManifest): Ctx => ({
  store,
  manifest,
  changes: [],
  manifestObjects: new Map(manifest.objects.map((object) => [object.id, object])),
  fields: manifestFields(manifest),
});

const objectRow = (ctx: Ctx, id: string): ObjectMetadata | undefined => ctx.store.objectById(id);

const objectKnown = (ctx: Ctx, id: string): boolean => ctx.manifestObjects.has(id) || objectRow(ctx, id) !== undefined;

const objectName = (ctx: Ctx, id: string): string =>
  ctx.manifestObjects.get(id)?.nameSingular ?? objectRow(ctx, id)?.nameSingular ?? id;

/** Field ids an object has after apply: existing rows (minus those this manifest drops) merged with its definitions. */
const allFieldIds = (ctx: Ctx, objectAddress: string): string[] => {
  const row = objectRow(ctx, objectAddress);
  const declared = ctx.fields.filter((field) => field.objectId === objectAddress);
  const declaredIds = new Set(declared.map((field) => field.id));
  const positions = new Map<string, number>();

  if (row) {
    for (const field of ctx.store.fieldsOf(row.id)) {
      if (field.moduleId === ctx.manifest.id && !declaredIds.has(field.id)) {
        continue;
      }

      positions.set(field.id, field.position);
    }
  }

  declared.forEach((field, index) => {
    positions.set(field.id, field.position ?? positions.get(field.id) ?? 1_000 + index);
  });

  return [...positions.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
};

// Desired attributes per kind: what the plan compares and what apply writes.

const objectAttrs = (def: ObjectDefinition): Attrs => ({
  nameSingular: def.nameSingular,
  namePlural: def.namePlural,
  labelSingular: def.labelSingular,
  labelPlural: def.labelPlural,
  icon: def.icon,
  description: def.description,
  primaryFieldId: def.primaryFieldId,
  deleteWhen: def.deleteWhen,
});

const fieldAttrs = (ctx: Ctx, def: ManifestField, existing: FieldMetadata | undefined, index: number): Attrs => {
  const object = objectRow(ctx, def.objectId);

  return {
    ...(object ? { objectId: object.id } : {}),
    name: def.name,
    type: def.type,
    label: def.label,
    description: def.description,
    icon: def.icon,
    settings: def.settings ?? {},
    isRequired: def.isRequired ?? false,
    isUnique: def.isUnique ?? false,
    defaultValue: def.defaultValue,
    position: def.position ?? existing?.position ?? index,
  };
};

const viewFieldConfig = (fields: NonNullable<ViewDefinition['fields']>): Attrs[] =>
  fields.map((field) => compact({ fieldId: field.fieldId, width: field.width, visible: field.visible ?? true }));

/** Omitted `fields` means "all fields" when the view is created; afterwards the stored list is kept. */
const viewAttrs = (ctx: Ctx, def: ViewDefinition, existing?: ViewMetadata): Attrs => {
  const object = objectRow(ctx, def.objectId);
  const fields = def.fields
    ? viewFieldConfig(def.fields)
    : (existing?.config.fields ?? allFieldIds(ctx, def.objectId).map((fieldId) => ({ fieldId, visible: true })));

  return {
    ...(object ? { objectId: object.id } : {}),
    label: def.label,
    type: def.type,
    icon: def.icon,
    isDefault: def.isDefault ?? false,
    position: def.position ?? 0,
    config: compact({
      fields,
      filter: def.filter,
      sorts: def.sorts ?? [],
      groupById: def.groupById,
      settings: def.settings ?? {},
    }),
  };
};

const layoutAttrs = (ctx: Ctx, def: LayoutDefinition): Attrs => {
  const object = objectRow(ctx, def.objectId);
  const content = layoutContentOf(def) as Record<string, unknown>;

  return {
    ...(object ? { objectId: object.id } : {}),
    name: def.label,
    shell: def.shell,
    isDefault: def.isDefault ?? false,
    // Every content key is set, those the shape does not take to nothing, so a change of shape clears the old ones.
    ...Object.fromEntries(LAYOUT_CONTENT_KEYS.map((key) => [key, content[key]])),
    actions: def.actions ?? [],
  };
};

const navAttrs = (def: NavItemDefinition): Attrs => ({
  label: def.label,
  icon: def.icon,
  target: def.target,
  pinned: def.pinned ?? false,
  // Left out, the workspace orders the row: it goes last when created and is not compared afterwards.
  ...(def.position !== undefined ? { position: def.position } : {}),
});

const commandAttrs = (def: CommandItemDefinition): Attrs => ({
  label: def.label,
  icon: def.icon,
  group: def.group,
  shortcut: def.shortcut,
  action: def.action,
});

interface KindSpec<TDef extends { id: string }, TRow extends { id: string; moduleId: string | null }> {
  kind: PlanChange['kind'];
  defs: TDef[];
  rows: Map<string, TRow>;
  label: (def: TDef) => string;
  rowLabel: (row: TRow) => string;
  desired: (def: TDef, existing: TRow, index: number) => Attrs;
  /** A missing-dependency reason (object not found, ...) blocks the change. */
  dependency?: (def: TDef) => string | undefined;
  /** A conflict reason (name already used, reserved name, ...). */
  collision?: (def: TDef, existing: TRow | undefined) => string | undefined;
  destructiveUpdate?: (diff: Diff) => boolean;
  destructiveDelete: boolean;
}

const reconcileKind = <TDef extends { id: string }, TRow extends { id: string; moduleId: string | null }>(
  ctx: Ctx,
  spec: KindSpec<TDef, TRow>,
): void => {
  const byId = new Map<string, TRow>();

  for (const row of spec.rows.values()) {
    byId.set(row.id, row);
  }

  const declared = new Set<string>();
  spec.defs.forEach((def, index) => {
    declared.add(def.id);
    const existing = byId.get(def.id);
    const base = { kind: spec.kind, id: def.id, label: spec.label(def) };
    const missing = spec.dependency?.(def);

    if (missing) {
      ctx.changes.push({ ...base, action: 'conflict', destructive: false, reason: `${MISSING_DEPENDENCY}${missing}` });

      return;
    }

    if (existing && existing.moduleId !== ctx.manifest.id) {
      const owner = existing.moduleId ? `module "${existing.moduleId}"` : 'the workspace';
      ctx.changes.push({ ...base, action: 'conflict', destructive: false, reason: `Owned by ${owner}` });

      return;
    }

    const collision = spec.collision?.(def, existing);

    if (collision) {
      ctx.changes.push({ ...base, action: 'conflict', destructive: false, reason: collision });

      return;
    }

    if (!existing) {
      ctx.changes.push({ ...base, action: 'create', destructive: false });

      return;
    }

    const diff = diffAttrs(spec.desired(def, existing, index), existing as unknown as Attrs);

    if (!diff) {
      ctx.changes.push({ ...base, action: 'noop', destructive: false });
    } else {
      ctx.changes.push({ ...base, action: 'update', destructive: spec.destructiveUpdate?.(diff) ?? false, diff });
    }
  });

  for (const row of byId.values()) {
    if (row.moduleId !== ctx.manifest.id || declared.has(row.id)) {
      continue;
    }

    ctx.changes.push({
      kind: spec.kind,
      id: row.id,
      label: spec.rowLabel(row),
      action: 'delete',
      destructive: spec.destructiveDelete,
      reason: 'No longer declared by the manifest',
    });
  }
};

/** Rows that hang off a deleted object go with it (whoever owns them), listed explicitly in the plan. */
const cascadeObjectDeletes = (ctx: Ctx): void => {
  const deletedObjects = ctx.changes.filter((change) => change.kind === 'object' && change.action === 'delete');

  if (deletedObjects.length === 0) {
    return;
  }

  const planned = new Set(ctx.changes.map((change) => `${change.kind}:${change.id}`));

  for (const change of deletedObjects) {
    const object = objectRow(ctx, change.id);

    if (!object) {
      continue;
    }

    const reason = `Cascade: object "${object.nameSingular}" is removed`;
    const push = (kind: PlanChange['kind'], id: string, label: string, destructive: boolean) => {
      const key = `${kind}:${id}`;

      if (planned.has(key)) {
        return;
      }

      planned.add(key);
      ctx.changes.push({ kind, id, label, action: 'delete', destructive, reason });
    };

    for (const field of ctx.store.fieldsOf(object.id)) {
      push('field', field.id, `Field "${field.label}" on ${object.nameSingular}`, true);
    }

    for (const view of ctx.store.views.values()) {
      if (view.objectId === object.id) {
        push('view', view.id, `View "${view.label}"`, false);
      }
    }

    for (const layout of ctx.store.layouts.values()) {
      if (layout.objectId === object.id) {
        push('layout', layout.id, `Layout "${layout.label}"`, false);
      }
    }
  }
};

const relationTarget = (def: { type: string; settings?: Record<string, unknown> | undefined }): string | undefined => {
  if (def.type !== 'relation') {
    return undefined;
  }

  const target = def.settings?.targetObjectId;

  return typeof target === 'string' ? target : undefined;
};

const planChanges = (ctx: Ctx): PlanChange[] => {
  const { store, manifest } = ctx;
  reconcileKind<ObjectDefinition, ObjectMetadata>(ctx, {
    kind: 'object',
    defs: manifest.objects,
    rows: store.objects,
    label: (def) => `Object "${def.labelSingular}" (${def.nameSingular})`,
    rowLabel: (row) => `Object "${row.labelSingular}" (${row.nameSingular})`,
    desired: (def) => objectAttrs(def),
    collision: (def) => {
      const other = [...store.objects.values()].find(
        (row) => row.id !== def.id && (row.nameSingular === def.nameSingular || row.namePlural === def.namePlural),
      );

      return other ? `Object name "${def.nameSingular}" is already used by "${other.id}"` : undefined;
    },
    destructiveDelete: true,
  });
  reconcileKind<ManifestField, FieldMetadata>(ctx, {
    kind: 'field',
    defs: ctx.fields,
    rows: store.fields,
    label: (def) => `Field "${def.label}" on ${objectName(ctx, def.objectId)}`,
    rowLabel: (row) => `Field "${row.label}" on ${store.objects.get(row.objectId)?.nameSingular ?? row.objectId}`,
    desired: (def, existing, index) => fieldAttrs(ctx, def, existing, index),
    dependency: (def) => {
      if (!objectKnown(ctx, def.objectId)) {
        return `object "${def.objectId}" for field "${def.id}"`;
      }

      const target = relationTarget(def);

      if (target && !objectKnown(ctx, target)) {
        return `relation target "${target}" for field "${def.id}"`;
      }

      return undefined;
    },
    collision: (def) => {
      if (RESERVED_FIELD_NAMES.has(def.name)) {
        return `Field name "${def.name}" is reserved`;
      }

      const object = objectRow(ctx, def.objectId);

      if (!object) {
        return undefined;
      }

      const other = store.fieldsOf(object.id).find((row) => row.name === def.name && row.id !== def.id);

      return other ? `Field name "${def.name}" on ${object.nameSingular} is already used by "${other.id}"` : undefined;
    },
    destructiveUpdate: (diff) => 'type' in diff || 'objectId' in diff,
    destructiveDelete: true,
  });
  reconcileKind<ViewDefinition, ViewMetadata>(ctx, {
    kind: 'view',
    defs: manifest.views,
    rows: store.views,
    label: (def) => `View "${def.label}" on ${objectName(ctx, def.objectId)}`,
    rowLabel: (row) => `View "${row.label}" on ${store.objects.get(row.objectId)?.nameSingular ?? row.objectId}`,
    desired: (def, existing) => viewAttrs(ctx, def, existing),
    dependency: (def) => (objectKnown(ctx, def.objectId) ? undefined : `object "${def.objectId}" for view "${def.id}"`),
    destructiveDelete: false,
  });
  reconcileKind<LayoutDefinition, Layout>(ctx, {
    kind: 'layout',
    defs: manifest.layouts,
    rows: store.layouts,
    label: (def) => `Layout "${def.label}" on ${objectName(ctx, def.objectId)}`,
    rowLabel: (row) => `Layout "${row.label}" on ${store.objects.get(row.objectId)?.nameSingular ?? row.objectId}`,
    desired: (def) => layoutAttrs(ctx, def),
    dependency: (def) => {
      if (!objectKnown(ctx, def.objectId)) {
        return `object "${def.objectId}" for layout "${def.id}"`;
      }

      // Each cell names a record block this manifest or another installed module declares, like the engine.
      const blocks = availableBlocks([
        ...[...store.modules.values()].filter((m) => m.moduleId !== manifest.id),
        manifest,
      ]);

      for (const { cell } of layoutCells(def)) {
        const problem = blockRefProblem(cell.blockId, blocks, undefined, cell.optional);

        if (problem) {
          return `${problem} (layout "${def.id}")`;
        }
      }

      return undefined;
    },
    destructiveDelete: false,
  });
  reconcileKind<NavItemDefinition, NavItem>(ctx, {
    kind: 'nav_item',
    defs: manifest.navItems,
    rows: store.navItems,
    label: (def) => `Nav item "${def.label}"`,
    rowLabel: (row) => `Nav item "${row.label}"`,
    desired: (def) => navAttrs(def),
    destructiveDelete: false,
  });
  reconcileKind<CommandItemDefinition, CommandItem>(ctx, {
    kind: 'command_item',
    defs: manifest.commandItems,
    rows: store.commandItems,
    label: (def) => `Command "${def.label}"`,
    rowLabel: (row) => `Command "${row.label}"`,
    desired: (def) => commandAttrs(def),
    destructiveDelete: false,
  });
  cascadeObjectDeletes(ctx);

  return ctx.changes;
};

const toManifest = (input: ModuleManifest): ModuleManifest => {
  try {
    return parseManifest(input);
  } catch (error) {
    throw new DeviasApiError(400, 'VALIDATION', error instanceof Error ? error.message : 'Invalid manifest', error);
  }
};

export const planManifest = (store: MockStore, input: ModuleManifest): PlanResult => {
  const manifest = toManifest(input);
  const changes = planChanges(createContext(store, manifest));
  const planHash = hashValue(
    changes.map(({ kind, id, action, destructive, diff }) => ({
      kind,
      id,
      action,
      destructive,
      diff: diff ?? null,
    })),
  );

  return {
    moduleId: manifest.id,
    fromVersion: store.modules.get(manifest.id)?.version ?? null,
    toVersion: manifest.version,
    manifestHash: hashManifest(manifest),
    planHash,
    hasDestructive: changes.some((change) => change.destructive),
    hasConflicts: changes.some((change) => change.action === 'conflict'),
    changes,
  };
};

const byId = <T extends { id: string }>(rows: Iterable<T>): Map<string, T> => {
  const map = new Map<string, T>();

  for (const row of rows) {
    map.set(row.id, row);
  }

  return map;
};

export const applyManifest = (
  store: MockStore,
  input: ModuleManifest,
  options: ApplyOptions = {},
  mode: { uninstall?: boolean } = {},
): ApplyResult => {
  const manifest = toManifest(input);
  const plan = planManifest(store, manifest);

  if (options.expectedPlanHash !== undefined && options.expectedPlanHash !== plan.planHash) {
    throw new DeviasApiError(409, 'PLAN_MISMATCH', 'The plan changed since it was reviewed; run plan again', {
      expected: options.expectedPlanHash,
      actual: plan.planHash,
    });
  }

  const missing = plan.changes.filter(
    (change) => change.action === 'conflict' && change.reason?.startsWith(MISSING_DEPENDENCY),
  );

  if (missing.length > 0) {
    throw new DeviasApiError(422, 'MISSING_DEPENDENCY', missing.map((change) => change.reason).join('; '), {
      changes: missing,
    });
  }

  const conflicts = plan.changes.filter((change) => change.action === 'conflict');

  if (conflicts.length > 0) {
    throw new DeviasApiError(409, 'CONFLICT', conflicts.map((c) => `${c.label}: ${c.reason}`).join('; '), {
      changes: conflicts,
    });
  }

  const destructive = plan.changes.filter((change) => change.destructive);

  if (destructive.length > 0 && !options.allowDestructive) {
    throw new DeviasApiError(
      409,
      'DESTRUCTIVE_CHANGE',
      `The plan contains ${destructive.length} destructive change(s); pass allowDestructive to apply them`,
      { changes: destructive },
    );
  }

  const ctx = createContext(store, manifest);
  const now = store.now();
  const applied: PlanChange[] = [];
  const of = (kind: PlanChange['kind'], action: PlanChange['action']): PlanChange[] =>
    plan.changes.filter((change) => change.kind === kind && change.action === action);
  const defs = {
    objects: ctx.manifestObjects,
    fields: byId(ctx.fields),
    views: byId(manifest.views),
    layouts: byId(manifest.layouts),
    navItems: byId(manifest.navItems),
    commandItems: byId(manifest.commandItems),
  };
  const workspaceId = store.workspaceId;
  const moduleId = manifest.id;

  // Creates and updates, parents first.
  for (const change of of('object', 'create')) {
    const def = defs.objects.get(change.id);

    if (!def) {
      continue;
    }

    const row: ObjectMetadata = compact({
      workspaceId,
      id: def.id,
      ...objectAttrs(def),
      isSystem: false,
      readOnly: false,
      createdAt: now,
      updatedAt: now,
      moduleId,
    }) as ObjectMetadata;
    store.objects.set(row.id, row);
    applied.push(change);
  }

  for (const change of of('object', 'update')) {
    const def = defs.objects.get(change.id);
    const row = store.objectById(change.id);

    if (!def || !row) {
      continue;
    }

    assignAttrs(row, objectAttrs(def));
    row.updatedAt = now;
    applied.push(change);
  }

  store.touch();

  const fieldChanges = new Map(plan.changes.filter((c) => c.kind === 'field').map((c) => [c.id, c]));
  ctx.fields.forEach((def, index) => {
    const change = fieldChanges.get(def.id);

    if (!change) {
      return;
    }

    if (change.action === 'create') {
      const object = objectRow(ctx, def.objectId);

      if (!object) {
        return;
      }

      const row: FieldMetadata = compact({
        workspaceId,
        objectId: object.id,
        id: def.id,
        ...fieldAttrs(ctx, def, undefined, index),
        moduleId,
      }) as FieldMetadata;
      store.fields.set(row.id, row);
      applied.push(change);
    } else if (change.action === 'update') {
      const row = store.fieldById(def.id);

      if (!row) {
        return;
      }

      assignAttrs(row, fieldAttrs(ctx, def, row, index));
      applied.push(change);
    }
  });
  store.touch();

  const upsert = <TDef extends { id: string }, TRow extends { id: string }>(
    kind: PlanChange['kind'],
    kindDefs: Map<string, TDef>,
    rows: Map<string, TRow>,
    attrs: (def: TDef, existing?: TRow) => Attrs,
    extra: (def: TDef) => Attrs,
  ) => {
    for (const change of of(kind, 'create')) {
      const def = kindDefs.get(change.id);

      if (!def) {
        continue;
      }

      const row = compact({
        workspaceId,
        id: def.id,
        ...attrs(def),
        ...extra(def),
        moduleId,
      }) as unknown as TRow;
      rows.set(row.id, row);
      applied.push(change);
    }

    for (const change of of(kind, 'update')) {
      const def = kindDefs.get(change.id);
      const row = byId(rows.values()).get(change.id);

      if (!def || !row) {
        continue;
      }

      assignAttrs(row, attrs(def, row));
      applied.push(change);
    }

    store.touch();
  };
  const objectIdOf = (def: { objectId: string }): Attrs => ({ objectId: objectRow(ctx, def.objectId)?.id });
  upsert('view', defs.views, store.views, (def, existing) => viewAttrs(ctx, def, existing), objectIdOf);
  upsert(
    'layout',
    defs.layouts,
    store.layouts,
    (def) => layoutAttrs(ctx, def),
    (def) => ({
      ...objectIdOf(def),
      kind: 'record',
    }),
  );
  upsert(
    'nav_item',
    defs.navItems,
    store.navItems,
    (def, existing) => ({
      ...navAttrs(def),
      ...(def.position === undefined && !existing
        ? { position: [...store.navItems.values()].reduce((max, row) => Math.max(max, row.position + 1), 0) }
        : {}),
    }),
    () => ({ parentId: null, overrides: null }),
  );
  // Sub menus: a nav item names the item it sits under by id; the row keeps that item's id.
  const navRows = byId(store.navItems.values());

  for (const def of defs.navItems.values()) {
    const row = navRows.get(def.id);
    const parent = def.parentId ? navRows.get(def.parentId) : undefined;

    if (row) {
      row.parentId = parent?.id ?? null;
    }
  }

  upsert('command_item', defs.commandItems, store.commandItems, commandAttrs, () => ({}));
  // Deletes, children first.
  const deleteRows = <TRow extends { id: string }>(kind: PlanChange['kind'], rows: Map<string, TRow>) => {
    const index = byId(rows.values());

    for (const change of of(kind, 'delete')) {
      const row = index.get(change.id);

      if (!row) {
        continue;
      }

      rows.delete(row.id);
      applied.push(change);
    }
  };
  deleteRows('command_item', store.commandItems);
  deleteRows('nav_item', store.navItems);
  deleteRows('layout', store.layouts);
  deleteRows('view', store.views);
  deleteRows('field', store.fields);

  for (const change of of('object', 'delete')) {
    const row = store.objectById(change.id);

    if (!row) {
      continue;
    }

    for (const field of [...store.fields.values()]) {
      if (field.objectId === row.id) {
        store.fields.delete(field.id);
      }
    }

    for (const view of [...store.views.values()]) {
      if (view.objectId === row.id) {
        store.views.delete(view.id);
      }
    }

    for (const layout of [...store.layouts.values()]) {
      if (layout.objectId === row.id) {
        store.layouts.delete(layout.id);
      }
    }

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

    store.records.delete(row.id);
    store.objects.delete(row.id);
    applied.push(change);
  }

  store.touch();

  const existing = store.modules.get(moduleId);
  const changed =
    applied.length > 0 ||
    mode.uninstall === true ||
    !existing ||
    existing.version !== manifest.version ||
    existing.manifestHash !== plan.manifestHash;

  if (mode.uninstall) {
    store.modules.delete(moduleId);

    for (const connection of [...store.connections.values()]) {
      if (connection.moduleId === moduleId) {
        store.connections.delete(connection.id);
      }
    }

    store.moduleVariables.delete(moduleId);
    store.moduleEvents = store.moduleEvents.filter((event) => event.moduleId !== moduleId);
  } else {
    store.modules.set(moduleId, {
      moduleId,
      version: manifest.version,
      manifestHash: plan.manifestHash,
      installedAt: existing?.installedAt ?? now,
      updatedAt: changed ? now : (existing?.updatedAt ?? now),
      ...declarationsOf(manifest),
    });
  }

  if (changed) {
    const metadataVersion = store.bumpVersion();
    store.emit({ type: 'metadata.changed', entity: 'module', entityId: moduleId, metadataVersion });

    if (!mode.uninstall) {
      store.emit({ type: 'module.applied', moduleId, version: manifest.version, metadataVersion });
    }

    store.changed();
  }

  return {
    moduleId,
    version: manifest.version,
    manifestHash: plan.manifestHash,
    metadataVersion: store.version,
    applied,
  };
};

/** Uninstall = apply an empty manifest for the module, then drop its row. */
export const uninstallModule = (store: MockStore, moduleId: string, options: ApplyOptions = {}): ApplyResult => {
  const installed = store.modules.get(moduleId);

  if (!installed) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Module "${moduleId}" is not installed`);
  }

  if (installed.core) {
    throw new DeviasApiError(409, 'CONFLICT', `"${moduleId}" is part of the product and cannot be uninstalled`);
  }

  const empty = parseManifest({ id: moduleId, version: installed.version });

  return applyManifest(store, empty, options, { uninstall: true });
};
