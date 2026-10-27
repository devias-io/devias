import { z } from 'zod';
import { coreIds } from '../core-ids';
import {
  CommandItemInputSchema,
  FieldInputSchema,
  LayoutInputSchema,
  NavItemInputSchema,
  ObjectCreateInputSchema,
  ObjectInputSchema,
  ViewInputSchema,
} from '../metadata/inputs';
import {
  CommandItemSchema,
  FieldMetadataSchema,
  LayoutSchema,
  NavItemSchema,
  ObjectMetadataSchema,
  ViewMetadataSchema,
  WorkspaceSchemaSchema,
} from '../metadata/schema';
import { type ActionAi, defineActionSpec } from './define';

const tags = ['metadata'];
const IdParams = z.object({ id: z.string() });

export const getSchema = defineActionSpec({
  id: coreIds.actions.get_schema,
  summary: 'Get the workspace schema',
  tags,
  ai: {
    tool: null,
    category: 'covered_by',
    reason: 'list_objects and describe_object return what an agent needs of it',
  },
  permission: 'metadata.read',
  output: WorkspaceSchemaSchema,
  http: {
    method: 'get',
    path: '/api/workspaces/{workspaceId}/metadata',
    outputDescription: 'The whole workspace schema; ETag is the metadata version',
  },
});

const ObjectParams = z.object({ object: z.string().meta({ description: 'Object API name (nameSingular) or id' }) });

/** An object with everything that belongs to it, in one read. */
export const ObjectDescriptionSchema = z
  .object({
    object: ObjectMetadataSchema,
    fields: z.array(FieldMetadataSchema),
    views: z.array(ViewMetadataSchema),
  })
  .meta({ id: 'ObjectDescription' });

export const BLOCK_SURFACES = ['record', 'home', 'dialog', 'panel', 'approval'] as const;

export const BlockListSchema = z
  .object({
    blocks: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        module: z.string().describe("The id of the module that declares the block; `core` for the platform's own"),
        description: z.string().optional(),
      }),
    ),
  })
  .meta({ id: 'BlockList' });

export const listBlocks = defineActionSpec({
  id: coreIds.actions.list_blocks,
  ai: {
    tool: 'list_blocks',
    description:
      "List the blocks a layout can place on record pages, from the studio and the installed modules: id (what a layout cell names), title, what it shows and its config, and the objects it is meant for. Pass a surface for the blocks of Home, dialogs, the panel or approvals (the widget that asks the person to approve one of a module's tools) instead.",
  },
  summary: 'List the blocks a layout can place',
  description:
    'The blocks of the studio and of the installed modules that render on a surface: record pages (what a layout cell names) by default, or Home, dialogs, the panel or approvals.',
  tags,
  permission: 'metadata.read',
  query: z.object({
    surface: z.enum(BLOCK_SURFACES).optional().describe('Where the blocks render; record pages (layouts) by default'),
  }),
  output: BlockListSchema,
  http: {
    method: 'get',
    path: '/api/workspaces/{workspaceId}/metadata/blocks',
    errors: [400, 401, 403],
    outputDescription: 'The blocks',
  },
});

export const describeObject = defineActionSpec({
  id: coreIds.actions.describe_object,
  ai: {
    tool: 'describe_object',
    description:
      'Describe one object: its fields (API name, type, label, options, relation target) and its views. Use it before writing records or changing the data model.',
  },
  summary: 'Describe an object',
  description:
    'The object with its fields and its views, in one read: what a script needs to write records or change the data model.',
  tags,
  permission: 'metadata.read',
  params: ObjectParams,
  output: ObjectDescriptionSchema,
  http: {
    method: 'get',
    path: '/api/workspaces/{workspaceId}/metadata/objects/{object}/describe',
    errors: [401, 403, 404],
    outputDescription: 'The object, its fields and its views',
  },
});

type Verb = 'list' | 'create' | 'get' | 'update' | 'delete';

/** The id of a core action, by the key it is written under in `coreIds.actions`. */
const idOf = (key: string): string => {
  const id = (coreIds.actions as Record<string, string>)[key];

  if (!id) {
    throw new Error(`coreIds.actions has no "${key}"`);
  }

  return id;
};
/** `command item` as it is written in a key: `command_item`. */
type Snake<S extends string> = S extends `${infer A} ${infer B}` ? `${A}_${Snake<B>}` : S;

/**
 * List, create, get, update and delete for one metadata entity under `/api/workspaces/{workspaceId}/metadata/{segment}`. Tools are named
 * after the label (`create_layout`, `list_layouts`) unless `ai` names the hand-written tool that serves one.
 */
