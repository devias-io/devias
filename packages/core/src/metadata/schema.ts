import { z } from 'zod';
import { IdSchema, ModuleIdSchema } from '../ids';
import { AgentDefinitionSchema, SkillDefinitionSchema } from '../manifest/agents';
import { BlockDeclarationSchema } from '../manifest/blocks';
import { ModuleEnginesSchema, PolicyDefinitionSchema } from '../manifest/consent';
import {
  ActionDefinitionSchema,
  ConnectionProviderSchema,
  EventDefinitionSchema,
  MODULE_KEY_PATTERN,
  VariableDefinitionSchema,
} from '../module-runtime';
import { FilterSchema } from '../query/ir';
import { FilterOpSchema } from './field-types';

/**
 * Workspace metadata: the only model the studio renders. Every row has an `id` that never changes (a uuid; core's own
 * are `coreIds`), and an owner (`moduleId`, or null when created from the settings UI).
 */

export const API_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
export const ApiNameSchema = z
  .string()
  .regex(API_NAME_PATTERN, 'Use lowercase letters, digits and "_", starting with a letter');
export const RESERVED_FIELD_NAMES = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
]);

/** Names no object may take: a mention's `object` for what is not a record (see `links.ts`). */
export const RESERVED_OBJECT_NAMES = new Set(['workflow', 'document', 'task', 'member', 'agent', 'asset']);

const Ownership = {
  moduleId: ModuleIdSchema.nullable(),
};

export const ObjectMetadataSchema = z
  .object({
    workspaceId: z.string(),
    id: IdSchema,
    nameSingular: ApiNameSchema,
    namePlural: ApiNameSchema,
    labelSingular: z.string().min(1),
    labelPlural: z.string().min(1),
    icon: z.string().optional(),
    description: z.string().optional(),
    /** The id of the field whose value names a record: its title in tables, links, search hits and the agent's answers. The first text field when left out. */
    primaryFieldId: IdSchema.optional(),
    isSystem: z.boolean().default(false),
    readOnly: z.boolean().default(false),
    /** A record can be deleted only while it matches this filter (for example `status` is `draft`). Left out: any record. */
    deleteWhen: FilterSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...Ownership,
  })
  .meta({ id: 'ObjectMetadata' });
export type ObjectMetadata = z.infer<typeof ObjectMetadataSchema>;

export const FieldMetadataSchema = z
  .object({
    workspaceId: z.string(),
    objectId: z.string(),
    id: IdSchema,
    name: ApiNameSchema,
    type: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).default({}),
    isRequired: z.boolean().default(false),
    isUnique: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
    position: z.number().int().default(0),
    ...Ownership,
  })
  .meta({ id: 'FieldMetadata' });
export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;

/**
 * A column of a view, by the id of its field. What the agent and the API send may name the field by its API name: the
 * server stores the id. A system column (`id`, `created_at`, `updated_at`) has no field: it is `coreIds.fields.id`, `.created_at` or `.updated_at`.
 */
export const ViewFieldConfigSchema = z.object({
  fieldId: z.string(),
  width: z.number().int().positive().optional(),
  visible: z.boolean().default(true),
});
export type ViewFieldConfig = z.infer<typeof ViewFieldConfigSchema>;

