/**
 * How a module author writes a manifest. A module is named by its `id` (`crm`) and every declaration in it carries its
 * own full `id`, written out: `crm.person`, `crm.person.email`, `crm.person.all`, `crm.enrich_person`. Nothing is
 * derived from a name, so an id can be any string that starts with the module's own (a readable one today, a uuid
 * later). What points at a declaration (a view's `objectId`, a layout cell's `blockId`, a nav item's `parentId`) names it by
 * that id too, and `parseManifest` refuses one of this module's that names nothing.
 *
 * - an object and a field also have an API name (`nameSingular`, `name`): what records and the API call them. It is
 *   separate from the id, so it can change in a later version while the id stays.
 * - views, layouts and fields are named inside their object: the id is `<module>.<object>.<thing>`, where `<object>` is
 *   the object's name, also for a view or a field that extends another module's object.
 * - a layout cell may leave its `name` out: it is named after its block.
 *
 * The types below are what the schemas accept, with the one thing the schemas fill in left optional.
 */

import type { z } from 'zod';
import { withCellKeys } from '../layout/shape';
import type { LayoutBlockSchema, LayoutCellSchema, LayoutTabSchema } from '../metadata/schema';
import type { ActionDefinitionSchema, ConnectionProviderSchema, EventDefinitionSchema } from '../module-runtime';
import type { AgentDefinitionSchema } from './agents';
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
 * What a manifest may leave out, filled in before it is parsed so that a parsed one always has it: the key of every
 * layout cell (named after its block), the module's `name` (its `id`) and the `label` of each connection (the module's
 * name). Anything else is left as it is.
 */
export const normalizeManifest = (raw: unknown): unknown => {
  if (!isRecord(raw)) {
    return raw;
  }

  const name = typeof raw.name === 'string' && raw.name ? raw.name : typeof raw.id === 'string' ? raw.id : undefined;
  const filled: Record<string, unknown> = { ...raw, ...(name === undefined ? {} : { name }) };

  if (Array.isArray(raw.layouts)) {
    filled.layouts = raw.layouts.map((layout) => (isRecord(layout) ? withCellKeys(layout) : layout));
  }

  if (Array.isArray(raw.connections) && name !== undefined) {
    filled.connections = raw.connections.map((connection) =>
      isRecord(connection) && !connection.label ? { ...connection, label: name } : connection,
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
/** A cell as an author writes it: its `name` only when the same block is used twice in the layout. */
type CellInput = Omit<z.input<typeof LayoutCellSchema>, 'name'> & { name?: string };
type BlockCellInput = Omit<z.input<typeof LayoutBlockSchema>, 'name'> & { name?: string };
type TabInput = Omit<z.input<typeof LayoutTabSchema>, 'blocks'> & { blocks: BlockCellInput[] };
/** A layout, named inside its object: `<module>.<object>.default`. */
export type LayoutDefinitionInput = Omit<
  z.input<typeof LayoutDefinitionSchema>,
  'shell' | 'header' | 'tabs' | 'blocks' | 'main' | 'aside'
> &
  (
    | { shell: 'tabs'; header?: CellInput; tabs: TabInput[] }
    | { shell: 'column'; blocks: CellInput[] }
    | { shell: 'split'; main: CellInput[]; aside?: CellInput[] }
  );
export type NavItemDefinitionInput = z.input<typeof NavItemDefinitionSchema>;
export type CommandItemDefinitionInput = z.input<typeof CommandItemDefinitionSchema>;
export type BlockDeclarationInput = z.input<typeof BlockDeclarationSchema>;
export type PageDeclarationInput = z.input<typeof PageDeclarationSchema>;
export type AgentDefinitionInput = z.input<typeof AgentDefinitionSchema>;
export type ActionDefinitionInput = z.input<typeof ActionDefinitionSchema>;
/** A connection as an author writes it: its `label` may be left out, and is then the module's name. */
export type ConnectionProviderInput = WithOptionalLabel<z.input<typeof ConnectionProviderSchema>>;
type WithOptionalLabel<T> = T extends unknown ? Omit<T, 'label'> & { label?: string } : never;
export type PolicyDefinitionInput = z.input<typeof PolicyDefinitionSchema>;
/** An event, named as the outside service names it (`email-resend.email.delivered`). */
export type EventDefinitionInput = z.input<typeof EventDefinitionSchema>;

/** What a module author writes: `defineModule` checks it and returns the parsed manifest. */
export type ModuleManifestInput = Omit<
  z.input<typeof ModuleManifestSchema>,
  | 'name'
  | 'objects'
  | 'fields'
  | 'views'
  | 'layouts'
  | 'navItems'
  | 'commandItems'
  | 'blocks'
  | 'pages'
  | 'agents'
  | 'connections'
  | 'actions'
  | 'events'
  | 'policies'
> & {
  /** What people call the module; its `id` when left out. */
  name?: string;
  objects?: ObjectDefinitionInput[];
  fields?: FieldDefinitionInput[];
  views?: ViewDefinitionInput[];
  layouts?: LayoutDefinitionInput[];
  navItems?: NavItemDefinitionInput[];
  commandItems?: CommandItemDefinitionInput[];
  blocks?: BlockDeclarationInput[];
  pages?: PageDeclarationInput[];
  agents?: AgentDefinitionInput[];
  connections?: ConnectionProviderInput[];
  actions?: ActionDefinitionInput[];
  events?: EventDefinitionInput[];
  policies?: PolicyDefinitionInput[];
};
