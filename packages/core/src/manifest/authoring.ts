/**
 * How a module author writes a manifest. A module is named by its `id` (`crm`) and every declaration in it carries its
 * own full `id`, written out: a uuid (`devias id` makes them). An id is opaque: nothing is read out of it or derived from
 * a name, and what a declaration belongs to is the module that declares it. What points at a declaration (a view's `objectId`, a layout cell's `blockId`, a nav item's `parentId`) names it by
 * that id too, and `parseManifest` refuses one of this module's that names nothing.
 *
 * - an object and a field also have an API name (`nameSingular`, `name`): what records and the API call them. It is
 *   separate from the id, so it can change in a later version while the id stays.
 * - an action and an event also have a `name` apart from the id: an action's is what its tool, its route and a workflow
 *   step call it by.
 *
 * The types below are what the schemas accept, with what the schemas fill in left optional.
 */

import type { z } from 'zod';
import type { ActionDefinitionSchema, ConnectionProviderSchema, EventDefinitionSchema } from '../module-runtime';
import type { WorkflowDefinitionSchema } from '../workflow';
import type { AgentDefinitionSchema, SkillDefinitionSchema } from './agents';
import type { BlockDeclarationSchema } from './blocks';
import type { PolicyDefinitionSchema } from './consent';
import type {
  CommandItemDefinitionSchema,
  FieldDefinitionSchema,
  LayoutDefinitionSchema,
  ModuleManifestSchema,
  NavItemDefinitionSchema,
  ObjectDefinitionSchema,
  ViewDefinitionSchema,
} from './manifest';
import type { PageDeclarationSchema } from './pages';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a manifest may leave out, filled in before it is parsed so that a parsed one always has it: the module's `label`
 * (its `id`) and the `label` of each connection (the module's label). Anything else is left as it is.
 */
export const normalizeManifest = (raw: unknown): unknown => {
  if (!isRecord(raw)) {
    return raw;
  }

  const label =
    typeof raw.label === 'string' && raw.label ? raw.label : typeof raw.id === 'string' ? raw.id : undefined;
  const filled: Record<string, unknown> = { ...raw, ...(label === undefined ? {} : { label }) };

  if (Array.isArray(raw.connections) && label !== undefined) {
    filled.connections = raw.connections.map((connection) =>
      isRecord(connection) && !connection.label ? { ...connection, label } : connection,
    );
  }

  return filled;
};

// ---------------------------------------------------------------------------------------------
// The types an author writes against
// ---------------------------------------------------------------------------------------------

export type FieldDefinitionInput = z.input<typeof FieldDefinitionSchema>;
/** An object, with its fields. */
export type ObjectDefinitionInput = Omit<z.input<typeof ObjectDefinitionSchema>, 'fields'> & {
  fields?: FieldDefinitionInput[];
};
export type ViewDefinitionInput = z.input<typeof ViewDefinitionSchema>;
/** A layout of an object. */
export type LayoutDefinitionInput = z.input<typeof LayoutDefinitionSchema>;
export type NavItemDefinitionInput = z.input<typeof NavItemDefinitionSchema>;
export type CommandItemDefinitionInput = z.input<typeof CommandItemDefinitionSchema>;
export type BlockDeclarationInput = z.input<typeof BlockDeclarationSchema>;
export type PageDeclarationInput = z.input<typeof PageDeclarationSchema>;
export type AgentDefinitionInput = z.input<typeof AgentDefinitionSchema>;
export type SkillDefinitionInput = z.input<typeof SkillDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;
export type ActionDefinitionInput = z.input<typeof ActionDefinitionSchema>;
/** A connection as an author writes it: its `label` may be left out, and is then the module's name. */
export type ConnectionProviderInput = WithOptionalLabel<z.input<typeof ConnectionProviderSchema>>;
type WithOptionalLabel<T> = T extends unknown ? Omit<T, 'label'> & { label?: string } : never;
export type PolicyDefinitionInput = z.input<typeof PolicyDefinitionSchema>;
/** An event, named as the outside service names it (`email.delivered`). */
export type EventDefinitionInput = z.input<typeof EventDefinitionSchema>;

/** What a module author writes: `defineModule` checks it and returns the parsed manifest. */
export type ModuleManifestInput = Omit<
  z.input<typeof ModuleManifestSchema>,
  | 'label'
  | 'objects'
  | 'fields'
  | 'views'
  | 'layouts'
  | 'navItems'
  | 'commandItems'
  | 'blocks'
  | 'pages'
  | 'agents'
  | 'workflows'
  | 'connections'
  | 'actions'
  | 'events'
  | 'policies'
> & {
  /** What people call the module; its `id` when left out. */
  label?: string;
  objects?: ObjectDefinitionInput[];
  fields?: FieldDefinitionInput[];
  views?: ViewDefinitionInput[];
  layouts?: LayoutDefinitionInput[];
  navItems?: NavItemDefinitionInput[];
  commandItems?: CommandItemDefinitionInput[];
  blocks?: BlockDeclarationInput[];
  pages?: PageDeclarationInput[];
  agents?: AgentDefinitionInput[];
  workflows?: WorkflowDefinitionInput[];
  connections?: ConnectionProviderInput[];
  actions?: ActionDefinitionInput[];
  events?: EventDefinitionInput[];
  policies?: PolicyDefinitionInput[];
};