export const ViewSortSchema = z.object({
  fieldId: z.string().min(1),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
export type ViewSort = z.infer<typeof ViewSortSchema>;

/**
 * What a view shows. It names fields by id; a filter condition's `field` is an id too (or an API name, as in any
 * query), and the studio turns them into names when it builds the query.
 */
export const ViewConfigSchema = z.object({
  fields: z.array(ViewFieldConfigSchema).default([]),
  filter: FilterSchema.optional(),
  sorts: z.array(ViewSortSchema).default([]),
  groupById: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type ViewConfig = z.infer<typeof ViewConfigSchema>;

export const ViewMetadataSchema = z
  .object({
    workspaceId: z.string(),
    objectId: z.string(),
    id: IdSchema,
    label: z.string().min(1),
    type: z.string().min(1),
    icon: z.string().optional(),
    isDefault: z.boolean().default(false),
    position: z.number().int().default(0),
    config: ViewConfigSchema,
    ...Ownership,
  })
  .meta({ id: 'ViewMetadata' });
export type ViewMetadata = z.infer<typeof ViewMetadataSchema>;

/** A cell of a record page: which block renders there, with what config. */
export const LayoutCellSchema = z.object({
  /** Tells the cell from the others of its layout (two cells may hold one block): unique in it, and what messages call it. */
  name: z.string().min(1).describe('Names the cell, unique in the layout (a short identifier like `comments`)'),
  /** The heading of the block's card (a small heading in the `column` and `split` shells); none when left out. */
  label: z.string().optional(),
  /** The block's id, as `list_blocks` gives it. */
  blockId: IdSchema.describe(
    // The agent reads this to fill layouts: it cannot see the studio's registry.
    "The block's id, from list_blocks: the record's fields (config.fieldIds lists fields by id or API name, default all), the records whose relation points at this one (config.objectId, config.fieldId (its relation field), optional config.limit), the activity (history), or a record block an installed module declares. list_blocks lists them all with their config.",
  ),
  /** What the block is configured with (see its schema in `list_blocks`); none when left out. */
  config: z.record(z.string(), z.unknown()).optional(),
  /**
   * The page works without this block: when its module is not installed the cell is left out, instead of being refused
   * when the layout is saved or drawn as an "Unknown block". For a module's layout that offers another module's block.
   */
  optional: z.boolean().optional(),
});
export type LayoutCell = z.infer<typeof LayoutCellSchema>;

/** A cell on a tab's 12-column grid: where it sits besides what it holds. */
export const LayoutBlockSchema = LayoutCellSchema.extend({
  /** 12-column grid placement; omitted values stack vertically in order. */
  column: z.number().int().min(1).max(12).optional(),
  columnSpan: z.number().int().min(1).max(12).optional(),
  row: z.number().int().min(1).optional(),
});
export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;

export const LayoutTabSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  blocks: z.array(LayoutBlockSchema).default([]),
});
export type LayoutTab = z.infer<typeof LayoutTabSchema>;

/** An installed module's action as a button on a record page. What the entry leaves out comes from the action itself. */
export const LayoutActionSchema = z
  .object({
    /** The action's id, as `list_modules` shows the installed ones. */
    actionId: z
      .string()
      .min(1)
      .describe("The action's id, as list_modules lists it for each installed module's actions."),
    /**
     * The action's field that takes the record's id. Left out, it is the action's `record` field for this object; name
     * it only when the action has more than one.
     */
    input: z.string().regex(MODULE_KEY_PATTERN).optional(),
    /** The button's label; the action's own `label` by default. */
    label: z.string().min(1).optional(),
    /** The button's icon; the action's own by default. */
    icon: z.string().optional(),
    /** Fill its button; otherwise it is outlined. */
    primary: z.boolean().optional(),
    /** Offer it only for records matching this filter, e.g. an invoice that has been sent. */
    when: FilterSchema.optional(),
  })
  .meta({ id: 'LayoutAction' });
export type LayoutAction = z.infer<typeof LayoutActionSchema>;

/**
 * The shape of a record page, and what a layout holds to fill it. `tabs`: a header, a tab bar and a 12-column grid of
 * blocks per tab (`header`, `tabs`). `column`: one centered column, for things you write in (`blocks`). `split`: a main
 * column with an aside on the right, for a record read like an issue (`main`, `aside`).
 */
export const RECORD_SHELLS = ['tabs', 'column', 'split'] as const;
export const RecordShellSchema = z.enum(RECORD_SHELLS).meta({ id: 'RecordShell' });
export type RecordShell = z.infer<typeof RecordShellSchema>;

/** What a `tabs` layout holds: the block that draws the page header (the object's icon and name when left out), and the tabs. */
export const TabsContentSchema = z.object({ header: LayoutCellSchema.optional(), tabs: z.array(LayoutTabSchema) });
/** What a `column` layout holds: its blocks, top to bottom. */
export const ColumnContentSchema = z.object({ blocks: z.array(LayoutCellSchema) });
/** What a `split` layout holds: the blocks of the main column and of the aside, each top to bottom. */
export const SplitContentSchema = z.object({
  main: z.array(LayoutCellSchema),
  aside: z.array(LayoutCellSchema).default([]),
});

const layoutBase = z.object({
  workspaceId: z.string(),
  objectId: z.string(),
  id: IdSchema,
  label: z.string().min(1),
  kind: z.literal('record').default('record'),
  isDefault: z.boolean().default(false),
  /** The module actions the page offers as buttons, in order: exactly what shows, so an empty list offers none. */
  actions: z.array(LayoutActionSchema).default([]),
  ...Ownership,
});

/** A layout is one of three shapes, and holds exactly what its shape needs. */
export const LayoutSchema = z
  .discriminatedUnion('shell', [
    layoutBase.extend({ shell: z.literal('tabs') }).extend(TabsContentSchema.shape),
    layoutBase.extend({ shell: z.literal('column') }).extend(ColumnContentSchema.shape),
    layoutBase.extend({ shell: z.literal('split') }).extend(SplitContentSchema.shape),
  ])
  .meta({ id: 'Layout' });
export type Layout = z.infer<typeof LayoutSchema>;
export type TabsLayout = Extract<Layout, { shell: 'tabs' }>;
export type ColumnLayout = Extract<Layout, { shell: 'column' }>;
export type SplitLayout = Extract<Layout, { shell: 'split' }>;

/** The layout's own content, whatever its shape: the keys `shell` decides. */
export type LayoutContent =
  | z.infer<typeof TabsContentSchema>
  | z.infer<typeof ColumnContentSchema>
  | z.infer<typeof SplitContentSchema>;

export const NavTargetSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('object'), objectId: z.string(), viewId: z.string().optional() }),
    z.object({ kind: z.literal('page'), pageId: z.string() }),
    z.object({ kind: z.literal('url'), url: z.string(), external: z.boolean().optional() }),
    /** Goes nowhere: a heading that only holds the items nested under it (its children carry the destinations). */
    z.object({ kind: z.literal('group') }),
  ])
  .meta({ id: 'NavTarget' });
