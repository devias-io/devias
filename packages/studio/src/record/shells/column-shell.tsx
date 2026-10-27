import type { ColumnLayout } from '@devias/core';
import { cn } from '@devias/ui';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { useMemo } from 'react';
import { RecordMenu } from '../../components/record-menu';
import type { SaveStatus } from '../../hooks/use-record-autosave';
import { useBlocks } from '../../registries';
import { BareBlocksContext, BlockHost, bareCellClass, useVisibleCells } from '../layout-renderer';
import { withPlacedCells } from '../placement';
import { RecordActions } from '../record-actions';
import { useRecordPage } from '../record-page-context';
import { RecordRunStatus } from '../record-run-status';
import type { ShellProps } from './types';

/** What the toolbar says about the page: that it is saving, that it could not, or when it was last edited. */
export const saveStatusText = (status: SaveStatus, updatedAt: unknown): string => {
  if (status === 'saving') {
    return 'Saving…';
  }

  if (status === 'error') {
    return 'Could not save';
  }

  if (typeof updatedAt !== 'string') {
    return '';
  }

  return `Edited ${formatDistanceToNowStrict(parseISO(updatedAt), { addSuffix: true })}`;
};

/**
 * The `column` shape, for things you write in: a slim toolbar (the save status, the ⋯ menu) over one centered column
 * holding the layout's blocks. No breadcrumbs, header card or tabs, and no cards around blocks.
 */
export function ColumnShell({ object, record, layout }: ShellProps<ColumnLayout>) {
  const page = useRecordPage();
  const blocks = useBlocks('record');
  const placed = useMemo(
    () => withPlacedCells(layout.blocks, 'main', layout.blocks, blocks, object),
    [layout.blocks, blocks, object],
  );
  const cells = useVisibleCells(placed);

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 pt-3 pb-16 sm:px-12"
      data-slot="column-shell"
    >
      <div className="mb-14 flex min-h-7 items-center justify-end gap-2 text-xs text-muted-foreground">
        <RecordRunStatus record={record} />
        <RecordActions entries={layout.actions} size="sm" />
        <span aria-live="polite">{saveStatusText(page.status, record.updated_at)}</span>
        <RecordMenu
          object={object}
          record={record}
          onDelete={page.requestDelete}
          label="Record actions"
          triggerProps={{ variant: 'ghost', size: 'icon-sm', className: 'text-muted-foreground' }}
        />
      </div>
      <BareBlocksContext.Provider value>
        <div className="flex flex-col gap-4">
          {cells.map((cell) => (
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
      </BareBlocksContext.Provider>
    </div>
  );
}