const crud = <R extends z.ZodType, I extends z.ZodObject, L extends string>(entity: {
  segment: string;
  /** Singular, human label used in summaries and tool names. */
  label: L;
  row: R;
  input: I;
  /** What a create takes, when it takes more than an update can change. */
  createInput?: z.ZodObject;
  ai?: Partial<Record<Verb, ActionAi>>;
  /** Verbs no agent may make automatic. */
  locked?: Verb[];
}) => {
  const base = `/api/workspaces/{workspaceId}/metadata/${entity.segment}`;
  const a = /^[aeiou]/i.test(entity.label) ? 'an' : 'a';
  const snake = entity.label.replace(/ /g, '_') as Snake<L>;
  const ai = (verb: Verb): ActionAi =>
    entity.ai?.[verb] ?? { tool: verb === 'list' ? `list_${snake}s` : `${verb}_${snake}` };

  return {
    list: defineActionSpec({
      id: idOf(`list_${snake}s`),
      ai: ai('list'),
      summary: `List ${entity.label}s`,
      tags,
      permission: 'metadata.read',
      output: z.array(entity.row),
      http: { method: 'get', path: base, outputDescription: `All ${entity.segment}` },
    }),
    create: defineActionSpec({
      id: idOf(`create_${snake}`),
      ai: ai('create'),
      summary: `Create ${a} ${entity.label}`,
      tags,
      permission: 'metadata.write',
      body: entity.createInput ?? entity.input,
      output: entity.row,
      http: { method: 'post', path: base, status: 201, outputDescription: 'Created' },
    }),
    get: defineActionSpec({
      id: idOf(`get_${snake}`),
      ai: ai('get'),
      summary: `Get ${a} ${entity.label}`,
      tags,
      permission: 'metadata.read',
      params: IdParams,
      output: entity.row,
      http: { method: 'get', path: `${base}/{id}`, outputDescription: 'The entity' },
    }),
    update: defineActionSpec({
      id: idOf(`update_${snake}`),
      ai: ai('update'),
      summary: `Update ${a} ${entity.label}`,
      tags,
      permission: 'metadata.write',
      params: IdParams,
      body: entity.input.partial(),
      output: entity.row,
      http: { method: 'patch', path: `${base}/{id}`, outputDescription: 'Updated' },
    }),
    delete: defineActionSpec({
      id: idOf(`delete_${snake}`),
      ai: ai('delete'),
      locked: entity.locked?.includes('delete') ?? false,
      summary: `Delete ${a} ${entity.label}`,
      tags,
      permission: 'metadata.write',
      params: IdParams,
      http: { method: 'delete', path: `${base}/{id}`, outputDescription: 'Deleted' },
    }),
  };
};

export const objectActions = crud({
  segment: 'objects',
  label: 'object',
  row: ObjectMetadataSchema,
  input: ObjectInputSchema,
  createInput: ObjectCreateInputSchema,
  ai: {
    list: {
      tool: 'list_objects',
      description:
        'List the objects (tables) in the workspace with their API names, labels and field counts. Call describe_object for the fields of one object.',
    },
    create: {
      tool: 'create_object',
      description:
        'Create a new object (table) with its fields, a default table view and a sidebar entry. Asks for approval. Use lowercase API names with underscores (lead_score) and a text field first so records have a label.',
    },
    get: { tool: null, category: 'covered_by', reason: 'describe_object returns an object with its fields and views' },
    update: {
      tool: 'update_object',
      description:
        "Change an object's labels, plural or singular API names, icon, description or primary field (the id of the field that names a record), by object id. Pass only what changes. Asks for approval.",
    },
    delete: {
      tool: 'delete_object',
      description:
        'Delete an object by id, with all its fields, views and records. Destructive: say what will be lost first. Asks for approval.',
    },
  },
});
export const fieldActions = crud({
  segment: 'fields',
  label: 'field',
  row: FieldMetadataSchema,
  input: FieldInputSchema,
  ai: {
    list: { tool: null, category: 'covered_by', reason: 'describe_object returns an object with its fields and views' },
    get: { tool: null, category: 'covered_by', reason: 'describe_object returns an object with its fields and views' },
    create: {
      tool: 'create_field',
      description:
        "Add a field to an object. It shows in the object's own default table, but not in a view a module made (change that with update_view). Asks for approval. For select fields pass options; for relation fields pass relationTarget.",
    },
    update: {
      tool: 'update_field',
      description:
        'Change a field: label, description, required flag, or the options of a select field (add, remove or replace). Asks for approval.',
    },
    delete: {
      tool: 'delete_field',
      description:
        'Delete a field and the values stored in it. Always asks for approval; say which field and object first.',
    },
  },
  // Deleting a field drops its stored values in every record.
  locked: ['delete'],
});
export const viewActions = crud({
  segment: 'views',
  label: 'view',
  row: ViewMetadataSchema,
  input: ViewInputSchema,
  ai: {
    list: { tool: null, category: 'covered_by', reason: 'describe_object returns an object with its fields and views' },
    get: { tool: null, category: 'covered_by', reason: 'describe_object returns an object with its fields and views' },
    create: {
      tool: 'create_view',
      description:
        'Create a saved view of an object: a table or a kanban board with chosen fields, a filter, sorting and (for kanban) a groupBy select field. Asks for approval.',
    },
    update: {
      tool: 'update_view',
      description:
        'Change a saved view: rename it, set its visible fields, filter, sorting, groupBy or default flag. Only the given properties change; pass filter: null to clear the filter. Asks for approval.',
    },
    delete: { tool: 'delete_view', description: 'Delete a saved view by id. Its records stay. Asks for approval.' },
  },
});
export const layoutActions = crud({
  segment: 'layouts',
  label: 'layout',
  row: LayoutSchema,
  input: LayoutInputSchema,
  ai: {
    list: {
      tool: 'list_layouts',
      description:
        "List layouts: what makes up a record's page. `shell` is its shape, and a layout holds only that shape's keys: `tabs` (a header block `header`, and `tabs`, each a 12-column grid of blocks; module actions and blocks that place themselves, such as comments and activity, get their own tabs), `column` (one centered column of `blocks` under a slim toolbar, for things people write in: a title and a body) or `split` (a `main` column and an `aside` on the right, like an issue). `actions` lists the module actions the page offers, a button each in its top bar (filled for the primary ones): exactly what shows, so none when empty. An action fits a page when it has a `record` field for the page's object (list_modules shows them). One per object at most.",
    },
  },
});
const NavArrangeSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string(),
          /** The item it sits under; null for the top level. */
          parentId: z.string().nullable(),
          /** Its place among its siblings, counted from 0. */
          position: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(500),
  })
  .meta({ id: 'NavArrange' });