export type NavTarget = z.infer<typeof NavTargetSchema>;

/**
 * What a workspace changed about a nav item it did not make, a module's: the label, icon, place and whether it
 * shows. They sit beside the module's own values rather than over them, so a module update brings new items and new
 * values without undoing the workspace's choices; `reset` drops them.
 */
export const NavOverridesSchema = z
  .object({
    label: z.string().min(1).optional(),
    icon: z.string().nullable().optional(),
    position: z.number().int().optional(),
    parentId: z.string().nullable().optional(),
    hidden: z.boolean().optional(),
  })
  .meta({ id: 'NavOverrides' });
export type NavOverrides = z.infer<typeof NavOverridesSchema>;

export const NavItemSchema = z
  .object({
    workspaceId: z.string(),
    id: IdSchema,
    label: z.string().min(1),
    icon: z.string().optional(),
    target: NavTargetSchema,
    position: z.number().int().default(0),
    parentId: z.string().nullable().default(null),
    /** Shown above the sections, whatever the workspace arranged; never arranged in Settings. */
    pinned: z.boolean().default(false),
    /** The workspace's own choices about this item (see `NavOverridesSchema`); null when it made none. */
    overrides: NavOverridesSchema.nullable().default(null),
    ...Ownership,
  })
  .meta({ id: 'NavItem' });
export type NavItem = z.infer<typeof NavItemSchema>;

/** A nav item as the sidebar shows it: the module's values with the workspace's overrides on top. */
export type EffectiveNavItem = Omit<NavItem, 'overrides'> & { hidden: boolean; overridden: boolean };

export const effectiveNavItem = (item: NavItem): EffectiveNavItem => {
  const { overrides, ...rest } = item;
  const o = overrides ?? {};

  return {
    ...rest,
    label: o.label ?? item.label,
    icon: o.icon === undefined ? item.icon : (o.icon ?? undefined),
    position: o.position ?? item.position,
    parentId: o.parentId === undefined ? item.parentId : o.parentId,
    hidden: o.hidden === true,
    overridden: overrides != null && Object.keys(overrides).length > 0,
  };
};

