import { z } from 'zod';
import { MODULE_SKILLS_MAX } from '../ai';
import { hashValue, stableStringify } from '../hash';
import { IdSchema, ModuleIdSchema } from '../ids';
import { layoutActionProblem } from '../layout/record-actions';
import { layoutCells, layoutShapeProblem } from '../layout/shape';
import {
  ApiNameSchema,
  ColumnContentSchema,
  CommandActionSchema,
  LayoutActionSchema,
  NavTargetSchema,
  RESERVED_OBJECT_NAMES,
  SplitContentSchema,
  TabsContentSchema,
} from '../metadata/schema';
import { filterFieldRefs } from '../metadata/view-config';
import {
  ActionDefinitionSchema,
  ConnectionProviderSchema,
  EventDefinitionSchema,
  VariableDefinitionSchema,
} from '../module-runtime';
import { FilterSchema } from '../query/ir';
import { AgentDefinitionSchema, SkillDefinitionSchema } from './agents';
import { normalizeManifest } from './authoring';
import { BlockDeclarationSchema } from './blocks';
import { ModuleEnginesSchema, ModulePublisherSchema, PolicyDefinitionSchema } from './consent';
import { keyOfId, localOfId, ownerOfId, scopedKeyOfId } from './entities';
import { moduleLogoProblem } from './logo';
import { PageDeclarationSchema } from './pages';

/**
 * What a module declares. Manifests are pure data: no React, no server code. They are never
 * rendered directly; `plan`/`apply` reconcile them into workspace metadata by id.
 */

export const FieldDefinitionSchema = z
  .object({
    id: IdSchema,
    /** Required when the field is declared outside an object (extending another module's object). */
    objectId: IdSchema.optional(),
    name: ApiNameSchema,
    label: z.string().min(1),
    type: z.string().min(1),
    settings: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    isRequired: z.boolean().optional(),
    isUnique: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    position: z.number().int().optional(),
  })
  .meta({ id: 'FieldDefinition' });
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const ObjectDefinitionSchema = z
  .object({
    id: IdSchema,
    nameSingular: ApiNameSchema.refine((name) => !RESERVED_OBJECT_NAMES.has(name), 'This object name is reserved'),
    namePlural: ApiNameSchema,
    labelSingular: z.string().min(1),
    labelPlural: z.string().min(1),
    icon: z.string().optional(),
    description: z.string().optional(),
    /** The id of the field that names a record, one of this object's own fields (see `ObjectMetadata.primaryFieldId`). */
    primaryFieldId: IdSchema.optional(),
    /** A record can be deleted only while it matches this filter (see `ObjectMetadata.deleteWhen`). */
    deleteWhen: FilterSchema.optional(),
    fields: z.array(FieldDefinitionSchema).default([]),
  })
  .meta({ id: 'ObjectDefinition' });
export type ObjectDefinition = z.infer<typeof ObjectDefinitionSchema>;

export const ViewDefinitionSchema = z
  .object({
    id: IdSchema,
    objectId: IdSchema,
    label: z.string().min(1),
    type: z.string().default('table'),
    icon: z.string().optional(),
    isDefault: z.boolean().optional(),
    position: z.number().int().optional(),
    fields: z
      .array(
        z.object({
          /** A field's id, or a system column (`created_at`). */
          fieldId: z.string().min(1),
          width: z.number().int().positive().optional(),
          visible: z.boolean().optional(),
        }),
      )
      .optional(),
    filter: FilterSchema.optional(),
    sorts: z
      .array(z.object({ fieldId: z.string().min(1), direction: z.enum(['asc', 'desc']).default('asc') }))
      .optional(),
    groupById: z.string().min(1).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ViewDefinition' });
export type ViewDefinition = z.infer<typeof ViewDefinitionSchema>;

const layoutDefinitionBase = {
  id: IdSchema,
  objectId: IdSchema,
  label: z.string().min(1),
  isDefault: z.boolean().optional(),
  /** The module actions the page offers as buttons, in order; an empty list offers none. */
  actions: z.array(LayoutActionSchema).optional(),
};

/** A layout is one of three shapes (see `RecordShellSchema`) and holds exactly the keys its shape takes. */
export const LayoutDefinitionSchema = z
  .discriminatedUnion('shell', [
    z.strictObject({ ...layoutDefinitionBase, shell: z.literal('tabs'), ...TabsContentSchema.shape }),
    z.strictObject({ ...layoutDefinitionBase, shell: z.literal('column'), ...ColumnContentSchema.shape }),
    z.strictObject({ ...layoutDefinitionBase, shell: z.literal('split'), ...SplitContentSchema.shape }),
  ])
  .meta({ id: 'LayoutDefinition' });
export type LayoutDefinition = z.infer<typeof LayoutDefinitionSchema>;

export const NavItemDefinitionSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    icon: z.string().optional(),
    target: NavTargetSchema,
    position: z.number().int().optional(),
    /** The id of the item this one sits under, from the same module: a sub menu. */
    parentId: IdSchema.optional(),
    /**
     * Above the sections, whatever the workspace arranged, at the top level: for the few places people always reach
     * (Home). Pinned items are not arranged in Settings.
     */
    pinned: z.boolean().optional(),
  })
  .meta({ id: 'NavItemDefinition' });