export const navItemActions = {
  ...crud({
    segment: 'nav-items',
    label: 'nav item',
    row: NavItemSchema,
    input: NavItemInputSchema,
    ai: {
      update: {
        tool: 'update_nav_item',
        description:
          "Change a sidebar item: its label, icon, parent, position or `hidden`. A module's items can be renamed, moved and hidden too (that is kept as the workspace's choice and survives module updates); their destination comes from the module. Use arrange_nav_items to move several at once.",
      },
    },
  }),
  arrange: defineActionSpec({
    id: coreIds.actions.arrange_nav_items,
    ai: {
      tool: 'arrange_nav_items',
      description:
        'Set the order and nesting of sidebar items in one step: for each item given, its parentId (null for the top level) and its position among its siblings. Items not listed stay as they are.',
    },
    summary: 'Arrange nav items',
    description:
      'Moves several nav items at once, so a reorder is one change. A module’s items are moved as the workspace’s choice and survive module updates.',
    tags,
    permission: 'metadata.write',
    body: NavArrangeSchema,
    output: z.array(NavItemSchema),
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/metadata/nav-items/arrange',
      errors: [400, 401, 403, 404],
      bodyDescription: 'The new parent and position of each item moved',
      outputDescription: 'Every nav item, as arranged',
    },
  }),
  resetAll: defineActionSpec({
    id: coreIds.actions.reset_navigation,
    ai: {
      tool: 'reset_navigation',
      description:
        "Put the whole sidebar back to its defaults: drop every rename, hiding and move of a module's items. Items the workspace created (links, sections, objects, pages) stay. Asks for approval.",
    },
    summary: 'Reset the navigation',
    description:
      'Clears the workspace’s overrides of every nav item, so the sidebar is as the modules and the studio define it. Items the workspace created are kept.',
    tags,
    permission: 'metadata.write',
    output: z.array(NavItemSchema),
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/metadata/nav-items/reset',
      errors: [401, 403],
      outputDescription: 'Every nav item that remains',
    },
  }),
  reset: defineActionSpec({
    id: coreIds.actions.reset_nav_item,
    ai: {
      tool: 'reset_nav_item',
      description: "Undo the workspace's label, icon, place and hiding for one of a module's sidebar items.",
    },
    summary: 'Reset a nav item',
    description: 'Drops the workspace’s overrides of a module’s nav item, so it shows as the module defines it.',
    tags,
    permission: 'metadata.write',
    params: IdParams,
    output: NavItemSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/metadata/nav-items/{id}/reset',
      errors: [401, 403, 404],
      outputDescription: 'The nav item',
    },
  }),
};
export type NavArrange = z.infer<typeof NavArrangeSchema>;
export const commandItemActions = crud({
  segment: 'command-items',
  label: 'command item',
  row: CommandItemSchema,
  input: CommandItemInputSchema,
});
