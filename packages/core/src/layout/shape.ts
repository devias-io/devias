import {
  ColumnContentSchema,
  type Layout,
  type LayoutCell,
  type LayoutContent,
  type LayoutTab,
  type RecordShell,
  SplitContentSchema,
  TabsContentSchema,
} from '../metadata/schema';

/** The keys a layout may hold besides its base: each shape takes some of them and refuses the rest. */
export const LAYOUT_CONTENT_KEYS = ['header', 'tabs', 'blocks', 'main', 'aside'] as const;
export type LayoutContentKey = (typeof LAYOUT_CONTENT_KEYS)[number];

const SHAPES: Record<RecordShell, { keys: readonly LayoutContentKey[]; required: LayoutContentKey; brief: string }> = {
  tabs: { keys: ['header', 'tabs'], required: 'tabs', brief: 'a `header` and `tabs`' },
  column: { keys: ['blocks'], required: 'blocks', brief: 'one list of `blocks`' },
  split: { keys: ['main', 'aside'], required: 'main', brief: 'a `main` list and an `aside` list' },
};

type LayoutLike = { shell: RecordShell } & { [K in LayoutContentKey]?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A cell's name when none is written: the name its block ends with (`core.comments` is `comments`). */
export const defaultCellKey = (block: string): string => block.slice(block.lastIndexOf('.') + 1);

const withKey = (cell: unknown): unknown =>
  isRecord(cell) && typeof cell.blockId === 'string' && !cell.name
    ? { ...cell, name: defaultCellKey(cell.blockId) }
    : cell;
const withKeys = (cells: unknown): unknown => (Array.isArray(cells) ? cells.map(withKey) : cells);

/** The content of a layout (or the layout input) with every cell's key filled in, and nothing else touched. */
export const withCellKeys = <T extends object>(layout: T): T => {
  const content = layout as Record<string, unknown>;
  const filled: Record<string, unknown> = { ...content };

  if (content.header !== undefined) {
    filled.header = withKey(content.header);
  }

  if (Array.isArray(content.tabs)) {
    filled.tabs = content.tabs.map((tab) => (isRecord(tab) ? { ...tab, blocks: withKeys(tab.blocks) } : tab));
  }

  for (const list of ['blocks', 'main', 'aside'] as const) {
    if (content[list] !== undefined) {
      filled[list] = withKeys(content[list]);
    }
  }

  return filled as T;
};

/** The keys cells of this layout are called, in the order the page draws them. */
const cellKeysOf = (layout: object): string[] => {
  const filled = withCellKeys(layout) as Record<string, unknown>;
  const lists = [
    filled.header === undefined ? [] : [filled.header],
    ...(Array.isArray(filled.tabs) ? filled.tabs.map((tab) => (isRecord(tab) ? tab.blocks : [])) : []),
    filled.blocks,
    filled.main,
    filled.aside,
  ];

  return lists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .flatMap((cell) => (isRecord(cell) ? [String(cell.name)] : []));
};

/**
 * What a layout's shape asks of it, as a sentence a person or the agent can act on; undefined when it fits. A shape
 * holds exactly its own keys: the others are refused rather than ignored, so a page never looks different from what
 * was written.
 */
export const layoutShapeProblem = (layout: LayoutLike): string | undefined => {
  const shape = SHAPES[layout.shell];
  const refused = LAYOUT_CONTENT_KEYS.filter((key) => layout[key] !== undefined && !shape.keys.includes(key));

  if (refused.length > 0) {
    const others = (Object.keys(SHAPES) as RecordShell[]).filter((name) => name !== layout.shell);
    const owners = others
      .filter((name) => refused.some((key) => SHAPES[name].keys.includes(key)))
      .map((name) => `"${name}"`)
      .join(' or ');

    return `A "${layout.shell}" layout is ${shape.brief}, so it has no ${refused.map((key) => `\`${key}\``).join(', ')}${owners ? ` (that is the ${owners} shape)` : ''}`;
  }

  if (layout[shape.required] === undefined) {
    return `A "${layout.shell}" layout is ${shape.brief}: it needs \`${shape.required}\``;
  }

  const keys = cellKeysOf(layout);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);

  if (twice !== undefined) {
    return `Two cells of this layout are called "${twice}": a cell is named after its block, so give each of the two a \`name\` of its own`;
  }

  return undefined;
};