export type NavItemDefinition = z.infer<typeof NavItemDefinitionSchema>;

export const CommandItemDefinitionSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    icon: z.string().optional(),
    group: z.string().optional(),
    shortcut: z.string().optional(),
    action: CommandActionSchema,
  })
  .meta({ id: 'CommandItemDefinition' });
export type CommandItemDefinition = z.infer<typeof CommandItemDefinitionSchema>;

export const ModuleManifestSchema = z
  .object({
    id: ModuleIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+([-+].+)?$/, 'semver'),
    /** What people call the module: a party's name, as an agent's. A manifest may leave it out; it is then its `id`. */
    name: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    /** An image in the module's package (`./logo.svg`), shown where the module is listed; `icon` when there is none. */
    logo: z
      .string()
      .superRefine((path, ctx) => {
        const problem = moduleLogoProblem(path);

        if (problem) {
          ctx.addIssue({ code: 'custom', message: problem });
        }
      })
      .optional(),
    /** The module's own site, or the outside service's for one that connects to it. Linked from the studio, so only http(s). */
    website: z.url({ protocol: /^https?$/ }).optional(),
    /** Who publishes the module. */
    publisher: ModulePublisherSchema.optional(),
    /** The Devias versions it works with. */
    engines: ModuleEnginesSchema.optional(),
    /**
     * Part of the product rather than an add-on (the studio itself, the agent): installed in every workspace from
     * the start, never uninstalled, and never hidden by install state.
     */
    core: z.boolean().default(false),
    objects: z.array(ObjectDefinitionSchema).default([]),
    fields: z.array(FieldDefinitionSchema).default([]),
    views: z.array(ViewDefinitionSchema).default([]),
    layouts: z.array(LayoutDefinitionSchema).default([]),
    navItems: z.array(NavItemDefinitionSchema).default([]),
    commandItems: z.array(CommandItemDefinitionSchema).default([]),
    /** The blocks its studio code registers, as data: layouts are checked against them, the agent lists them. */
    blocks: z.array(BlockDeclarationSchema).default([]),
    /** The pages its studio code registers that a nav item or a command points at, as data. */
    pages: z.array(PageDeclarationSchema).default([]),
    /** Agents it ships: made when the module is installed, updated with it, archived when it is uninstalled. */
    agents: z.array(AgentDefinitionSchema).default([]),
    /** The skills the module ships (see `SkillDefinitionSchema`). */
    skills: z.array(SkillDefinitionSchema).max(MODULE_SKILLS_MAX).default([]),
    /** How a workspace or a person connects it to its outside service: an API key, an OAuth account. */
    connections: z.array(ConnectionProviderSchema).default([]),
    /** Configuration its code reads: set per workspace, or on the server for OAuth client credentials. */
    variables: z.array(VariableDefinitionSchema).default([]),
    /** Actions workflows, the agent and the API can run; the server side implements each one. */
    actions: z.array(ActionDefinitionSchema).default([]),
    /** Event types the module delivers (through its webhook) for workflows to start from. */
    events: z.array(EventDefinitionSchema).default([]),
    /** How to register the webhook URL with the outside service. */
    webhookHelp: z.string().optional(),
    /** @experimental Its defaults for what needs review (see `PolicyDefinitionSchema`). */
    policies: z.array(PolicyDefinitionSchema).optional(),
  })
  .meta({ id: 'ModuleManifest' });
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export const MANIFEST_ENTITY_KINDS = ['object', 'field', 'view', 'layout', 'nav_item', 'command_item'] as const;
export type ManifestEntityKind = (typeof MANIFEST_ENTITY_KINDS)[number];