export const CommandActionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('navigate'), target: NavTargetSchema }),
    z.object({ kind: z.literal('create_record'), objectId: z.string() }),
    z.object({ kind: z.literal('open_block'), blockId: IdSchema }),
  ])
  .meta({ id: 'CommandAction' });
export type CommandAction = z.infer<typeof CommandActionSchema>;

/** The id of the object a nav target or command action points at, if any. */
export const objectIdOf = (ref: NavTarget | CommandAction): string | undefined => {
  if (ref.kind === 'object' || ref.kind === 'create_record') {
    return ref.objectId;
  }

  if (ref.kind === 'navigate' && ref.target.kind === 'object') {
    return ref.target.objectId;
  }

  return undefined;
};

/** Whether `key` names the object the way the studio resolves one: singular or plural name, or id. */
export const isObjectKey = (key: string, object: Pick<ObjectMetadata, 'id' | 'nameSingular' | 'namePlural'>): boolean =>
  key === object.nameSingular || key === object.namePlural || key === object.id;

/** Whether a nav target or command action points at the object; deleting the object leaves it pointing nowhere. */
export const refersToObject = (ref: NavTarget | CommandAction, object: Pick<ObjectMetadata, 'id'>): boolean =>
  objectIdOf(ref) === object.id;

export const CommandItemSchema = z
  .object({
    workspaceId: z.string(),
    id: IdSchema,
    label: z.string().min(1),
    icon: z.string().optional(),
    group: z.string().optional(),
    shortcut: z.string().optional(),
    action: CommandActionSchema,
    ...Ownership,
  })
  .meta({ id: 'CommandItem' });
export type CommandItem = z.infer<typeof CommandItemSchema>;

export const InstalledModuleSchema = z
  .object({
    id: ModuleIdSchema,
    version: z.string(),
    manifestHash: z.string(),
    installedAt: z.string(),
    updatedAt: z.string(),
    label: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    logo: z.string().optional(),
    website: z.string().optional(),
    engines: ModuleEnginesSchema.optional(),
    /** Part of the product: cannot be uninstalled. */
    core: z.boolean().default(false),
    /** The blocks the module ships (see `BlockDeclarationSchema`). */
    blocks: z.array(BlockDeclarationSchema).default([]),
    /** The agents the module ships (see `AgentDefinitionSchema`). */
    agents: z.array(AgentDefinitionSchema).default([]),
    /** The skills the module ships (see `SkillDefinitionSchema`). */
    skills: z.array(SkillDefinitionSchema).default([]),
    /** What the installed manifest declares: how to connect it, its variables, the actions to call, the events it delivers. */
    connections: z.array(ConnectionProviderSchema).default([]),
    variables: z.array(VariableDefinitionSchema).default([]),
    actions: z.array(ActionDefinitionSchema).default([]),
    events: z.array(EventDefinitionSchema).default([]),
    webhookHelp: z.string().optional(),
    /** The installed version's defaults for what needs review. */
    policies: z.array(PolicyDefinitionSchema).optional(),
  })
  .meta({ id: 'InstalledModule' });
export type InstalledModule = z.infer<typeof InstalledModuleSchema>;

export const WorkspaceSchemaSchema = z
  .object({
    workspaceId: z.string(),
    /** Monotonic metadata version; bumps on every metadata write. Used as ETag and cache key. */
    version: z.number().int(),
    objects: z.array(ObjectMetadataSchema),
    fields: z.array(FieldMetadataSchema),
    views: z.array(ViewMetadataSchema),
    layouts: z.array(LayoutSchema),
    navItems: z.array(NavItemSchema),
    commandItems: z.array(CommandItemSchema),
    modules: z.array(InstalledModuleSchema),
  })
  .meta({ id: 'WorkspaceSchema' });
export type WorkspaceSchema = z.infer<typeof WorkspaceSchemaSchema>;

/** Filter operator metadata reused by the studio filter UI. */
export const FilterOperatorSchema = FilterOpSchema;

