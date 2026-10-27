import { primaryFieldOf, type SplitLayout } from '@devias/core';
import { Breadcrumbs, cn } from '@devias/ui';
import { type CSSProperties, useMemo, useRef } from 'react';
import { RecordMenu } from '../../components/record-menu';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { useBlocks } from '../../registries';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { BareBlocksContext, BlockHost, bareCellClass, useVisibleCells } from '../layout-renderer';
import { withPlacedCells } from '../placement';
import { RecordActions } from '../record-actions';
import { useRecordPage } from '../record-page-context';
import { RecordRunStatus } from '../record-run-status';
import { RAIL_MIN, RailGrip, useRailWidth } from '../resizable-rail';
import { saveStatusText } from './column-shell';
import type { ShellProps } from './types';

/** Where the width a person gave the aside is kept in this browser. */
const ASIDE_WIDTH_KEY = 'devias:record-aside-width';

/**
 * The `split` shape, for a record read like an issue: a top bar (breadcrumbs, the save status, the ⋯ menu), a main
 * column holding the layout's `main` blocks, and an aside on the right holding its `aside` (below the main column on
 * narrow screens). No cards around blocks: a cell's own `label`, when it has one, is a small heading.
 */
export function SplitShell({ object, record, layout }: ShellProps<SplitLayout>) {
  const { index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const page = useRecordPage();
  const blocks = useBlocks('record');
  const everything = useMemo(() => [...layout.main, ...layout.aside], [layout.main, layout.aside]);
  const main = useVisibleCells(
    useMemo(
      () => withPlacedCells(layout.main, 'main', everything, blocks, object),
      [layout.main, everything, blocks, object],
    ),
  );
  const aside = useVisibleCells(
    useMemo(
      () => withPlacedCells(layout.aside, 'aside', everything, blocks, object),
      [layout.aside, everything, blocks, object],
    ),
  );
  const label = recordLabel(record, primaryFieldOf(index, object));
  // The aside's width is the person's to drag, and kept in this browser; until then it is the layout's own.
  const { shown: asideWidth, resize } = useRailWidth(ASIDE_WIDTH_KEY);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  return (
    <div className="@container flex min-h-full flex-1 flex-col bg-background" data-slot="split-shell">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <Breadcrumbs
          items={[{ label: object.labelPlural, href: links.object(slug, object.nameSingular) }, { label }]}
          linkComponent={navigation.Link}
          className="-ml-1 min-w-0"
        />
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <RecordRunStatus record={record} />
          <RecordActions entries={layout.actions} size="sm" />
          <span aria-live="polite">{saveStatusText(page.status, undefined)}</span>
          <RecordMenu
            object={object}
            record={record}
            onDelete={page.requestDelete}
            triggerProps={{ variant: 'ghost', size: 'icon-sm', className: 'text-muted-foreground' }}
          />
        </span>
      </div>
      <BareBlocksContext.Provider value>
        <div ref={bodyRef} className="flex flex-1 flex-col @4xl:flex-row">
          <main className="min-w-0 flex-1 px-6 py-8 @4xl:px-12" data-slot="split-main">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {main.map((cell) => (
                <div
                  key={cell.name}
                  data-cell={cell.name}
                  data-block={cell.blockId}
                  className={cn('min-w-0', bareCellClass(cell))}
                >
                  <BlockHost cell={cell} record={record} object={object} />
                </div>
              ))}
            </div>
          </main>
          {aside.length > 0 ? (
            <aside
              ref={asideRef}
              aria-label={aside.find((cell) => cell.label)?.label ?? 'Details'}
              className={cn(
                // However wide it was dragged, the aside leaves the main column room, so a narrower page (the assistant open) never has one overlap the other.
                'relative shrink-0 border-t border-border px-6 py-8 @4xl:max-w-[calc(100%-32rem)] @4xl:border-t-0 @4xl:border-l',
                asideWidth === null ? '@4xl:w-96 @6xl:w-[26rem]' : '@4xl:w-(--aside-width)',
              )}
              style={asideWidth === null ? undefined : ({ '--aside-width': `${asideWidth}px` } as CSSProperties)}
              data-slot="split-aside"
            >
              <RailGrip
                width={() => asideWidth ?? asideRef.current?.offsetWidth ?? RAIL_MIN}
                gridRef={bodyRef}
                onResize={resize}
                className="-left-2"
              />
              <div className="flex flex-col gap-8">
                {aside.map((cell) => (
                  <div key={cell.name} data-cell={cell.name} data-block={cell.blockId} className="min-w-0">
                    <BlockHost cell={cell} record={record} object={object} />
                  </div>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </BareBlocksContext.Provider>
    </div>
  );
}
