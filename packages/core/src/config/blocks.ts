import { coreIds } from '../core-ids';
import type { BlockDeclarationInput } from '../manifest/authoring';
import type { BlockDeclaration } from '../manifest/blocks';
import type { SchemaIndex } from '../metadata/schema';
import type { BlockDefinition, BlockSurface, PageDefinition } from './types';

/** Keeps each id a literal, so `coreIds` is typed by what core declares. (`defineBlock` lives where this would be a cycle.) */
const block = <const T extends BlockDeclarationInput>(declaration: T): T => declaration;

/** The blocks the platform itself ships, declared by core rather than by a module, so every workspace has them: record page blocks layouts can place, the Home defaults, panels and approval cards. */
export const coreBlockInputs = [
  block({
    id: coreIds.blocks.fields,
    label: 'Fields',
    description: "The record's fields, editable in place. config: fieldIds (field ids, default all), collapseEmpty.",
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.related_records,
    label: 'Related records',
    description: 'Records whose relation points at this one. config: objectId, fieldId (the relation field), limit.',
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.title,
    label: 'Title',
    description:
      "The record's title, edited in place. config: fieldId (default the primary field), autosaveMs. The `header` of a `tabs` layout.",
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.rich_text,
    label: 'Rich text',
    description:
      'One rich-text field, written in place. config: fieldId (required), autosaveMs. For `column` and `split` layouts.',
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.activity,
    label: 'Activity',
    description: "The record's history.",
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.comments,
    label: 'Comments',
    description: "The record's comments, with a box to write one.",
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.mentioned_in,
    label: 'Mentioned in',
    description: 'Records whose text mentions this one with @.',
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.tasks,
    label: 'Tasks',
    description: 'The open tasks that are about this record, and a button to add one.',
    surfaces: ['record'],
  }),
  block({
    id: coreIds.blocks.open_tasks,
    label: 'Tasks',
    description: 'Open, due and overdue tasks.',
    surfaces: ['home'],
  }),
  block({
    id: coreIds.blocks.getting_started,
    label: 'Getting started',
    description: 'First steps for a new workspace, ticked off as done.',
    surfaces: ['home'],
  }),
  block({
    id: coreIds.blocks.record_counts,
    label: 'Your data',
    description: 'How many records each object has.',
    surfaces: ['home'],
  }),
  block({
    id: coreIds.blocks.recent_records,
    label: 'Recently updated',
    description: 'The records changed most recently.',
    surfaces: ['home'],
  }),
  block({
    id: coreIds.blocks.recent_documents,
    label: 'Documents',
    description: 'The most recently edited documents.',
    surfaces: ['home'],
  }),
  block({
    id: coreIds.blocks.notifications,
    label: 'Notifications',
    description: "The person's notifications.",
    surfaces: ['panel'],
  }),
  block({
    id: coreIds.blocks.agent_chat,
    label: 'Agent chat',
    description: 'The docked chat panel.',
    surfaces: ['panel'],
  }),
  block({
    id: coreIds.blocks.comment_approval,
    label: 'Confirm a comment',
    description: 'Approval card for a comment the agent writes on a record.',
    surfaces: ['approval'],
  }),
  block({
    id: coreIds.blocks.agent_approval,
    label: 'Confirm an agent change',
    description: 'Approval card for creating or changing an agent.',
    surfaces: ['approval'],
  }),
  block({
    id: coreIds.blocks.ask_agent,
    label: 'Ask the agent',
    description: 'The ask-the-agent composer on Home.',
    surfaces: ['home'],
  }),
] as const satisfies readonly BlockDeclarationInput[];

/** The same, as declarations. */
export const coreBlockDeclarations: BlockDeclaration[] = coreBlockInputs.map((declaration) => ({ ...declaration }));

/** Every block a workspace can use: the platform's, then those its installed modules declare. */
export const availableBlocks = (modules: Iterable<{ blocks: BlockDeclaration[] }>): Map<string, BlockDeclaration> =>
  new Map(
    [...coreBlockDeclarations, ...[...modules].flatMap((module) => module.blocks)].map((block) => [block.id, block]),
  );

