import {
  type BlockDefinition,
  coreKeyOf,
  type LayoutBlock,
  type LayoutCell,
  type LayoutTab,
  type ObjectMetadata,
  type TabsLayout,
} from '@devias/core';

const cellOf = (block: BlockDefinition, label?: string): LayoutBlock => ({
  name: block.id,
  ...(label ? { label } : {}),
  blockId: block.id,
  columnSpan: block.surfaces.record?.span ?? 12,
});

/** The tab key of a block shown in a tab of its own: what a platform block is called, else its id. */
const nameOf = (id: string): string => coreKeyOf(id) ?? id;

/**
 * The tabs of a `tabs` layout plus the blocks that place themselves (`surfaces.record.placement`) on this object's
 * pages and that the layout does not place: `overview` ones go at the end of an `overview` tab, else of the first tab
 * (or an `overview` tab of their own when there are none); `tab` ones in tabs of their own after the others.
 */
export const withPlacedBlocks = (
  layout: Pick<TabsLayout, 'header' | 'tabs'>,
  blocks: Iterable<BlockDefinition>,
  object: Pick<ObjectMetadata, 'id'>,
): LayoutTab[] => {
  const { tabs } = layout;
  const inLayout = new Set(
    [...(layout.header ? [layout.header] : []), ...tabs.flatMap((tab) => tab.blocks)].map((cell) => cell.blockId),
  );
  const missing = [...blocks].filter((block) => {
    const surface = block.surfaces.record;

    if (!surface?.placement || inLayout.has(block.id)) {
      return false;
    }

    return !surface.objectIds || surface.objectIds.includes(object.id);
  });

  if (missing.length === 0) {
    return tabs;
  }

  // A block placed in a tab beside others is a section with its own heading.
  const overview = missing
    .filter((block) => block.surfaces.record?.placement === 'overview')
    .map((block) => cellOf(block, block.label));
  const own = missing
    .filter((block) => block.surfaces.record?.placement === 'tab')
    .map((block) => ({
      name: nameOf(block.id),
      label: block.label,
      icon: block.icon,
      // Alone in its tab, which already names it.
      blocks: [cellOf(block)],
    }));
  // A tab drawn as columns takes what is appended into its first column, under the blocks already there, not on a row of its own.
  const append = (list: LayoutTab[], index: number, cells: LayoutBlock[]) =>
    cells.length === 0
      ? list
      : list.map((tab, i) => {
          if (i !== index) {
            return tab;
          }

          const lanes = tab.blocks.filter((cell) => cell.column !== undefined && cell.row === undefined);
          const first = lanes.reduce<LayoutBlock | undefined>(
            (best, cell) => (best === undefined || (cell.column ?? 0) < (best.column ?? 0) ? cell : best),
            undefined,
          );
          const into = first
            ? cells.map((cell) => ({ ...cell, column: first.column, columnSpan: first.columnSpan }))
            : cells;

          return { ...tab, blocks: [...tab.blocks, ...into] };
        });

  const overviewTab = tabs.findIndex((tab) => tab.name === 'overview');
  const head =
    tabs.length > 0
      ? append(tabs, overviewTab >= 0 ? overviewTab : 0, overview)
      : overview.length > 0
        ? [{ name: 'overview', label: 'Overview', blocks: overview }]
        : [];

  return [...head, ...own];
};

/**
 * The cells of a `column` layout's blocks, or of a `split` layout's `main` or `aside`, plus the blocks that place
 * themselves there (`surfaces.record.placement` is `main` or `aside`) on this object's pages and that the layout does
 * not place. A block goes right after the cell of the block its `after` names, else at the end. `all` is every cell of
 * the layout, for knowing what it already places.
 */
export const withPlacedCells = (
  cells: readonly LayoutCell[],
  area: 'main' | 'aside',
  all: readonly LayoutCell[],
  blocks: Iterable<BlockDefinition>,
  object: Pick<ObjectMetadata, 'id'>,
): LayoutCell[] => {
  const inLayout = new Set(all.map((cell) => cell.blockId));
  const missing = [...blocks].filter((block) => {
    const surface = block.surfaces.record;

    return (
      surface?.placement === area &&
      !inLayout.has(block.id) &&
      (!surface.objectIds || surface.objectIds.includes(object.id))
    );
  });

  if (missing.length === 0) {
    return [...cells];
  }

  const placed = [...cells];

  for (const block of missing) {
    const after = block.surfaces.record?.after;
    const at = after ? placed.findIndex((cell) => cell.blockId === after) : -1;
    placed.splice(at >= 0 ? at + 1 : placed.length, 0, {
      name: block.id,
      // A bare page names a section by its cell's label.
      label: block.label,
      blockId: block.id,
    });
  }

  return placed;
};
