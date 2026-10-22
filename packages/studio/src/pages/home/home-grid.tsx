import type { BlockDefinition } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import type { ComponentProps } from 'react';
import {
  getBreakpointFromWidth,
  type Layout,
  type ResizeHandleAxis,
  Responsive,
  type ResponsiveLayouts,
  useContainerWidth,
} from 'react-grid-layout';
import { ErrorBoundary } from '../../shell/error-boundary';
import { BREAKPOINTS, COLS, type HomeBreakpoint, ROW_HEIGHT, samePlacements } from './layout';

const GAP = [16, 16] as const;
// No top-edge handle: the grip sits there.
const HANDLES: ResizeHandleAxis[] = ['ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const HANDLE_POSITION: Record<ResizeHandleAxis, string> = {
  n: '-top-2 left-1/2 -translate-x-1/2 cursor-ns-resize',
  s: '-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize',
  e: '-right-2 top-1/2 -translate-y-1/2 cursor-ew-resize',
  w: '-left-2 top-1/2 -translate-y-1/2 cursor-ew-resize',
  ne: '-top-2 -right-2 cursor-nesw-resize',
  sw: '-bottom-2 -left-2 cursor-nesw-resize',
  nw: '-top-2 -left-2 cursor-nwse-resize',
  se: '-bottom-2 -right-2 cursor-nwse-resize',
};

/**
 * A square grip on a card's edge or corner, like a selection box in a design tool. The grid clones it with its
 * axis, a ref and the pointer handlers, so everything is passed through to the element.
 */
function ResizeHandle({ handleAxis, className, ...props }: ComponentProps<'span'> & { handleAxis?: ResizeHandleAxis }) {
  return (
    <span
      aria-hidden
      data-slot="resize-handle"
      className={cn(
        'absolute z-10 grid size-4 place-items-center opacity-0 transition-opacity group-hover/card:opacity-100',
        handleAxis && HANDLE_POSITION[handleAxis],
        className,
      )}
      {...props}
    >
      <span className="size-2 border border-foreground/50 bg-background" />
    </span>
  );
}

/** Shown on hover while customizing, astride the block's top edge: move the block by its grip, or take it off Home. */
function BlockHandle({ block, onRemove }: { block: BlockDefinition; onRemove: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-3.5 z-10 flex justify-center opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
      <div className="pointer-events-auto flex divide-x divide-border rounded-md border border-border bg-background shadow-sm">
        <button
          type="button"
          aria-label={`Move ${block.label}`}
          className="home-card-grip grid size-7 cursor-grab place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <Icon name="grip-vertical" className="size-3.5 rotate-90" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${block.label}`}
          className="grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onRemove}
        >
          <Icon name="x" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export interface HomeGridProps {
  blocks: BlockDefinition[];
  layouts: ResponsiveLayouts<HomeBreakpoint>;
  /** Customizing: blocks move by their grip and resize from their edges. */
  editing: boolean;
  /** After someone moves or resizes a block: the new layout for the current breakpoint. */
  onArrange: (breakpoint: HomeBreakpoint, layout: Layout) => void;
  onRemove: (blockId: string) => void;
}

/** The Home blocks on a twelve-column grid (react-grid-layout), arranged per breakpoint. */
export function HomeGrid({ blocks, layouts, editing, onArrange, onRemove }: HomeGridProps) {
  // The grid picks its breakpoint once it mounts, so wait for the real width.
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true });
  const breakpoint = getBreakpointFromWidth(BREAKPOINTS, width);
  // One block per row on narrow screens: they only reorder there.
  const resizable = editing && breakpoint !== 'sm';
  // Saved only when a gesture changed something, so an untouched Home keeps following the defaults.
  const save = (layout: Layout) => {
    if (!samePlacements(layout, layouts[breakpoint])) {
      onArrange(breakpoint, layout);
    }
  };

  return (
    <div
      ref={containerRef}
      data-slot="home-grid"
      data-editing={editing || undefined}
      className={cn(
        '[&_.react-grid-item]:transition-[transform,width,height] [&_.react-grid-item]:duration-200 [&_.react-grid-item]:ease-out',
        // The moving block follows the pointer without easing.
        '[&_.react-grid-item.resizing]:z-20 [&_.react-grid-item.resizing]:transition-none',
        '[&_.react-grid-item.react-draggable-dragging]:z-30 [&_.react-grid-item.react-draggable-dragging]:shadow-lg [&_.react-grid-item.react-draggable-dragging]:transition-none',
        '[&_.react-grid-item.react-grid-placeholder]:border [&_.react-grid-item.react-grid-placeholder]:border-dashed [&_.react-grid-item.react-grid-placeholder]:border-input [&_.react-grid-item.react-grid-placeholder]:bg-muted/50 [&_.react-grid-item.react-grid-placeholder]:duration-100 [&_.react-grid-item.react-grid-placeholder]:select-none',
      )}
    >
      {mounted ? (
        <Responsive<HomeBreakpoint>
          // The blocks are positioned inside the grid, which grows with them; the grid measures drags from here too.
          className="relative transition-[height] duration-200"
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={ROW_HEIGHT}
          margin={GAP}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editing, handle: '.home-card-grip' }}
          resizeConfig={{ enabled: resizable, handles: resizable ? HANDLES : [], handleComponent: <ResizeHandle /> }}
          onDragStop={save}
          onResizeStop={save}
        >
          {blocks.map((block) => {
            const Component = block.component;

            return (
              <div key={block.id} data-block={block.id} className="group/card">
                {editing ? <BlockHandle block={block} onRemove={() => onRemove(block.id)} /> : null}
                <div className="h-full min-w-0">
                  <ErrorBoundary compact title={`${block.label} failed to load`}>
                    <Component config={{}} surface="home" />
                  </ErrorBoundary>
                </div>
              </div>
            );
          })}
        </Responsive>
      ) : null}
    </div>
  );
}
