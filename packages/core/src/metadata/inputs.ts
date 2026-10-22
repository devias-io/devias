import { z } from 'zod';
import { IdSchema } from '../ids';
import { FilterSchema } from '../query/ir';
import {
  ApiNameSchema,
  CommandActionSchema,
  LayoutActionSchema,
  LayoutCellInputSchema,
  LayoutTabInputSchema,
  NavTargetSchema,
  RecordShellSchema,
  ViewFieldConfigSchema,
  ViewSortSchema,
} from './schema';

/**
 * Input schemas for metadata CRUD. Shared by the server routes (validation) and the SDK (types).
 * Ids, workspace ids and ownership are assigned by the server.
 */

export const ObjectInputSchema = z
  .object({
    nameSingular: ApiNameSchema,
    namePlural: ApiNameSchema,
    labelSingular: z.string().min(1),
    labelPlural: z.string().min(1),
    icon: z.string().optional(),
    description: z.string().optional(),
    primaryFieldId: IdSchema.optional().describe(
      "The id of the field that names a record, one of the object's fields (create the field first); the first text field when left out.",
    ),
    readOnly: z.boolean().optional(),
    deleteWhen: FilterSchema.nullable()
      .optional()
      .describe(
        'A record can be deleted only while it matches this filter, e.g. status is draft. null removes the rule.',
      ),
  })
  .meta({ id: 'ObjectInput' });
export type ObjectInput = z.infer<typeof ObjectInputSchema>;

/** The object a field, view or layout belongs to: its id, or its API name, plural name or id. */
const ObjectRefSchema = z
  .string()
  .min(1)
  .describe("The object: its id, or its API name (e.g. 'person'), plural name or id");

export const FieldInputSchema = z
  .object({
    objectId: ObjectRefSchema,
    name: ApiNameSchema,
    type: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    isRequired: z.boolean().optional(),
    isUnique: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    position: z.number().int().optional(),
  })
  .meta({ id: 'FieldInput' });
export type FieldInput = z.infer<typeof FieldInputSchema>;

/** A field made along with its object: the same as a field input, for the object being created. */
export const ObjectFieldInputSchema = FieldInputSchema.omit({ objectId: true }).meta({ id: 'ObjectFieldInput' });
export type ObjectFieldInput = z.infer<typeof ObjectFieldInputSchema>;

/**
 * An object to make, and optionally what goes with it, all in one change: its `fields` in order (a relation may
 * point at the object being made by its API name), the table view that lists them and a row in the sidebar. The first
 * field names a record.
 */
export const ObjectCreateInputSchema = ObjectInputSchema.extend({
  fields: z.array(ObjectFieldInputSchema).max(100).optional().describe('Its fields, in display order'),
  addToNavigation: z.boolean().optional().describe('Put it in the sidebar (default true)'),
}).meta({ id: 'ObjectCreateInput' });
export type ObjectCreateInput = z.infer<typeof ObjectCreateInputSchema>;

/**
 * A view config as clients send it. Nothing has a default: Zod applies defaults even to omitted optional keys,
 * so defaults here would make every partial update reset the keys it didn't send. On update it is merged into
 * the saved config, and `null` clears the filter or grouping (JSON has no `undefined`).
 */
export const ViewConfigInputSchema = z.object({
  fields: z.array(ViewFieldConfigSchema).optional(),
  filter: FilterSchema.nullable().optional(),
  sorts: z.array(ViewSortSchema).optional(),
  groupById: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type ViewConfigInput = z.input<typeof ViewConfigInputSchema>;

export const ViewInputSchema = z
  .object({
    objectId: ObjectRefSchema,
    label: z.string().min(1),
    /** Defaults to `table` when the view is created; omitted on update, the type stays as it is. */
    type: z.string().min(1).optional(),
    icon: z.string().optional(),
    isDefault: z.boolean().optional(),
    position: z.number().int().optional(),
    config: ViewConfigInputSchema.optional(),
  })
  .meta({ id: 'ViewInput' });
export type ViewInput = z.infer<typeof ViewInputSchema>;

/**
 * A layout as clients send it, flat so one schema serves the API and the agent's tool; what each shape takes is
 * checked when it is saved (`layoutShapeProblem`), with a message that says what to change.
 */
export const LayoutInputSchema = z
  .object({
    objectId: ObjectRefSchema,
    label: z.string().min(1),
    isDefault: z.boolean().optional(),
    shell: RecordShellSchema.describe(
      'The shape of the page. `tabs`: a header block, a tab bar and a 12-column grid of blocks per tab (give `header` and `tabs`). `column`: one centered column under a slim toolbar, for things people write in (give `blocks`). `split`: a main column and an aside on the right, like an issue (give `main` and `aside`). A shape takes only its own keys.',
    ),
    header: LayoutCellInputSchema.optional().describe(
      "`tabs` only: the block that draws the page header (the object's icon and name when left out).",
    ),
    tabs: z.array(LayoutTabInputSchema).optional().describe('`tabs` only: the tabs, each a grid of blocks.'),
    blocks: z.array(LayoutCellInputSchema).optional().describe('`column` only: the blocks, top to bottom.'),
    main: z
      .array(LayoutCellInputSchema)
      .optional()
      .describe('`split` only: the blocks of the main column, top to bottom.'),
    aside: z.array(LayoutCellInputSchema).optional().describe('`split` only: the blocks of the aside, top to bottom.'),
    /** The module actions the page offers as buttons, in order; an empty list offers none. */
    actions: z.array(LayoutActionSchema).optional(),
  })
  .meta({ id: 'LayoutInput' });
export type LayoutInput = z.infer<typeof LayoutInputSchema>;

export const NavItemInputSchema = z
  .object({
    label: z.string().min(1),
    icon: z.string().optional(),
    target: NavTargetSchema,
    position: z.number().int().optional(),
    parentId: z.string().nullable().optional(),
    /** Leave the item out of the sidebar without removing it. */
    hidden: z.boolean().optional(),
    /** Pin it above the sections, at the top level; pinned items are not arranged in Settings. */
    pinned: z.boolean().optional(),
  })
  .meta({ id: 'NavItemInput' });
export type NavItemInput = z.infer<typeof NavItemInputSchema>;

export const CommandItemInputSchema = z
  .object({
    label: z.string().min(1),
    icon: z.string().optional(),
    group: z.string().optional(),
    shortcut: z.string().optional(),
    action: CommandActionSchema,
  })
  .meta({ id: 'CommandItemInput' });
export type CommandItemInput = z.infer<typeof CommandItemInputSchema>;

export const RecordWriteSchema = z.record(z.string(), z.unknown()).meta({ id: 'RecordWrite' });

export const LookupInputSchema = z
  .object({
    text: z.string().min(1),
    objects: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .meta({ id: 'LookupInput' });
export type LookupInput = z.infer<typeof LookupInputSchema>;

export const LookupHitSchema = z
  .object({
    object: z.string(),
    objectId: z.string(),
    recordId: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
  })
  .meta({ id: 'LookupHit' });
export type LookupHit = z.infer<typeof LookupHitSchema>;
