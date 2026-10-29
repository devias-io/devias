import {
  API_NAME_PATTERN,
  availableBlocks,
  blockRefProblem,
  type CommandItem,
  type CommandItemInput,
  CommandItemInputSchema,
  type FieldInput,
  FieldInputSchema,
  type FieldMetadata,
  fieldRef,
  isObjectKey,
  LAYOUT_CONTENT_KEYS,
  type Layout,
  type LayoutAction,
  type LayoutInput,
  LayoutInputSchema,
  layoutActionProblem,
  layoutCells,
  layoutContentOf,
  layoutShapeProblem,
  mapFilterFields,
  mergeLayoutPatch,
  type NavEdit,
  NavEditError,
  type NavItem,
  type NavItemInput,
  NavItemInputSchema,
  type NavOverrides,
  navEdit,
  navParentOf,
  type ObjectInput,
  ObjectInputSchema,
  type ObjectMetadata,
  RESERVED_FIELD_NAMES,
  RESERVED_OBJECT_NAMES,
  refersToObject,
  settingsSchemaForFieldType,
  systemFieldId,
  type ViewConfig,
  ViewConfigSchema,
  type ViewInput,
  ViewInputSchema,
  type ViewMetadata,
  valueSchemaForField,
} from '@devias/core';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DataSource } from '../datasource/interface';
import { type Db, runRaw, toNumber } from '../db/exec';
import * as t from '../db/schema';
import { EngineError, fromZodError, notFound, validationError } from '../errors';
import {
  toCommandItem,
  toFieldMetadata,
  toInstalledModule,
  toLayout,
  toNavItem,
  toObjectMetadata,
  toViewMetadata,
} from './rows';

/** A metadata row's id and who owns it: a module or the workspace (a uuid either way; the owner is the `moduleId` column). */
export interface Ownership {
  id: string;
  moduleId: string | null;
}

export interface MetadataStoreDeps {
  dataSource: DataSource;
  clock: () => Date;
}

const TYPE_FAMILY: Record<string, string> = {
  text: 'string',
  email: 'string',
  url: 'string',
  phone: 'string',
  number: 'numeric',
  currency: 'numeric',
};

/** text↔email/url/phone and number↔currency keep their data; everything else drops it. */
export const isCompatibleTypeChange = (from: string, to: string): boolean =>
  from === to || (TYPE_FAMILY[from] !== undefined && TYPE_FAMILY[from] === TYPE_FAMILY[to]);

export const relationTargetOf = (settings: Record<string, unknown> | undefined): string | undefined => {
  const target = settings?.targetObjectId;

  return typeof target === 'string' ? target : undefined;
};

const parseInput = <T>(schema: z.ZodType<T>, input: unknown, what: string): T => {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw fromZodError(result.error, `Invalid ${what}`);
  }

  return result.data;
};

/** Present keys win (an explicit `undefined` clears), absent keys keep the current value. */
const has = <T extends object>(patch: T, key: keyof T): boolean => Object.hasOwn(patch, key);
const pick = <T extends object, K extends keyof T>(patch: T, key: K, fallback: T[K]): T[K] =>
  has(patch, key) ? patch[key] : fallback;

/** View configs from JSON clients mark cleared keys (filter, groupBy) with `null`; drop them like `undefined`. */
const withoutNulls = (config: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(config).filter(([, value]) => value !== null));