/** Indexed view of a WorkspaceSchema for O(1) lookups. Pure and cheap; rebuild when `version` changes. */
export interface SchemaIndex {
  schema: WorkspaceSchema;
  objectsById: Map<string, ObjectMetadata>;
  objectsByName: Map<string, ObjectMetadata>;
  fieldsByObjectId: Map<string, FieldMetadata[]>;
  fieldByObjectAndName: Map<string, FieldMetadata>;
  fieldsById: Map<string, FieldMetadata>;
  viewsByObjectId: Map<string, ViewMetadata[]>;
  viewsById: Map<string, ViewMetadata>;
  layoutsByObjectId: Map<string, Layout[]>;
}

/**
 * The relation fields that delete their record with the record they point at (`settings.onDelete` is `cascade`),
 * with the object each belongs to. Deleting a record of `object` deletes the records of these fields that name it.
 */
export const cascadeRelationsOf = (
  index: SchemaIndex,
  object: ObjectMetadata,
): { object: ObjectMetadata; field: FieldMetadata }[] =>
  index.schema.fields.flatMap((field) => {
    const owner = index.objectsById.get(field.objectId);

    return owner &&
      field.type === 'relation' &&
      field.settings.onDelete === 'cascade' &&
      field.settings.targetObjectId === object.id
      ? [{ object: owner, field }]
      : [];
  });

export const indexSchema = (schema: WorkspaceSchema): SchemaIndex => {
  const objectsById = new Map(schema.objects.map((o) => [o.id, o]));
  const objectsByName = new Map(schema.objects.map((o) => [o.nameSingular, o]));
  const fieldsByObjectId = new Map<string, FieldMetadata[]>();
  const fieldByObjectAndName = new Map<string, FieldMetadata>();
  const fieldsById = new Map<string, FieldMetadata>();

  for (const field of [...schema.fields].sort((a, b) => a.position - b.position)) {
    const list = fieldsByObjectId.get(field.objectId) ?? [];
    list.push(field);
    fieldsByObjectId.set(field.objectId, list);
    fieldByObjectAndName.set(`${field.objectId}:${field.name}`, field);
    fieldsById.set(field.id, field);
  }

  const viewsByObjectId = new Map<string, ViewMetadata[]>();
  const viewsById = new Map<string, ViewMetadata>();

  for (const view of [...schema.views].sort((a, b) => a.position - b.position)) {
    const list = viewsByObjectId.get(view.objectId) ?? [];
    list.push(view);
    viewsByObjectId.set(view.objectId, list);
    viewsById.set(view.id, view);
  }

  const layoutsByObjectId = new Map<string, Layout[]>();

  for (const layout of schema.layouts) {
    const list = layoutsByObjectId.get(layout.objectId) ?? [];
    list.push(layout);
    layoutsByObjectId.set(layout.objectId, list);
  }

  return {
    schema,
    objectsById,
    objectsByName,
    fieldsByObjectId,
    fieldByObjectAndName,
    fieldsById,
    viewsByObjectId,
    viewsById,
    layoutsByObjectId,
  };
};

/** The object a key names (singular or plural name, id or id), as routes, nav items and commands use them. */
export const objectByKey = (index: SchemaIndex, key: string): ObjectMetadata | undefined =>
  index.objectsByName.get(key) ?? index.objectsById.get(key) ?? index.schema.objects.find((o) => o.namePlural === key);

export const fieldsOf = (index: SchemaIndex, objectId: string): FieldMetadata[] =>
  index.fieldsByObjectId.get(objectId) ?? [];

export const fieldOf = (index: SchemaIndex, objectId: string, name: string): FieldMetadata | undefined =>
  index.fieldByObjectAndName.get(`${objectId}:${name}`);

/** The link field that holds a picture of the record, when the object has one: a `url` field set as an image. */
export const imageFieldOf = (index: SchemaIndex, object: ObjectMetadata): FieldMetadata | undefined =>
  fieldsOf(index, object.id).find(
    (field) => field.type === 'url' && (field.settings as { image?: unknown }).image === true,
  );

/** The object's primary field: the one whose value is shown as the record's title. */
export const primaryFieldOf = (index: SchemaIndex, object: ObjectMetadata): FieldMetadata | undefined => {
  const fields = fieldsOf(index, object.id);

  if (object.primaryFieldId) {
    const explicit = fields.find((f) => f.id === object.primaryFieldId);

    if (explicit) {
      return explicit;
    }
  }

  return fields.find((f) => f.type === 'text') ?? fields[0];
};