/** Parse + normalize a manifest (applies defaults) and check id uniqueness and ownership prefixes. */
export const parseManifest = (input: unknown): ModuleManifest => {
  const manifest = ModuleManifestSchema.parse(normalizeManifest(input));
  const seen = new Set<string>();
  const check = (kind: ManifestEntityKind, id: string) => {
    if (seen.has(id)) {
      throw new Error(`Manifest "${manifest.id}" declares the id "${id}" twice`);
    }

    seen.add(id);
    const prefix = ownerOfId(id);

    if (prefix !== manifest.id) {
      throw new Error(
        `Manifest "${manifest.id}" cannot declare ${kind} "${id}": ids must start with "${manifest.id}."`,
      );
    }
  };

  for (const object of manifest.objects) {
    check('object', object.id);

    for (const field of object.fields) {
      check('field', field.id);
    }
  }

  for (const field of manifest.fields) {
    check('field', field.id);

    if (!field.objectId) {
      throw new Error(`Field "${field.id}" declared at manifest level must name its "object"`);
    }
  }

  for (const view of manifest.views) {
    check('view', view.id);
  }

  for (const layout of manifest.layouts) {
    check('layout', layout.id);
  }

  for (const nav of manifest.navItems) {
    check('nav_item', nav.id);
  }

  for (const command of manifest.commandItems) {
    check('command_item', command.id);
  }

  const unique = (keys: string[], twice: (key: string) => string) => {
    const keyed = new Set<string>();

    for (const key of keys) {
      if (keyed.has(key)) {
        throw new Error(twice(key));
      }

      keyed.add(key);
    }
  };
  const declaresTwice = (kind: string) => (key: string) =>
    `Manifest "${manifest.id}" declares the ${kind} "${key}" twice`;

  const owned = (kind: string, id: string) => {
    if (ownerOfId(id) !== manifest.id) {
      throw new Error(
        `Manifest "${manifest.id}" cannot declare ${kind} "${id}": ids must start with "${manifest.id}."`,
      );
    }
  };

  for (const block of manifest.blocks) {
    owned('block', block.id);
  }

  unique(
    manifest.blocks.map((block) => block.id),
    declaresTwice('block'),
  );

  for (const page of manifest.pages) {
    owned('page', page.id);
  }

  unique(
    manifest.pages.map((page) => page.id),
    declaresTwice('page'),
  );

  for (const agent of manifest.agents) {
    owned('agent', agent.id);
    unique(
      agent.actionIds,
      (action) => `Agent "${agent.id}" of manifest "${manifest.id}" names the action "${action}" twice`,
    );
  }

  unique(
    manifest.agents.map((agent) => agent.id),
    declaresTwice('agent'),
  );

  for (const skill of manifest.skills) {
    owned('skill', skill.id);
  }

  unique(
    manifest.skills.map((skill) => skill.id),
    declaresTwice('skill'),
  );
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));

  for (const agent of manifest.agents) {
    unique(
      agent.skillIds,
      (skill) => `Agent "${agent.id}" of manifest "${manifest.id}" names the skill "${skill}" twice`,
    );

    for (const skill of agent.skillIds) {
      if (!skillIds.has(skill)) {
        throw new Error(
          `Agent "${agent.id}" of manifest "${manifest.id}" names the skill "${skill}", which the manifest does not declare`,
        );
      }
    }
  }
  for (const provider of manifest.connections) {
    owned('connection', provider.id);
  }

  for (const action of manifest.actions) {
    owned('action', action.id);
  }

  for (const event of manifest.events) {
    owned('event', event.id);
  }

  for (const policy of manifest.policies ?? []) {
    owned('policy', policy.id);
  }

  unique(
    manifest.connections.map((provider) => keyOfId(provider.id)),
    declaresTwice('connection'),
  );
  unique(
    manifest.variables.map((variable) => variable.key),
    declaresTwice('variable'),
  );

  for (const variable of manifest.variables) {
    if (variable.secret && !variable.server) {
      throw new Error(
        `Variable "${variable.key}" of manifest "${manifest.id}" is secret, so it must be a server variable; a workspace's secrets belong in a connection`,
      );
    }
  }

  for (const provider of manifest.connections) {
    if (provider.kind === 'api_key') {
      unique(
        provider.fields.map((field) => field.name),
        (key) => `Connection "${keyOfId(provider.id)}" of manifest "${manifest.id}" declares the field "${key}" twice`,
      );
      continue;
    }

    for (const ref of [provider.oauth.clientId, provider.oauth.clientSecret]) {
      if (!ref) {
        continue;
      }

      const variable = manifest.variables.find((candidate) => candidate.key === ref.variable);

      if (!variable?.server) {
        throw new Error(
          `Connection "${keyOfId(provider.id)}" of manifest "${manifest.id}" names the variable "${ref.variable}", which it must declare as a server variable`,
        );
      }
    }
  }

  unique(
    manifest.actions.map((action) => keyOfId(action.id)),
    declaresTwice('action'),
  );
  unique(
    manifest.events.map((event) => keyOfId(event.id)),
    declaresTwice('event'),
  );

  for (const layout of manifest.layouts) {
    const problem = layoutShapeProblem(layout);

    if (problem) {
      throw new Error(`Layout "${layout.id}" of manifest "${manifest.id}": ${problem}`);
    }
  }

  for (const action of manifest.actions) {
    unique(
      action.input.map((field) => field.name),
      (key) => `Action "${keyOfId(action.id)}" of manifest "${manifest.id}" declares the input "${key}" twice`,
    );
    unique(
      action.output.map((field) => field.name),
      (key) => `Action "${keyOfId(action.id)}" of manifest "${manifest.id}" declares the output "${key}" twice`,
    );
  }

  // A layout may offer another module's actions (checked when they are installed); this module's must be declared here.
  for (const layout of manifest.layouts) {
    for (const entry of layout.actions ?? []) {
      if (!entry.actionId.startsWith(`${manifest.id}.`)) {
        continue;
      }

      const declared = manifest.actions.find((action) => action.id === entry.actionId);
      const where = `Layout "${layout.id}" of manifest "${manifest.id}"`;

      if (!declared) {
        throw new Error(`${where} offers the action "${entry.actionId}", which the manifest does not declare`);
      }

      const problem = layoutActionProblem(
        entry,
        [{ moduleId: manifest.id, actions: manifest.actions }],
        layout.objectId,
      );

      if (problem) {
        throw new Error(`${where} offers an action that does not fit: ${problem}`);
      }
    }
  }

  // Policies may name another module's objects and actions; this module's must be declared here.
  const objects = new Set(manifest.objects.map((object) => object.id));
  const requireObject = (id: string, where: string) => {
    if (id.startsWith(`${manifest.id}.`) && !objects.has(id)) {
      throw new Error(`Manifest "${manifest.id}": ${where} names the object "${id}", which it does not declare`);
    }
  };

  const policies = manifest.policies ?? [];
  unique(
    policies.map((policy) => keyOfId(policy.id)),
    declaresTwice('policy'),
  );

  for (const policy of policies) {
    const where = `policy "${keyOfId(policy.id)}"`;

    if (policy.match.objectId) {
      requireObject(policy.match.objectId, where);
    }

    const action = policy.match.actionId;

    if (action?.startsWith(`${manifest.id}.`) && !manifest.actions.some((a) => a.id === action)) {
      throw new Error(`Manifest "${manifest.id}": ${where} names the action "${action}", which it does not declare`);
    }
  }

  checkReferences(manifest);

  return manifest;
};