export const createMetadataStore = ({ dataSource, clock }: MetadataStoreDeps) => {
  // --- lookups -------------------------------------------------------------------------------

  const getObject = async (db: Db, workspaceId: string, id: string): Promise<ObjectMetadata | undefined> => {
    const rows = await db
      .select()
      .from(t.objectMetadata)
      .where(and(eq(t.objectMetadata.workspaceId, workspaceId), eq(t.objectMetadata.id, id)));

    return rows[0] ? toObjectMetadata(rows[0]) : undefined;
  };

  /**
   * The object an `objectId` input names: its id, or its API name or plural name, the way the studio, the agent and
   * manifests refer to objects.
   */
  const requireObject = async (db: Db, workspaceId: string, key: string): Promise<ObjectMetadata> => {
    const rows = await db.select().from(t.objectMetadata).where(eq(t.objectMetadata.workspaceId, workspaceId));
    const object = rows.map(toObjectMetadata).find((o) => isObjectKey(key, o));

    if (!object) {
      throw notFound('Object', key);
    }

    return object;
  };

  /** An object's fields in this workspace: a module's ids are the same in every workspace that installs it. */
  const objectFields = async (db: Db, workspaceId: string, objectId: string): Promise<FieldMetadata[]> =>
    (
      await db
        .select()
        .from(t.fieldMetadata)
        .where(and(eq(t.fieldMetadata.workspaceId, workspaceId), eq(t.fieldMetadata.objectId, objectId)))
    ).map(toFieldMetadata);

  /**
   * The primary field must be one of the object's own fields. Checked when the workspace sets it (the service), not when a
   * module installs: its object is written before its fields, which the same install creates.
   */
  const checkPrimaryField = async (
    db: Db,
    workspaceId: string,
    objectId: string,
    primaryFieldId: string | null | undefined,
  ): Promise<void> => {
    if (primaryFieldId === undefined || primaryFieldId === null) {
      return;
    }

    const fields = await objectFields(db, workspaceId, objectId);

    if (!fields.some((f) => f.id === primaryFieldId)) {
      throw validationError(
        `"${primaryFieldId}" is not a field of this object. Its fields: ${fields.map((f) => `${f.name} (${f.id})`).join(', ') || 'none yet'}`,
        { primaryFieldId },
      );
    }
  };

  const ensureObjectNameFree = async (db: Db, workspaceId: string, name: string, exceptId?: string) => {
    if (RESERVED_OBJECT_NAMES.has(name)) {
      throw validationError(
        `"${name}" is a reserved object name: the platform uses it for its own things. Pick another API name; the label can still be the same.`,
        { name },
      );
    }

    const rows = await db
      .select({ id: t.objectMetadata.id })
      .from(t.objectMetadata)
      .where(
        and(
          eq(t.objectMetadata.workspaceId, workspaceId),
          eq(t.objectMetadata.nameSingular, name),
          exceptId ? ne(t.objectMetadata.id, exceptId) : undefined,
        ),
      );

    if (rows.length > 0) {
      throw new EngineError('CONFLICT', `An object named "${name}" already exists`, { name });
    }
  };

  const ensureFieldNameFree = async (
    db: Db,
    workspaceId: string,
    objectId: string,
    name: string,
    exceptId?: string,
  ) => {
    if (RESERVED_FIELD_NAMES.has(name)) {
      throw validationError(`"${name}" is a reserved field name`, { name });
    }

    const rows = await db
      .select({ id: t.fieldMetadata.id })
      .from(t.fieldMetadata)
      .where(
        and(
          eq(t.fieldMetadata.workspaceId, workspaceId),
          eq(t.fieldMetadata.objectId, objectId),
          eq(t.fieldMetadata.name, name),
          exceptId ? ne(t.fieldMetadata.id, exceptId) : undefined,
        ),
      );

    if (rows.length > 0) {
      throw new EngineError('CONFLICT', `A field named "${name}" already exists on this object`, { name });
    }
  };

  const ID_TABLES = new Set(['object_metadata', 'field_metadata', 'view', 'layout', 'nav_item', 'command_item']);

  const ensureIdFree = async (db: Db, workspaceId: string, table: string, id: string) => {
    if (!ID_TABLES.has(table)) {
      throw new Error(`Unknown metadata table "${table}"`);
    }

    const rows = await runRaw<{ n: unknown }>(
      db,
      sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${table}"`)} WHERE workspace_id = ${workspaceId} AND id = ${id}`,
    );

    if (toNumber(rows[0]?.n ?? 0) > 0) {
      throw new EngineError('CONFLICT', `Id "${id}" is already in use`, { id });
    }
  };

  const validateFieldShape = async (
    db: Db,
    workspaceId: string,
    field: { name: string; type: string; settings: Record<string, unknown>; defaultValue: unknown },
  ) => {
    if (!API_NAME_PATTERN.test(field.name)) {
      throw validationError(`Invalid field name "${field.name}"`, { name: field.name });
    }

    const settingsResult = settingsSchemaForFieldType(field.type).safeParse(field.settings);

    if (!settingsResult.success) {
      throw fromZodError(settingsResult.error, `Invalid settings for field type "${field.type}"`);
    }

    if (field.type === 'relation') {
      const target = relationTargetOf(settingsResult.data);

      if (!target || !(await getObject(db, workspaceId, target))) {
        throw validationError(`Relation target object "${target ?? ''}" does not exist`, { targetObjectId: target });
      }
    }

    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      const valueResult = valueSchemaForField({ type: field.type, settings: settingsResult.data }).safeParse(
        field.defaultValue,
      );

      if (!valueResult.success) {
        throw fromZodError(valueResult.error, `Invalid default value for field "${field.name}"`);
      }
    }

    return settingsResult.data;
  };

  /**
   * The view config with every field it names stored as the field's id: the studio sends ids, the agent and the API may
   * send API names. A reference to no field of the object is refused; a system column (`created_at`) stays its name.
   */
  const normalizeViewConfig = async (
    db: Db,
    workspaceId: string,
    objectId: string,
    config: ViewConfig,
  ): Promise<ViewConfig> => {
    const fields = await objectFields(db, workspaceId, objectId);
    const resolve = (ref: string, where: string): string => {
      const id = fieldRef(fields, ref)?.id ?? systemFieldId(ref);

      if (id) {
        return id;
      }

      throw validationError(`View ${where} references unknown field "${ref}"`, { field: ref });
    };

    return {
      ...config,
      fields: config.fields.map((f) => ({ ...f, fieldId: resolve(f.fieldId, 'fields') })),
      sorts: config.sorts.map((s) => ({ ...s, fieldId: resolve(s.fieldId, 'sorts') })),
      ...(config.groupById ? { groupById: resolve(config.groupById, 'groupById') } : {}),
      ...(config.filter ? { filter: mapFilterFields(config.filter, (name) => resolve(name, 'filter')) } : {}),
    };
  };

  const syncObjectPermission = async (db: Db, workspaceId: string, objectId: string, readOnly: boolean) => {
    await db
      .delete(t.objectPermission)
      .where(and(eq(t.objectPermission.workspaceId, workspaceId), eq(t.objectPermission.objectId, objectId)));

    if (readOnly) {
      await db
        .insert(t.objectPermission)
        .values(['member', 'api_key'].map((role) => ({ workspaceId, objectId, role, canRead: true, canWrite: false })));
    }
  };

  // --- objects -------------------------------------------------------------------------------

  const insertObject = async (
    tx: Db,
    workspaceId: string,
    rawInput: ObjectInput,
    own: Ownership,
    extra: { isSystem?: boolean } = {},
  ): Promise<ObjectMetadata> => {
    const input = parseInput(ObjectInputSchema, rawInput, 'object');
    await ensureObjectNameFree(tx, workspaceId, input.nameSingular);
    await ensureIdFree(tx, workspaceId, 'object_metadata', own.id);
    const now = clock();
    const rows = await tx
      .insert(t.objectMetadata)
      .values({
        workspaceId,
        id: own.id,
        nameSingular: input.nameSingular,
        namePlural: input.namePlural,
        labelSingular: input.labelSingular,
        labelPlural: input.labelPlural,
        icon: input.icon ?? null,
        description: input.description ?? null,
        primaryFieldId: input.primaryFieldId ?? null,
        isSystem: extra.isSystem ?? false,
        readOnly: input.readOnly ?? false,
        deleteWhen: input.deleteWhen ?? null,
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    if (input.readOnly) {
      await syncObjectPermission(tx, workspaceId, row.id, true);
    }

    return toObjectMetadata(row);
  };

  const updateObject = async (
    tx: Db,
    workspaceId: string,
    current: ObjectMetadata,
    patch: Partial<ObjectInput>,
  ): Promise<ObjectMetadata> => {
    const merged = parseInput(
      ObjectInputSchema,
      {
        nameSingular: pick(patch, 'nameSingular', current.nameSingular),
        namePlural: pick(patch, 'namePlural', current.namePlural),
        labelSingular: pick(patch, 'labelSingular', current.labelSingular),
        labelPlural: pick(patch, 'labelPlural', current.labelPlural),
        icon: pick(patch, 'icon', current.icon),
        description: pick(patch, 'description', current.description),
        primaryFieldId: pick(patch, 'primaryFieldId', current.primaryFieldId),
        readOnly: pick(patch, 'readOnly', current.readOnly),
        deleteWhen: pick(patch, 'deleteWhen', current.deleteWhen),
      },
      'object',
    );

    if (merged.nameSingular !== current.nameSingular) {
      await ensureObjectNameFree(tx, workspaceId, merged.nameSingular, current.id);
    }

    const rows = await tx
      .update(t.objectMetadata)
      .set({
        nameSingular: merged.nameSingular,
        namePlural: merged.namePlural,
        labelSingular: merged.labelSingular,
        labelPlural: merged.labelPlural,
        icon: merged.icon ?? null,
        description: merged.description ?? null,
        primaryFieldId: merged.primaryFieldId ?? null,
        readOnly: merged.readOnly ?? false,
        deleteWhen: merged.deleteWhen ?? null,
        updatedAt: clock(),
      })
      .where(and(eq(t.objectMetadata.workspaceId, workspaceId), eq(t.objectMetadata.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Object', current.id);
    }

    if ((merged.readOnly ?? false) !== current.readOnly) {
      await syncObjectPermission(tx, workspaceId, current.id, merged.readOnly ?? false);
    }

    return toObjectMetadata(row);
  };

  const deleteObject = async (tx: Db, workspaceId: string, current: ObjectMetadata): Promise<void> => {
    await dataSource.onObjectDeleted(tx, workspaceId, current.id);
    // Fields, views and layouts cascade through their objectId; nav items and command items name the object inside
    // their target, so they would be left pointing nowhere.
    const navItems = (await tx.select().from(t.navItem).where(eq(t.navItem.workspaceId, workspaceId))).map(toNavItem);
    const staleNav = navItems.filter((item) => refersToObject(item.target, current)).map((item) => item.id);

    if (staleNav.length > 0) {
      await tx.delete(t.navItem).where(and(eq(t.navItem.workspaceId, workspaceId), inArray(t.navItem.id, staleNav)));
    }

    const commandItems = (await tx.select().from(t.commandItem).where(eq(t.commandItem.workspaceId, workspaceId))).map(
      toCommandItem,
    );
    const staleCommands = commandItems.filter((item) => refersToObject(item.action, current)).map((item) => item.id);

    if (staleCommands.length > 0) {
      await tx
        .delete(t.commandItem)
        .where(and(eq(t.commandItem.workspaceId, workspaceId), inArray(t.commandItem.id, staleCommands)));
    }

    await tx
      .delete(t.objectMetadata)
      .where(and(eq(t.objectMetadata.workspaceId, workspaceId), eq(t.objectMetadata.id, current.id)));
  };

  // --- fields --------------------------------------------------------------------------------

  const insertField = async (
    tx: Db,
    workspaceId: string,
    rawInput: FieldInput,
    own: Ownership,
  ): Promise<FieldMetadata> => {
    const input = parseInput(FieldInputSchema, rawInput, 'field');
    const { id: objectId } = await requireObject(tx, workspaceId, input.objectId);
    await ensureFieldNameFree(tx, workspaceId, objectId, input.name);
    await ensureIdFree(tx, workspaceId, 'field_metadata', own.id);
    const settings = await validateFieldShape(tx, workspaceId, {
      name: input.name,
      type: input.type,
      settings: input.settings ?? {},
      defaultValue: input.defaultValue,
    });
    const now = clock();
    const rows = await tx
      .insert(t.fieldMetadata)
      .values({
        workspaceId,
        objectId,
        id: own.id,
        name: input.name,
        type: input.type,
        label: input.label,
        description: input.description ?? null,
        icon: input.icon ?? null,
        settings,
        isRequired: input.isRequired ?? false,
        isUnique: input.isUnique ?? false,
        defaultValue: input.defaultValue === undefined ? null : input.defaultValue,
        position: input.position ?? 0,
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    const field = toFieldMetadata(row);
    await dataSource.onFieldCreated(tx, workspaceId, field);

    return field;
  };

  const updateField = async (
    tx: Db,
    workspaceId: string,
    current: FieldMetadata,
    patch: Partial<FieldInput>,
    options: { force?: boolean } = {},
  ): Promise<FieldMetadata> => {
    const merged = parseInput(
      FieldInputSchema,
      {
        objectId: current.objectId,
        name: pick(patch, 'name', current.name),
        type: pick(patch, 'type', current.type),
        label: pick(patch, 'label', current.label),
        description: pick(patch, 'description', current.description),
        icon: pick(patch, 'icon', current.icon),
        settings: pick(patch, 'settings', current.settings) ?? {},
        isRequired: pick(patch, 'isRequired', current.isRequired) ?? false,
        isUnique: pick(patch, 'isUnique', current.isUnique) ?? false,
        defaultValue: pick(patch, 'defaultValue', current.defaultValue),
        position: pick(patch, 'position', current.position) ?? 0,
      },
      'field',
    );

    if (merged.name !== current.name) {
      await ensureFieldNameFree(tx, workspaceId, current.objectId, merged.name, current.id);
    }

    const settings = await validateFieldShape(tx, workspaceId, {
      name: merged.name,
      type: merged.type,
      settings: merged.settings ?? {},
      defaultValue: merged.defaultValue,
    });
    const typeIncompatible = !isCompatibleTypeChange(current.type, merged.type);
    const targetChanged =
      merged.type === 'relation' &&
      current.type === 'relation' &&
      relationTargetOf(current.settings) !== relationTargetOf(settings);
    const dropData = typeIncompatible || targetChanged;

    if (dropData && !options.force) {
      throw new EngineError(
        'DESTRUCTIVE_CHANGE',
        typeIncompatible
          ? `Changing field "${current.name}" from ${current.type} to ${merged.type} would drop its data`
          : `Changing the relation target of "${current.name}" would drop its data`,
        { field: current.name },
      );
    }

    const rows = await tx
      .update(t.fieldMetadata)
      .set({
        name: merged.name,
        type: merged.type,
        label: merged.label,
        description: merged.description ?? null,
        icon: merged.icon ?? null,
        settings,
        isRequired: merged.isRequired ?? false,
        isUnique: merged.isUnique ?? false,
        defaultValue: merged.defaultValue === undefined ? null : merged.defaultValue,
        position: merged.position ?? 0,
        updatedAt: clock(),
      })
      .where(and(eq(t.fieldMetadata.workspaceId, workspaceId), eq(t.fieldMetadata.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Field', current.id);
    }

    const after = toFieldMetadata(row);
    await dataSource.onFieldChanged(tx, workspaceId, { before: current, after, dropData });

    return after;
  };

  const deleteField = async (tx: Db, workspaceId: string, current: FieldMetadata): Promise<void> => {
    await dataSource.onFieldDeleted(tx, workspaceId, current);
    await tx
      .delete(t.fieldMetadata)
      .where(and(eq(t.fieldMetadata.workspaceId, workspaceId), eq(t.fieldMetadata.id, current.id)));
  };

  // --- views ---------------------------------------------------------------------------------

  const insertView = async (
    tx: Db,
    workspaceId: string,
    rawInput: ViewInput,
    own: Ownership,
  ): Promise<ViewMetadata> => {
    const input = parseInput(ViewInputSchema, rawInput, 'view');
    const { id: objectId } = await requireObject(tx, workspaceId, input.objectId);
    await ensureIdFree(tx, workspaceId, 'view', own.id);
    const config = await normalizeViewConfig(
      tx,
      workspaceId,
      objectId,
      ViewConfigSchema.parse(withoutNulls(input.config ?? {})),
    );
    const now = clock();
    const rows = await tx
      .insert(t.view)
      .values({
        workspaceId,
        objectId,
        id: own.id,
        label: input.label,
        type: input.type ?? 'table',
        icon: input.icon ?? null,
        isDefault: input.isDefault ?? false,
        position: input.position ?? 0,
        config,
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    return toViewMetadata(row);
  };

  /**
   * Show a field in its object's default table, so a new field is seen at once. Only the workspace's own table: a
   * module's view is the module's, and a field of the workspace's must not make its plan drift.
   */
  const addFieldToDefaultView = async (tx: Db, workspaceId: string, field: FieldMetadata): Promise<void> => {
    const rows = await tx
      .select()
      .from(t.view)
      .where(and(eq(t.view.workspaceId, workspaceId), eq(t.view.objectId, field.objectId), eq(t.view.isDefault, true)));
    const view = rows[0] ? toViewMetadata(rows[0]) : undefined;

    if (!view || view.moduleId !== null || view.config.fields.some((one) => one.fieldId === field.id)) {
      return;
    }

    await updateView(tx, workspaceId, view, {
      config: { ...view.config, fields: [...view.config.fields, { fieldId: field.id, visible: true }] },
    });
  };

  const updateView = async (
    tx: Db,
    workspaceId: string,
    current: ViewMetadata,
    patch: Partial<ViewInput>,
  ): Promise<ViewMetadata> => {
    const merged = parseInput(
      ViewInputSchema,
      {
        objectId: pick(patch, 'objectId', current.objectId),
        label: pick(patch, 'label', current.label),
        type: pick(patch, 'type', current.type),
        icon: pick(patch, 'icon', current.icon),
        isDefault: pick(patch, 'isDefault', current.isDefault),
        position: pick(patch, 'position', current.position),
        config: has(patch, 'config') ? withoutNulls({ ...current.config, ...(patch.config ?? {}) }) : current.config,
      },
      'view',
    );
    const objectId =
      merged.objectId === current.objectId
        ? current.objectId
        : (await requireObject(tx, workspaceId, merged.objectId)).id;
    const config = await normalizeViewConfig(tx, workspaceId, objectId, ViewConfigSchema.parse(merged.config ?? {}));
    const rows = await tx
      .update(t.view)
      .set({
        objectId,
        label: merged.label,
        type: merged.type,
        icon: merged.icon ?? null,
        isDefault: merged.isDefault ?? false,
        position: merged.position ?? 0,
        config,
        updatedAt: clock(),
      })
      .where(and(eq(t.view.workspaceId, workspaceId), eq(t.view.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('View', current.id);
    }

    return toViewMetadata(row);
  };

  const deleteView = async (tx: Db, workspaceId: string, current: ViewMetadata): Promise<void> => {
    await tx.delete(t.view).where(and(eq(t.view.workspaceId, workspaceId), eq(t.view.id, current.id)));
  };

  // --- layouts --------------------------------------------------------------------------

  /**
   * Every cell names a declared record block (see `blockRefProblem`): a guessed id would render "Unknown block" on the
   * record page. `moduleId` is the module writing the layout, whose own blocks its plan already checked.
   */
  const validateLayoutBlocks = async (db: Db, workspaceId: string, layout: LayoutInput, moduleId: string | null) => {
    const installed = (await db.select().from(t.module).where(eq(t.module.workspaceId, workspaceId))).map(
      toInstalledModule,
    );
    const available = availableBlocks(installed);

    for (const { where, tab, cell } of layoutCells(layout)) {
      const problem = blockRefProblem(cell.blockId, available, moduleId, cell.optional);

      if (problem) {
        throw validationError(`${where}, cell "${cell.name}": ${problem}`, {
          where,
          ...(tab ? { tab: tab.name } : {}),
          cell: cell.name,
          blockId: cell.blockId,
        });
      }
    }
  };

  /**
   * Every action a workspace's layout offers is one an installed module declares, with a field for the record's id. A
   * module's own layout is checked by its manifest, and may name actions of modules installed after it.
   */
  const validateLayoutActions = async (
    db: Db,
    workspaceId: string,
    actions: LayoutAction[] | undefined,
    objectAddress: string,
    moduleId: string | null,
  ) => {
    if (!actions || moduleId !== null) {
      return;
    }

    const installed = (await db.select().from(t.module).where(eq(t.module.workspaceId, workspaceId))).map(
      toInstalledModule,
    );

    for (const entry of actions) {
      const problem = layoutActionProblem(entry, installed, objectAddress);

      if (problem) {
        throw validationError(`Actions: ${problem}`, { action: entry.actionId });
      }
    }
  };

  /** A shape holds exactly its own keys; say what to change, so the caller can fix it. */
  const ensureShapeFits = (layout: LayoutInput) => {
    const problem = layoutShapeProblem(layout);

    if (problem) {
      throw validationError(problem, { shell: layout.shell });
    }
  };

  const insertLayout = async (tx: Db, workspaceId: string, rawInput: LayoutInput, own: Ownership): Promise<Layout> => {
    const input = parseInput(LayoutInputSchema, rawInput, 'layout');
    const { id: objectId, id: objectAddress } = await requireObject(tx, workspaceId, input.objectId);
    ensureShapeFits(input);
    await validateLayoutBlocks(tx, workspaceId, input, own.moduleId);
    await validateLayoutActions(tx, workspaceId, input.actions, objectAddress, own.moduleId);
    await ensureIdFree(tx, workspaceId, 'layout', own.id);
    const now = clock();
    const rows = await tx
      .insert(t.layout)
      .values({
        workspaceId,
        objectId,
        id: own.id,
        label: input.label,
        kind: 'record',
        shell: input.shell,
        isDefault: input.isDefault ?? false,
        content: layoutContentOf(input),
        actions: input.actions ?? [],
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    return toLayout(row);
  };

  const updateLayout = async (
    tx: Db,
    workspaceId: string,
    current: Layout,
    patch: Partial<LayoutInput>,
  ): Promise<Layout> => {
    const merged = parseInput(LayoutInputSchema, mergeLayoutPatch(current, patch), 'layout');
    ensureShapeFits(merged);
    const { id: objectId, id: objectAddress } = await requireObject(tx, workspaceId, merged.objectId);
    const touchesContent = patch.shell !== undefined || LAYOUT_CONTENT_KEYS.some((key) => has(patch, key));

    // Only a changed layout's cells are checked, so one saved before a block went away can still be renamed.
    if (touchesContent) {
      await validateLayoutBlocks(tx, workspaceId, merged, current.moduleId);
    }

    // Only new entries are checked, so a layout whose module has since gone can still be renamed. Moving the layout to
    // another object checks them again: they must take a record of that one.
    if (patch.actions !== undefined || patch.objectId !== undefined) {
      await validateLayoutActions(tx, workspaceId, merged.actions, objectAddress, current.moduleId);
    }

    const rows = await tx
      .update(t.layout)
      .set({
        objectId,
        label: merged.label,
        shell: merged.shell,
        isDefault: merged.isDefault ?? false,
        content: layoutContentOf(merged),
        actions: merged.actions ?? [],
        updatedAt: clock(),
      })
      .where(and(eq(t.layout.workspaceId, workspaceId), eq(t.layout.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Layout', current.id);
    }

    return toLayout(row);
  };

  const deleteLayout = async (tx: Db, workspaceId: string, current: Layout): Promise<void> => {
    await tx.delete(t.layout).where(and(eq(t.layout.workspaceId, workspaceId), eq(t.layout.id, current.id)));
  };

  // --- nav items -----------------------------------------------------------------------------

  const ensureNavParent = async (tx: Db, workspaceId: string, parentId: string | null | undefined, selfId?: string) => {
    if (!parentId) {
      return;
    }

    if (parentId === selfId) {
      throw validationError('A nav item cannot be its own parent', { parentId });
    }

    const rows = await tx
      .select({ id: t.navItem.id })
      .from(t.navItem)
      .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, parentId)));

    if (rows.length === 0) {
      throw validationError(`Parent nav item "${parentId}" does not exist`, { parentId });
    }
  };

  const insertNavItem = async (
    tx: Db,
    workspaceId: string,
    rawInput: NavItemInput,
    own: Ownership,
  ): Promise<NavItem> => {
    const input = parseInput(NavItemInputSchema, rawInput, 'nav item');
    await ensureIdFree(tx, workspaceId, 'nav_item', own.id);
    await ensureNavParent(tx, workspaceId, input.parentId);
    // No position asked for: the row goes after its siblings, so modules appear in the order they were added.
    let position = input.position;

    if (position === undefined) {
      const siblings = await tx
        .select({ position: t.navItem.position, parentId: t.navItem.parentId })
        .from(t.navItem)
        .where(eq(t.navItem.workspaceId, workspaceId));
      const sameLevel = siblings.filter((row) => (row.parentId ?? null) === (input.parentId ?? null));
      position = sameLevel.length === 0 ? 0 : Math.max(...sameLevel.map((row) => row.position)) + 1;
    }

    const now = clock();
    const rows = await tx
      .insert(t.navItem)
      .values({
        workspaceId,
        id: own.id,
        label: input.label,
        icon: input.icon ?? null,
        target: input.target,
        position,
        parentId: input.parentId ?? null,
        pinned: input.pinned ?? false,
        overrides: input.hidden ? { hidden: true } : null,
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    return toNavItem(row);
  };

  const updateNavItem = async (
    tx: Db,
    workspaceId: string,
    current: NavItem,
    patch: Partial<NavItemInput>,
  ): Promise<NavItem> => {
    const merged = parseInput(
      NavItemInputSchema,
      {
        label: pick(patch, 'label', current.label),
        icon: pick(patch, 'icon', current.icon),
        target: pick(patch, 'target', current.target),
        position: pick(patch, 'position', current.position),
        parentId: pick(patch, 'parentId', current.parentId),
        pinned: pick(patch, 'pinned', current.pinned),
      },
      'nav item',
    );
    await ensureNavParent(tx, workspaceId, merged.parentId, current.id);
    const rows = await tx
      .update(t.navItem)
      .set({
        label: merged.label,
        icon: merged.icon ?? null,
        target: merged.target,
        position: merged.position ?? 0,
        parentId: merged.parentId ?? null,
        pinned: merged.pinned ?? false,
        updatedAt: clock(),
      })
      .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Nav item', current.id);
    }

    return toNavItem(row);
  };

  /** The id of a nav item that exists, for modules that nest one item under another. */
  const navItemIdOf = async (tx: Db, workspaceId: string, id: string): Promise<string | null> => {
    const rows = await tx
      .select({ id: t.navItem.id })
      .from(t.navItem)
      .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, id)));

    return rows[0]?.id ?? null;
  };

  /** A parent may not be the item itself or anything below it. */
  const ensureNoNavCycle = async (tx: Db, workspaceId: string, selfId: string, parentId: string | null) => {
    if (!parentId) {
      return;
    }

    const rows = (await tx.select().from(t.navItem).where(eq(t.navItem.workspaceId, workspaceId))).map(toNavItem);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const seen = new Set<string>();
    let cursor: string | null = parentId;

    while (cursor && !seen.has(cursor)) {
      if (cursor === selfId) {
        throw validationError('A nav item cannot sit under itself or one of its own items');
      }

      seen.add(cursor);
      const next = byId.get(cursor);
      cursor = next ? navParentOf(next) : null;
    }
  };

  const writeNavOverrides = async (
    tx: Db,
    workspaceId: string,
    current: NavItem,
    overrides: NavOverrides | null,
  ): Promise<NavItem> => {
    const rows = await tx
      .update(t.navItem)
      .set({ overrides: overrides && Object.keys(overrides).length > 0 ? overrides : null, updatedAt: clock() })
      .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Nav item', current.id);
    }

    return toNavItem(row);
  };

  /**
   * An edit by the workspace (see `navEdit`): its own items change in place, a module's take the edit as overrides
   * beside the module's values.
   */
  const editNavItem = async (
    tx: Db,
    workspaceId: string,
    current: NavItem,
    patch: Partial<NavItemInput>,
  ): Promise<NavItem> => {
    let edit: NavEdit;

    try {
      edit = navEdit(current, patch);
    } catch (error) {
      if (error instanceof NavEditError) {
        throw validationError(error.message, { id: current.id });
      }

      throw error;
    }

    const newParent = patch.parentId;

    if (newParent !== undefined) {
      if (newParent === current.id) {
        throw validationError('A nav item cannot be its own parent');
      }

      await ensureNavParent(tx, workspaceId, newParent, current.id);
      await ensureNoNavCycle(tx, workspaceId, current.id, newParent);
    }

    let row = current;

    if (Object.keys(edit.columns).length > 0) {
      row = await updateNavItem(tx, workspaceId, row, edit.columns);
    }

    if (JSON.stringify(edit.overrides) !== JSON.stringify(row.overrides)) {
      row = await writeNavOverrides(tx, workspaceId, row, edit.overrides);
    }

    return row;
  };

  /** Drop the workspace's overrides of an item: it shows as the module defines it again. */
  const resetNavItem = (tx: Db, workspaceId: string, current: NavItem): Promise<NavItem> =>
    writeNavOverrides(tx, workspaceId, current, null);

  /**
   * Back to the defaults: every override cleared. The items the workspace made are kept.
   */
  const resetAllNavItems = async (tx: Db, workspaceId: string): Promise<NavItem[]> => {
    await tx
      .update(t.navItem)
      .set({ overrides: null, updatedAt: clock() })
      .where(eq(t.navItem.workspaceId, workspaceId));
    const left = await tx.select().from(t.navItem).where(eq(t.navItem.workspaceId, workspaceId));

    return left.map(toNavItem);
  };

  /** Place several items at once; all of it or none of it. */
  const arrangeNavItems = async (
    tx: Db,
    workspaceId: string,
    moves: { id: string; parentId: string | null; position: number }[],
  ): Promise<NavItem[]> => {
    for (const move of moves) {
      const rows = await tx
        .select()
        .from(t.navItem)
        .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, move.id)));
      const row = rows[0];

      if (!row) {
        throw notFound('Nav item', move.id);
      }

      await editNavItem(tx, workspaceId, toNavItem(row), { parentId: move.parentId, position: move.position });
    }

    const all = await tx.select().from(t.navItem).where(eq(t.navItem.workspaceId, workspaceId));

    return all.map(toNavItem);
  };

  const deleteNavItem = async (tx: Db, workspaceId: string, current: NavItem): Promise<void> => {
    // The items under it move to the top level (no foreign key does it: a composite one cannot null just this column).
    await tx
      .update(t.navItem)
      .set({ parentId: null })
      .where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.parentId, current.id)));
    await tx.delete(t.navItem).where(and(eq(t.navItem.workspaceId, workspaceId), eq(t.navItem.id, current.id)));
  };

  // --- command items -------------------------------------------------------------------------

  const insertCommandItem = async (
    tx: Db,
    workspaceId: string,
    rawInput: CommandItemInput,
    own: Ownership,
  ): Promise<CommandItem> => {
    const input = parseInput(CommandItemInputSchema, rawInput, 'command item');
    await ensureIdFree(tx, workspaceId, 'command_item', own.id);
    const now = clock();
    const rows = await tx
      .insert(t.commandItem)
      .values({
        workspaceId,
        id: own.id,
        label: input.label,
        icon: input.icon ?? null,
        groupName: input.group ?? null,
        shortcut: input.shortcut ?? null,
        action: input.action,
        moduleId: own.moduleId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];

    if (!row) {
      throw new Error('insert returned no row');
    }

    return toCommandItem(row);
  };

  const updateCommandItem = async (
    tx: Db,
    workspaceId: string,
    current: CommandItem,
    patch: Partial<CommandItemInput>,
  ): Promise<CommandItem> => {
    const merged = parseInput(
      CommandItemInputSchema,
      {
        label: pick(patch, 'label', current.label),
        icon: pick(patch, 'icon', current.icon),
        group: pick(patch, 'group', current.group),
        shortcut: pick(patch, 'shortcut', current.shortcut),
        action: pick(patch, 'action', current.action),
      },
      'command item',
    );
    const rows = await tx
      .update(t.commandItem)
      .set({
        label: merged.label,
        icon: merged.icon ?? null,
        groupName: merged.group ?? null,
        shortcut: merged.shortcut ?? null,
        action: merged.action,
        updatedAt: clock(),
      })
      .where(and(eq(t.commandItem.workspaceId, workspaceId), eq(t.commandItem.id, current.id)))
      .returning();
    const row = rows[0];

    if (!row) {
      throw notFound('Command item', current.id);
    }

    return toCommandItem(row);
  };

  const deleteCommandItem = async (tx: Db, workspaceId: string, current: CommandItem): Promise<void> => {
    await tx
      .delete(t.commandItem)
      .where(and(eq(t.commandItem.workspaceId, workspaceId), eq(t.commandItem.id, current.id)));
  };

  return {
    getObject,
    checkPrimaryField,
    insertObject,
    updateObject,
    deleteObject,
    insertField,
    updateField,
    deleteField,
    insertView,
    updateView,
    addFieldToDefaultView,
    deleteView,
    insertLayout,
    updateLayout,
    deleteLayout,
    insertNavItem,
    updateNavItem,
    editNavItem,
    resetNavItem,
    arrangeNavItems,
    resetAllNavItems,
    deleteNavItem,
    navItemIdOf,
    insertCommandItem,
    updateCommandItem,
    deleteCommandItem,
  };
};

export type MetadataStore = ReturnType<typeof createMetadataStore>;