/**
 * Why a layout cell's block cannot be right, or undefined when it can: it must be a declared block (`available`, see
 * `availableBlocks`) that renders on record pages. While a module's manifest is applied (`ownModule`), a block it
 * declares is not installed yet, so one nobody declares passes: the plan checked them against the manifest. An `optional` cell passes when the block is missing altogether.
 */
export const blockRefProblem = (
  block: string,
  available: ReadonlyMap<string, BlockDeclaration>,
  ownModule?: string | null,
  optional = false,
): string | undefined => {
  const declared = available.get(block);

  if (declared?.surfaces.includes('record')) {
    return undefined;
  }

  // An optional cell may name a block that is not there: it is left out of the page.
  if (!declared && optional) {
    return undefined;
  }

  if (!declared && ownModule) {
    return undefined;
  }

  const known = [...available.values()].filter((b) => b.surfaces.includes('record')).map((b) => b.id);
  const hint = `blocks for record pages: ${known.join(', ')} (list_blocks describes them)`;

  return declared ? `Block "${block}" does not render on record pages; ${hint}` : `Unknown block "${block}"; ${hint}`;
};

/**
 * Whether what a module contributed is live in a workspace: it came from the studio config itself (no module), from a
 * core module, or from a module installed there. `core` names the core modules, which are never hidden.
 */
export const isModuleActive = (
  module: string | undefined,
  index: SchemaIndex,
  core: ReadonlySet<string> = new Set(),
): boolean => !module || core.has(module) || index.schema.modules.some((m) => m.id === module);

/** The title of the page at `path`, else of its nearest titled ancestor (`billing/new` → Billing's). */
export const pageTitle = (pages: ReadonlyMap<string, PageDefinition>, path: string): string | undefined => {
  const segments = path.split('/');

  while (segments.length > 0) {
    const title = pages.get(segments.join('/'))?.label;

    if (title) {
      return title;
    }

    segments.pop();
  }

  return undefined;
};

/** The page registered under this id, if any. */
export const pageOfId = (pages: ReadonlyMap<string, PageDefinition>, id: string): PageDefinition | undefined =>
  [...pages.values()].find((page) => page.id === id);

/** The page whose path is the nearest strict prefix of `path` and that has a layout, if any. */
export const layoutParentOf = (
  pages: ReadonlyMap<string, PageDefinition>,
  path: string,
): PageDefinition | undefined => {
  const segments = path.split('/');

  while (segments.length > 1) {
    segments.pop();
    const candidate = pages.get(segments.join('/'));

    if (candidate?.layout) {
      return candidate;
    }
  }

  return undefined;
};

/** Whether a page shows in a workspace (sidebar, palette, its route): its module is active there. */
export const isPageAvailable = (page: PageDefinition, index: SchemaIndex, core: ReadonlySet<string> = new Set()) =>
  isModuleActive(page.module, index, core);

/**
 * Whether a block can show in a workspace: its module is active there (see `isModuleActive`), and the objects it
 * requires exist.
 */
export const isBlockAvailable = (
  block: BlockDefinition,
  index: SchemaIndex,
  core: ReadonlySet<string> = new Set(),
): boolean => {
  if (!isModuleActive(block.module, index, core)) {
    return false;
  }

  for (const objectId of block.requires?.objectIds ?? []) {
    if (!index.objectsById.has(objectId)) {
      return false;
    }
  }

  return true;
};

/** The available blocks that render on a surface, Home ones in their `order`. */
export const blocksOn = (
  surface: BlockSurface,
  blocks: Iterable<BlockDefinition>,
  index: SchemaIndex,
  core: ReadonlySet<string> = new Set(),
): BlockDefinition[] => {
  const out = [...blocks].filter((block) => block.surfaces[surface] && isBlockAvailable(block, index, core));

  if (surface === 'home') {
    out.sort((a, b) => (a.surfaces.home?.order ?? 50) - (b.surfaces.home?.order ?? 50));
  }

  return out;
};