/**
 * What a declaration points at by id must exist when the id is this module's (another module's is checked when it is
 * installed), and a field, a view or a layout is named inside the object it belongs to.
 */
const checkReferences = (manifest: ModuleManifest): void => {
  const own = (id: string) => ownerOfId(id) === manifest.id;
  const ids = (list: { id: string }[]) => new Set(list.map((entry) => entry.id));
  const objects = ids(manifest.objects);
  const views = ids(manifest.views);
  const navItems = ids(manifest.navItems);
  const blocks = ids(manifest.blocks);
  const pages = ids(manifest.pages);
  const refuse = (where: string, kind: string, id: string): never => {
    throw new Error(`Manifest "${manifest.id}": ${where} points at the ${kind} "${id}", which it does not declare`);
  };
  const needObject = (where: string, id: string | undefined) => {
    if (id !== undefined && own(id) && !objects.has(id)) {
      refuse(where, 'object', id);
    }
  };
  /** Where a nav item or a command leads, when it is one of this module's own pages or objects. */
  const needTarget = (where: string, target: { kind: string; pageId?: string; objectId?: string }) => {
    if (target.kind === 'page' && own(target.pageId ?? '') && !pages.has(target.pageId ?? '')) {
      refuse(where, 'page', target.pageId ?? '');
    }

    if (target.kind === 'object') {
      needObject(where, target.objectId);
    }
  };
  /** `crm.person.email` belongs to `crm.person`, or to another module's `person`. */
  const inside = (where: string, id: string, object: string) => {
    if (scopedKeyOfId(id).scope !== localOfId(object)) {
      throw new Error(`Manifest "${manifest.id}": ${where} "${id}" must be named inside its object "${object}"`);
    }
  };

  for (const object of manifest.objects) {
    for (const field of object.fields) {
      inside('field', field.id, object.id);
    }

    if (object.primaryFieldId !== undefined && !object.fields.some((field) => field.id === object.primaryFieldId)) {
      throw new Error(
        `Manifest "${manifest.id}": object "${object.id}" names "${object.primaryFieldId}" as its primary field, which is not one of its fields`,
      );
    }
  }

  for (const field of manifest.fields) {
    needObject(`field "${field.id}"`, field.objectId);
    inside('field', field.id, field.objectId as string);
  }

  for (const field of manifestFields(manifest)) {
    const target = (field.settings as { targetObjectId?: unknown } | undefined)?.targetObjectId;

    if (field.type === 'relation' && typeof target === 'string') {
      needObject(`field "${field.id}"`, target);
    }
  }

  const fieldIds = new Set([...manifestFields(manifest).map((field) => field.id)]);

  for (const view of manifest.views) {
    const refs = [
      ...(view.fields ?? []).map((field) => field.fieldId),
      ...(view.sorts ?? []).map((sort) => sort.fieldId),
      ...(view.groupById ? [view.groupById] : []),
      ...filterFieldRefs(view.filter),
    ];

    for (const ref of refs) {
      if (own(ref) && !fieldIds.has(ref)) {
        refuse(`view "${view.id}"`, 'field', ref);
      }
    }
  }

  for (const view of manifest.views) {
    needObject(`view "${view.id}"`, view.objectId);
    inside('view', view.id, view.objectId);
  }

  for (const layout of manifest.layouts) {
    needObject(`layout "${layout.id}"`, layout.objectId);
    inside('layout', layout.id, layout.objectId);

    for (const { cell } of layoutCells(layout)) {
      if (own(cell.blockId) && !blocks.has(cell.blockId)) {
        refuse(`layout "${layout.id}"`, 'block', cell.blockId);
      }
    }
  }

  for (const item of manifest.navItems) {
    if (item.parentId && own(item.parentId) && !navItems.has(item.parentId)) {
      refuse(`nav item "${item.id}"`, 'nav item', item.parentId);
    }

    if (
      item.target.kind === 'object' &&
      item.target.viewId &&
      own(item.target.viewId) &&
      !views.has(item.target.viewId)
    ) {
      refuse(`nav item "${item.id}"`, 'view', item.target.viewId);
    }

    needTarget(`nav item "${item.id}"`, item.target);
  }

  for (const item of manifest.commandItems) {
    const { action } = item;

    if (action.kind === 'navigate') {
      needTarget(`command "${item.id}"`, action.target);
    } else if (action.kind === 'create_record') {
      needObject(`command "${item.id}"`, action.objectId);
    } else if (own(action.blockId) && !blocks.has(action.blockId)) {
      refuse(`command "${item.id}"`, 'block', action.blockId);
    }
  }

  for (const action of manifest.actions) {
    for (const field of [...action.input, ...action.output]) {
      needObject(`action "${action.id}"`, field.objectId);
    }
  }
};

