import { z } from 'zod';
import { MODULE_SKILLS_MAX } from '../ai';
import { hashValue, stableStringify } from '../hash';
import { IdSchema, isUuid, ModuleIdSchema } from '../ids';
import { layoutActionProblem } from '../layout/record-actions';
import { layoutShapeProblem } from '../layout/shape';
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
import {
  ActionDefinitionSchema,
  ConnectionProviderSchema,
  EventDefinitionSchema,
  VariableDefinitionSchema,
} from '../module-runtime';
import { FilterSchema } from '../query/ir';
import { flattenSteps, stepLimitsProblem, WorkflowDefinitionSchema } from '../workflow';
import { AgentDefinitionSchema, SkillDefinitionSchema } from './agents';
import { normalizeManifest } from './authoring';
import { BlockDeclarationSchema } from './blocks';
import { ModuleEnginesSchema, PolicyDefinitionSchema } from './consent';
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
    nameSingular: ApiNameSchema.refine(
      (name) => !RESERVED_OBJECT_NAMES.has(name),
      'This object name is reserved: the platform uses it for its own things. Pick another API name; the label can still be the same.',
    ),
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
    /** What people read as the module's name. A manifest may leave it out; it is then its `id`. */
    label: z.string().min(1),
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
    /**
     * Workflows it ships: made when the module is installed, updated with it, removed when it is uninstalled. This is
     * where a module puts what should happen in the background, such as reacting to one of its events; the work itself
     * is an action of the module.
     */
    workflows: z.array(WorkflowDefinitionSchema).default([]),
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

export const MANIFEST_ENTITY_KINDS = [
  'object',
  'field',
  'view',
  'layout',
  'nav_item',
  'command_item',
  'workflow',
] as const;
export type ManifestEntityKind = (typeof MANIFEST_ENTITY_KINDS)[number];

/**
 * Parse + normalize a manifest (applies defaults) and check what it says of itself: ids declared once, no name twice.
 * What it points at beyond itself is checked when it is planned, against what is installed.
 */
