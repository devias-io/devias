import type { BlockDefinition } from '@devias/core';
import type { Layout, LayoutItem, ResponsiveLayouts } from 'react-grid-layout';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { browserStorage } from '../../lib/browser-storage';

/** Container widths where Home switches columns: four quarter-width blocks, then two, then one per row. */
export const BREAKPOINTS = { lg: 960, md: 560, sm: 0 } as const;
export const COLS = { lg: 12, md: 6, sm: 1 } as const;
export type HomeBreakpoint = keyof typeof BREAKPOINTS;
export const ROW_HEIGHT = 30;

// Tall enough for a mist card: its padding, a sentence, a figure and a footer pill.
const DEFAULTS = { w: 3, h: 6, minW: 3, minH: 4 };

/** Where a block sits, in grid units. Size limits come from its definition, so they are not saved. */
export type BlockPlacement = Pick<LayoutItem, 'i' | 'x' | 'y' | 'w' | 'h'>;

/** One person's Home in one workspace: placements per breakpoint they arranged, and the blocks they removed. */
export interface SavedHomeLayout {
  layouts: Partial<Record<HomeBreakpoint, BlockPlacement[]>>;
  hidden: string[];
}

type BlockSize = Pick<BlockPlacement, 'i' | 'w' | 'h'>;

const bottom = (items: readonly BlockPlacement[]): number => Math.max(0, ...items.map((item) => item.y + item.h));

const byPosition = (a: BlockPlacement, b: BlockPlacement): number => a.y - b.y || a.x - b.x;

/** Places blocks left to right from row `y`, wrapping when a row is full. */
const flow = (items: readonly BlockSize[], cols: number, y = 0): BlockPlacement[] => {
  const placed: BlockPlacement[] = [];
  let x = 0;
  let rowHeight = 0;

  for (const { i, w: width, h } of items) {
    const w = Math.min(width, cols);

    if (x + w > cols) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    placed.push({ i, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }

  return placed;
};

/** Saved placements for the blocks still shown, with the others (new, or added back) flowed after them. */
const arrange = (stored: BlockPlacement[] | undefined, items: readonly BlockSize[], cols: number): BlockPlacement[] => {
  if (!stored) {
    return flow(items, cols);
  }

  const ids = new Set(items.map((item) => item.i));
  const kept = stored.filter((placement) => ids.has(placement.i));
  const placed = new Set(kept.map((placement) => placement.i));

  return [
    ...kept,
    ...flow(
      items.filter((item) => !placed.has(item.i)),
      cols,
      bottom(kept),
    ),
  ];
};

const withLimits = (placement: BlockPlacement, block: BlockDefinition, cols: number): LayoutItem => {
  const { minW = DEFAULTS.minW, minH = DEFAULTS.minH, maxW, maxH } = block.surfaces.home?.layout ?? {};

  return {
    ...placement,
    minW: Math.min(minW, cols),
    minH,
    ...(maxW !== undefined && { maxW }),
    ...(maxH !== undefined && { maxH }),
  };
};

/**
 * The grid layouts for the visible blocks, which come in their `order`. Without saved placements they flow in that
 * order on large screens, and in the large screen's reading order on smaller ones.
 */
export const resolveLayouts = (
  blocks: readonly BlockDefinition[],
  saved: SavedHomeLayout | undefined,
): ResponsiveLayouts<HomeBreakpoint> => {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const sizes = blocks.map((block) => {
    const layout = block.surfaces.home?.layout;

    return { i: block.id, w: layout?.w ?? DEFAULTS.w, h: layout?.h ?? DEFAULTS.h };
  });
  const large = arrange(saved?.layouts.lg, sizes, COLS.lg);
  const readingOrder = [...large].sort(byPosition);
  const layouts: ResponsiveLayouts<HomeBreakpoint> = {};

  for (const breakpoint of Object.keys(BREAKPOINTS) as HomeBreakpoint[]) {
    const cols = COLS[breakpoint];
    const placements = breakpoint === 'lg' ? large : arrange(saved?.layouts[breakpoint], readingOrder, cols);
    layouts[breakpoint] = placements.map((placement) =>
      withLimits(placement, byId.get(placement.i) as BlockDefinition, cols),
    );
  }

  return layouts;
};

const toPlacements = (layout: Layout): BlockPlacement[] => layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

/** Whether two layouts put every block in the same place. */
export const samePlacements = (a: Layout, b: Layout | undefined): boolean =>
  b !== undefined &&
  JSON.stringify(toPlacements([...a].sort(byPosition))) === JSON.stringify(toPlacements([...b].sort(byPosition)));

const EMPTY: SavedHomeLayout = { layouts: {}, hidden: [] };

interface HomeLayoutStore {
  /** Keyed by `workspaceId:userId`. */
  saved: Record<string, SavedHomeLayout>;
  arrange: (key: string, breakpoint: HomeBreakpoint, layout: Layout) => void;
  hide: (key: string, blockId: string) => void;
  show: (key: string, blockId: string) => void;
  reset: (key: string) => void;
}

/** Each person's Home arrangement, remembered in this browser. */
export const useHomeLayoutStore = create<HomeLayoutStore>()(
  persist(
    (set) => {
      const update = (key: string, next: (current: SavedHomeLayout) => SavedHomeLayout) =>
        set((s) => ({ saved: { ...s.saved, [key]: next(s.saved[key] ?? EMPTY) } }));

      return {
        saved: {},
        arrange: (key, breakpoint, layout) =>
          update(key, (s) => ({ ...s, layouts: { ...s.layouts, [breakpoint]: toPlacements(layout) } })),
        // A removed block leaves its placements too, so adding it back puts it after the others.
        hide: (key, blockId) =>
          update(key, (s) => ({
            layouts: Object.fromEntries(
              Object.entries(s.layouts).map(([breakpoint, placements]) => [
                breakpoint,
                placements?.filter((placement) => placement.i !== blockId),
              ]),
            ),
            hidden: s.hidden.includes(blockId) ? s.hidden : [...s.hidden, blockId],
          })),
        show: (key, blockId) => update(key, (s) => ({ ...s, hidden: s.hidden.filter((id) => id !== blockId) })),
        reset: (key) =>
          set((s) => {
            const next = { ...s.saved };
            delete next[key];

            return { saved: next };
          }),
      };
    },
    { name: 'devias.studio.home-layout', storage: createJSONStorage(browserStorage('local')) },
  ),
);