/** The parts of a manifest an installed module carries in the workspace schema. */
export type ManifestDeclarations = Pick<
  ModuleManifest,
  | 'name'
  | 'description'
  | 'icon'
  | 'logo'
  | 'website'
  | 'publisher'
  | 'engines'
  | 'core'
  | 'blocks'
  | 'agents'
  | 'skills'
  | 'connections'
  | 'variables'
  | 'actions'
  | 'events'
  | 'webhookHelp'
  | 'policies'
>;

/** What an installed module shows of its manifest: its publisher, connections, variables, actions, events and policies. */
export const declarationsOf = (manifest: ManifestDeclarations): ManifestDeclarations => ({
  name: manifest.name,
  ...(manifest.description ? { description: manifest.description } : {}),
  ...(manifest.icon ? { icon: manifest.icon } : {}),
  ...(manifest.logo ? { logo: manifest.logo } : {}),
  ...(manifest.website ? { website: manifest.website } : {}),
  ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
  ...(manifest.engines ? { engines: manifest.engines } : {}),
  core: manifest.core,
  blocks: manifest.blocks,
  agents: manifest.agents,
  skills: manifest.skills,
  connections: manifest.connections,
  variables: manifest.variables,
  actions: manifest.actions,
  events: manifest.events,
  ...(manifest.webhookHelp ? { webhookHelp: manifest.webhookHelp } : {}),
  ...(manifest.policies ? { policies: manifest.policies } : {}),
});