export const parseManifest = (input: unknown): ModuleManifest => {
  const manifest = ModuleManifestSchema.parse(normalizeManifest(input));
  const seen = new Set<string>();
  const check = (_kind: ManifestEntityKind, id: string) => {
    if (seen.has(id)) {
      throw new Error(`Manifest "${manifest.id}" declares the id "${id}" twice`);
    }

    seen.add(id);
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

  for (const workflow of manifest.workflows) {
    check('workflow', workflow.id);
    const problem = stepLimitsProblem(workflow.steps);

    if (problem) {
      throw new Error(`Workflow "${workflow.id}" of manifest "${manifest.id}": ${problem}`);
    }

    // Its steps are named by uuids too, so a run can say which step it was on after the workflow was updated.
    for (const step of flattenSteps(workflow.steps)) {
      if (!isUuid(step.id)) {
        throw new Error(
          `Workflow "${workflow.id}" of manifest "${manifest.id}": step "${step.id}" needs a uuid as its id`,
        );
      }

      check('workflow', step.id);
    }
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

  unique(
    manifest.blocks.map((block) => block.id),
    declaresTwice('block'),
  );

  unique(
    manifest.pages.map((page) => page.id),
    declaresTwice('page'),
  );

  for (const agent of manifest.agents) {
    unique(
      agent.actionIds,
      (action) => `Agent "${agent.id}" of manifest "${manifest.id}" names the action "${action}" twice`,
    );
  }

  unique(
    manifest.agents.map((agent) => agent.id),
    declaresTwice('agent'),
  );

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

  unique(
    manifest.connections.map((provider) => provider.id),
    declaresTwice('connection'),
  );
  unique(
    manifest.variables.map((variable) => variable.id),
    declaresTwice('variable'),
  );

  for (const variable of manifest.variables) {
    if (variable.secret && variable.defaultValue !== undefined) {
      throw new Error(
        `Variable "${variable.label}" of manifest "${manifest.id}" is secret, so it has no defaultValue: a manifest is public`,
      );
    }
  }

  for (const provider of manifest.connections) {
    if (provider.kind === 'api_key') {
      unique(
        provider.fields.map((field) => field.name),
        (key) => `Connection "${provider.id}" of manifest "${manifest.id}" declares the field "${key}" twice`,
      );
      continue;
    }

    for (const ref of [provider.oauth.clientId, provider.oauth.clientSecret]) {
      if (!ref) {
        continue;
      }

      if (!manifest.variables.some((candidate) => candidate.id === ref.variable)) {
        throw new Error(
          `Connection "${provider.id}" of manifest "${manifest.id}" names the variable "${ref.variable}", which the manifest does not declare`,
        );
      }
    }
  }

  unique(
    manifest.actions.map((action) => action.id),
    declaresTwice('action'),
  );
  unique(
    manifest.actions.map((action) => action.name),
    declaresTwice('action name'),
  );
  unique(
    manifest.events.map((event) => event.name),
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
      (key) => `Action "${action.name}" of manifest "${manifest.id}" declares the input "${key}" twice`,
    );
    unique(
      action.output.map((field) => field.name),
      (key) => `Action "${action.name}" of manifest "${manifest.id}" declares the output "${key}" twice`,
    );
  }

  // A layout may offer another module's actions; one this manifest declares must fit its object, and any other is
  // looked for among the installed modules' when the manifest is planned.
  for (const layout of manifest.layouts) {
    for (const entry of layout.actions ?? []) {
      const declared = manifest.actions.find((action) => action.id === entry.actionId);
      const where = `Layout "${layout.id}" of manifest "${manifest.id}"`;

      if (!declared) {
        continue;
      }

      const problem = layoutActionProblem(entry, [{ id: manifest.id, actions: manifest.actions }], layout.objectId);

      if (problem) {
        throw new Error(`${where} offers an action that does not fit: ${problem}`);
      }
    }
  }

  // Policies may name any module's objects and actions: what they name is not looked for here.
  unique(
    (manifest.policies ?? []).map((policy) => policy.id),
    declaresTwice('policy'),
  );

  checkReferences(manifest);

  return manifest;
};

/**
 * What a manifest says of its own shape: an object's primary field is one of its fields, and a field declared on its own
 * names its object. What a declaration points at beyond that (an object, a field, a block, a nav item) may be another
 * module's, which an id cannot tell, so it is looked for among what is installed when the manifest is planned.
 */
const checkReferences = (manifest: ModuleManifest): void => {
  for (const object of manifest.objects) {
    if (object.primaryFieldId !== undefined && !object.fields.some((field) => field.id === object.primaryFieldId)) {
      throw new Error(
        `Manifest "${manifest.id}": object "${object.id}" names "${object.primaryFieldId}" as its primary field, which is not one of its fields`,
      );
    }
  }
};

/** The parts of a manifest an installed module carries in the workspace schema. */
export type ManifestDeclarations = Pick<
  ModuleManifest,
  | 'label'
  | 'description'
  | 'icon'
  | 'logo'
  | 'website'
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

/** What an installed module shows of its manifest: its connections, variables, actions, events and policies. */
export const declarationsOf = (manifest: ManifestDeclarations): ManifestDeclarations => ({
  label: manifest.label,
  ...(manifest.description ? { description: manifest.description } : {}),
  ...(manifest.icon ? { icon: manifest.icon } : {}),
  ...(manifest.logo ? { logo: manifest.logo } : {}),
  ...(manifest.website ? { website: manifest.website } : {}),
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

/** Every id a manifest declares: its objects, their fields, views, layouts, nav items, commands, blocks, agents, skills, workflows and their steps, actions, connections, events and policies. */
export const idListOf = (manifest: ModuleManifest): string[] => [
  ...manifest.objects.flatMap((object) => [object.id, ...object.fields.map((field) => field.id)]),
  ...manifest.fields.map((field) => field.id),
  ...manifest.views.map((view) => view.id),
  ...manifest.layouts.map((layout) => layout.id),
  ...manifest.navItems.map((item) => item.id),
  ...manifest.commandItems.map((item) => item.id),
  ...manifest.blocks.map((block) => block.id),
  ...manifest.variables.map((variable) => variable.id),
  ...manifest.pages.map((page) => page.id),
  ...manifest.agents.map((agent) => agent.id),
  ...manifest.skills.map((skill) => skill.id),
  ...manifest.workflows.flatMap((workflow) => [workflow.id, ...flattenSteps(workflow.steps).map((step) => step.id)]),
  ...manifest.actions.map((action) => action.id),
  ...manifest.connections.map((provider) => provider.id),
  ...manifest.events.map((event) => event.id),
  ...(manifest.policies ?? []).map((policy) => policy.id),
];

/** Every id written in an `ids` tree (a module's `ids.ts`), whatever the sections and scopes it is nested in. */
export const idsInTree = (tree: object): string[] =>
  Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : idsInTree(value)));