/** A layout's content for its shape, with defaults filled in; throws when it does not fit. */
export const parseLayoutContent = (shell: RecordShell, raw: unknown): LayoutContent => {
  const content = isRecord(raw) ? withCellKeys(raw) : raw;

  switch (shell) {
    case 'tabs':
      return TabsContentSchema.parse(content);
    case 'column':
      return ColumnContentSchema.parse(content);
    case 'split':
      return SplitContentSchema.parse(content);
  }
};

/** The keys of the layout (or input) that make up its content, as stored: only those its shape takes. */
export const layoutContentOf = (layout: LayoutLike): LayoutContent => {
  const picked: Record<string, unknown> = {};

  for (const key of SHAPES[layout.shell].keys) {
    if (layout[key] !== undefined) {
      picked[key] = layout[key];
    }
  }

  return parseLayoutContent(layout.shell, picked);
};

type LayoutBase = Omit<Layout, 'shell' | LayoutContentKey>;

/** A layout of a shape, from what every layout has and the content stored for it. */
export const makeLayout = (base: LayoutBase, shell: RecordShell, rawContent: unknown): Layout => {
  switch (shell) {
    case 'tabs':
      return { ...base, shell, ...parseLayoutContent(shell, rawContent) } as Layout;
    case 'column':
      return { ...base, shell, ...parseLayoutContent(shell, rawContent) } as Layout;
    case 'split':
      return { ...base, shell, ...parseLayoutContent(shell, rawContent) } as Layout;
  }
};

/** Every cell of a layout in the order the page draws them, with where it sits for messages. */
export interface LayoutCellAt {
  /** `Header`, `Tab "Deals"`, `Blocks`, `Main` or `Aside`. */
  where: string;
  /** Its tab, in a `tabs` layout. */
  tab?: LayoutTab;
  cell: LayoutCell;
}

/** Cells and tabs as someone writes them: a cell's `name` may be left out. */
type CellLike = Omit<LayoutCell, 'name'> & { name?: string | undefined };
type TabLike = Omit<LayoutTab, 'blocks'> & { blocks: CellLike[] };

export const layoutCells = (
  input: LayoutLike & {
    header?: CellLike;
    tabs?: TabLike[];
    blocks?: CellLike[];
    main?: CellLike[];
    aside?: CellLike[];
  },
): LayoutCellAt[] => {
  // A stored cell always has a key; here it is filled the same way, so every cell can be named in a message.
  const layout = withCellKeys(input) as LayoutLike & {
    header?: LayoutCell;
    tabs?: LayoutTab[];
    blocks?: LayoutCell[];
    main?: LayoutCell[];
    aside?: LayoutCell[];
  };

  switch (layout.shell) {
    case 'tabs':
      return [
        ...(layout.header ? [{ where: 'Header', cell: layout.header }] : []),
        ...(layout.tabs ?? []).flatMap((tab) => tab.blocks.map((cell) => ({ where: `Tab "${tab.label}"`, tab, cell }))),
      ];
    case 'column':
      return (layout.blocks ?? []).map((cell) => ({ where: 'Blocks', cell }));
    case 'split':
      return [
        ...(layout.main ?? []).map((cell) => ({ where: 'Main', cell })),
        ...(layout.aside ?? []).map((cell) => ({ where: 'Aside', cell })),
      ];
  }
};

type LayoutPatch = { [K in LayoutContentKey]?: unknown } & {
  objectId?: string;
  label?: string;
  isDefault?: boolean;
  shell?: RecordShell;
  actions?: unknown;
};

/**
 * A layout with a patch applied, as the input it would have been created from. Keys present in the patch win; a
 * change of `shell` drops the content of the old shape, so the patch must bring the new one's, and keys the new
 * shape does not take stay in the result for `layoutShapeProblem` to refuse by name.
 */
export const mergeLayoutPatch = (
  current: Pick<Layout, 'objectId' | 'label' | 'isDefault' | 'shell' | 'actions'> & LayoutLike,
  patch: LayoutPatch,
) => {
  const shell = patch.shell ?? current.shell;
  const kept = shell === current.shell ? layoutContentOf(current) : {};
  const sent = Object.fromEntries(
    LAYOUT_CONTENT_KEYS.filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]),
  );

  return {
    objectId: patch.objectId ?? current.objectId,
    label: patch.label ?? current.label,
    isDefault: Object.hasOwn(patch, 'isDefault') ? patch.isDefault : current.isDefault,
    shell,
    actions: Object.hasOwn(patch, 'actions') ? patch.actions : current.actions,
    ...kept,
    ...sent,
  };
};