/** All field definitions, including those nested in objects, each with its owning object id. */
export const manifestFields = (manifest: ModuleManifest): (FieldDefinition & { objectId: string })[] => [
  ...manifest.objects.flatMap((o) => o.fields.map((f) => ({ ...f, objectId: o.id }))),
  ...manifest.fields.map((f) => ({ ...f, objectId: f.objectId as string })),
];

export const canonicalManifest = (manifest: ModuleManifest): string =>
  stableStringify(ModuleManifestSchema.parse(manifest));
export const hashManifest = (manifest: ModuleManifest): string => hashValue(ModuleManifestSchema.parse(manifest));

/** Every id a manifest declares: its objects, their fields, views, layouts, nav items, commands, blocks, agents, skills, actions, connections, events and policies. */
export const idListOf = (manifest: ModuleManifest): string[] => [
  ...manifest.objects.flatMap((object) => [object.id, ...object.fields.map((field) => field.id)]),
  ...manifest.fields.map((field) => field.id),
  ...manifest.views.map((view) => view.id),
  ...manifest.layouts.map((layout) => layout.id),
  ...manifest.navItems.map((item) => item.id),
  ...manifest.commandItems.map((item) => item.id),
  ...manifest.blocks.map((block) => block.id),
  ...manifest.pages.map((page) => page.id),
  ...manifest.agents.map((agent) => agent.id),
  ...manifest.skills.map((skill) => skill.id),
  ...manifest.actions.map((action) => action.id),
  ...manifest.connections.map((provider) => provider.id),
  ...manifest.events.map((event) => event.id),
  ...(manifest.policies ?? []).map((policy) => policy.id),
];

/** Every id written in an `ids` tree (a module's `ids.ts`), whatever the sections and scopes it is nested in. */
export const idsInTree = (tree: object): string[] =>
  Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : idsInTree(value)));
