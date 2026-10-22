import type { BlockDefinition, LayoutBlock, LayoutCell, ObjectMetadata, RecordData } from '@devias/core';
import { cn, EmptyState, Section } from '@devias/ui';
import { type CSSProperties, createContext, type ReactNode, useContext, useMemo, useRef } from 'react';
import { useBlock, useBlocks } from '../registries';
import { ErrorBoundary } from '../shell/error-boundary';
import { RAIL_MIN, RailGrip, useRailWidth } from './resizable-rail';

/**
 * CSS variables consumed by the grid classes: `--col` is the 12-column placement (used from `md` up),
 * `--row` the explicit row. Without a `column`, a cell spans `columnSpan` columns in flow order.
 */
export const placementStyle = (cell: Pick<LayoutBlock, 'column' | 'columnSpan' | 'row'>): CSSProperties => {
  const span = cell.columnSpan ?? 12;

  return {
    '--col': cell.column ? `${cell.column} / span ${span}` : `span ${span}`,
    '--row': cell.row ? String(cell.row) : 'auto',
  } as CSSProperties;
};

/** Where the width a person gave a page's rail (the lane beside the first) is kept in this browser. */
const RAIL_WIDTH_KEY = 'devias:record-rail-width';

/** The block in a cell, with the cell's config checked against the block's schema. */
function BlockContent({
  block,
  cell,
  record,
  object,
}: {
  block: BlockDefinition;
  cell: LayoutBlock;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const parsed = block.config?.safeParse(cell.config ?? {});

  if (parsed && !parsed.success) {
    return (
      <EmptyState
        icon="triangle-alert"
        className="py-6"
        title="Invalid block config"
        description={parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
          .join('; ')}
      />
    );
  }

  const Component = block.component;

  return (
    <ErrorBoundary compact title={`Block "${cell.name}" failed to render`}>
      <Component config={parsed ? parsed.data : (cell.config ?? {})} surface="record" record={record} object={object} />
    </ErrorBoundary>
  );
}

/**
 * The cells a page draws: an `optional` cell whose block is not available in this workspace (its module is not
 * installed, or an object it needs is missing) is left out, so the page has no gap or rule where it would have been.
 */
export const useVisibleCells = <T extends LayoutCell>(cells: readonly T[]): T[] => {
  const available = useBlocks('record');

  return useMemo(() => {
    const ids = new Set(available.map((block) => block.id));

    return cells.filter((cell) => !cell.optional || ids.has(cell.blockId));
  }, [cells, available]);
};

/** Shells that read like a document or an issue draw their blocks without a card: they say so here. */
export const BareBlocksContext = createContext(false);

/** What sets a bare cell with a heading apart from the one above it: a rule. */
export const bareCellClass = (cell: LayoutBlock): string | undefined =>
  cell.label ? 'not-first:mt-4 not-first:border-t not-first:border-border not-first:pt-6' : undefined;

const Framed = ({ title, flush, children }: { title?: string; flush?: boolean; children: ReactNode }) => (
  <Section variant="plain" title={title} flush={flush} className="h-full">
    {children}
  </Section>
);

/**
 * One cell of a record page: the block it names, in a bordered card under its heading unless the block draws its own. The
 * heading is the cell's `label`; a cell without one has none. Cells naming no registered block
 * show a placeholder so a layout never breaks the page.
 */
export function BlockHost({ cell, record, object }: { cell: LayoutBlock; record: RecordData; object: ObjectMetadata }) {
  const block = useBlock(cell.blockId);
  const bare = useContext(BareBlocksContext);

  if (!block) {
    return (
      <Framed>
        <EmptyState
          icon="puzzle"
          className="py-6"
          title={`Unknown block "${cell.blockId}"`}
          description={`Cell "${cell.name}" names a block no module registered.`}
        />
      </Framed>
    );
  }

  const content = <BlockContent block={block} cell={cell} record={record} object={object} />;

  if (bare) {
    // No card: the cell's own `label`, when it has one, is a small heading; the block's own label is not shown.
    return (
      <section aria-label={cell.label || undefined}>
        {cell.label ? <h2 className="mb-3 text-xs font-medium text-muted-foreground">{cell.label}</h2> : null}
        {content}
      </section>
    );
  }

  if (block.surfaces.record?.frame === false) {
    return content;
  }

  return (
    <Framed title={cell.label} flush={block.surfaces.record?.flush}>
      {content}
    </Framed>
  );
}

/**
 * 12-column grid honoring column / columnSpan / row; stacks into one column on narrow screens. Cells that name a
 * `column` but no `row` form a lane: those of the same column stack under each other in their own column, so the
 * height of one lane never stretches a cell in another (a form on the left, its context on the right).
 */
export function LayoutRenderer({
  blocks: layoutBlocks,
  record,
  object,
}: {
  blocks: LayoutBlock[];
  record: RecordData;
  object: ObjectMetadata;
}) {
  const blocks = useVisibleCells(layoutBlocks);
  const isLane = (cell: LayoutBlock) => cell.column !== undefined && cell.row === undefined;
  const laneOf = (cell: LayoutBlock) => blocks.filter((other) => isLane(other) && other.column === cell.column);
  const hasLanes = blocks.some(isLane);
  // A page of exactly two columns, a main one and a rail, lets the rail's width be dragged.
  const laneColumns = [...new Set(blocks.filter(isLane).map((cell) => cell.column ?? 1))].sort((a, b) => a - b);
  const resizable = blocks.every(isLane) && laneColumns.length === 2 && (laneColumns[0] ?? 1) === 1;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const { shown: railWidth, resize } = useRailWidth(RAIL_WIDTH_KEY);
  const shown = resizable ? railWidth : null;

  return (
    <div
      ref={gridRef}
      className={cn(
        'grid grid-cols-1 @3xl:grid-cols-12',
        hasLanes ? 'gap-x-10 gap-y-8' : 'gap-4',
        shown !== null && '@3xl:grid-cols-[minmax(0,1fr)_var(--rail-width)]',
      )}
      style={shown !== null ? ({ '--rail-width': `${shown}px` } as CSSProperties) : undefined}
      data-slot="layout-grid"
    >
      {blocks.map((cell) => {
        if (isLane(cell)) {
          const lane = laneOf(cell);

          // The lane is drawn where its first cell is, with that cell's width.
          if (lane[0] !== cell) {
            return null;
          }

          // A lane beside the first column is a rail: one white panel with a hairline, its blocks spaced out inside it with smaller headings.
          const rail = (cell.column ?? 1) > 1;

          return (
            <div
              key={`lane-${cell.column}`}
              ref={rail && resizable ? railRef : undefined}
              data-lane={cell.column}
              data-rail={rail ? '' : undefined}
              className={cn(
                'flex min-w-0 flex-col @3xl:[grid-column:var(--col)]',
                rail && 'self-start rounded-lg bg-card p-5 ring-1 ring-card-border',
                rail && resizable && 'relative',
              )}
              // With a chosen rail width the page is two plain tracks, so the lanes take one each.
              style={
                shown !== null
                  ? ({ ...placementStyle(cell), '--col': rail ? '2' : '1' } as CSSProperties)
                  : placementStyle(cell)
              }
            >
              {lane.map((member) => (
                <div
                  key={member.name}
                  data-cell={member.name}
                  data-block={member.blockId}
                  className={cn('min-w-0', rail ? 'not-first:mt-7' : 'not-first:mt-10')}
                >
                  <BlockHost cell={member} record={record} object={object} />
                </div>
              ))}
              {rail && resizable ? (
                <RailGrip
                  width={() => shown ?? railRef.current?.offsetWidth ?? RAIL_MIN}
                  gridRef={gridRef}
                  onResize={resize}
                  className="-left-6"
                />
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={cell.name}
            data-cell={cell.name}
            data-block={cell.blockId}
            className="min-w-0 @3xl:[grid-column:var(--col)] @3xl:[grid-row:var(--row)]"
            style={placementStyle(cell)}
          >
            <BlockHost cell={cell} record={record} object={object} />
          </div>
        );
      })}
    </div>
  );
}
