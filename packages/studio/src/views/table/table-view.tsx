import {
  defineViewType,
  type FieldMetadata,
  type FieldTypeDefinition,
  imageFieldOf,
  primaryFieldOf,
  type RecordData,
  type ViewProps,
} from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  cn,
  EmptyState,
  Icon,
  type IconName,
} from '@devias/ui';
import {
  type ColumnDef,
  type ColumnSizingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { isTypingTarget } from '../../commands/keybindings';
import { RecordImage } from '../../fields/links';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { getFieldType, useFieldTypes } from '../../registries';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { TableSkeleton } from '../../shell/skeletons';

export const ROW_HEIGHT = 55;
const SELECT_WIDTH = 36;

interface Editing {
  id: string;
  field: string;
}

/** Owns the draft value while a cell is being edited; commits once. */
function InlineCellEditor({
  field,
  fieldType,
  record,
  object,
  onCommit,
  onCancel,
}: {
  field: FieldMetadata;
  fieldType: FieldTypeDefinition;
  record: RecordData;
  object: ViewProps['object'];
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<unknown>(record[field.name] ?? null);
  // Updated in onChange, not on render: editors like select call onChange and onCommit in the same tick.
  const draftRef = useRef(draft);
  const done = useRef(false);
  const Editor = fieldType.editor;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps editor events from reaching the row
    <div className="w-full" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Editor
        field={field as FieldMetadata & { settings: Record<string, unknown> }}
        value={draft}
        onChange={(value) => {
          setDraft(value);
          draftRef.current = value;
        }}
        mode="inline"
        autoFocus
        record={record}
        object={object}
        onCommit={() => {
          if (done.current) {
            return;
          }

          done.current = true;

          if (draftRef.current !== (record[field.name] ?? null)) {
            onCommit(draftRef.current);
          } else {
            onCancel();
          }
        }}
        onCancel={() => {
          if (done.current) {
            return;
          }

          done.current = true;
          onCancel();
        }}
      />
    </div>
  );
}

export function TableView({ object, state, setState, query, actions, selection }: ViewProps) {
  const { index } = useSchema();
  const fieldTypes = useFieldTypes();
  const { slug } = useWorkspace();
  const { Link } = useNavigation();
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const primaryField = primaryFieldOf(index, object);
  // A picture of each record (a company's logo) goes beside its name.
  const imageField = imageFieldOf(index, object);

  const columnFields = useMemo(() => {
    // The title column leads, whatever the view says: it carries each row's link and is locked in place.
    const names = [primaryField?.name, ...state.fields.filter((f) => f.visible).map((f) => f.name)].filter(
      (name, i, all): name is string => Boolean(name) && all.indexOf(name) === i,
    );

    return names.map((name) => fields.find((f) => f.name === name)).filter((f): f is FieldMetadata => Boolean(f));
  }, [state.fields, fields, primaryField]);

  const widthKey = state.fields.map((f) => `${f.name}:${f.width ?? ''}`).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: widthKey captures the widths read inside
  const columns = useMemo<ColumnDef<RecordData>[]>(
    () =>
      columnFields.map((field) => ({
        id: field.name,
        accessorFn: (row) => row[field.name],
        header: field.label,
        size: state.fields.find((f) => f.name === field.name)?.width ?? (field.name === primaryField?.name ? 220 : 160),
        minSize: 60,
      })),
    [columnFields, primaryField, widthKey],
  );

  const rowSelection = useMemo(() => Object.fromEntries([...selection.ids].map((id) => [id, true])), [selection.ids]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const table = useReactTable({
    data: query.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    columnResizeMode: 'onChange',
    enableRowSelection: true,
    state: { rowSelection, columnSizing },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      selection.set(Object.keys(next).filter((key) => next[key]));
    },
    onColumnSizingChange: setColumnSizing,
  });

  const resizing = table.getState().columnSizingInfo.isResizingColumn;
  const wasResizing = useRef(resizing);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to the end of a resize
  useEffect(() => {
    if (wasResizing.current && !resizing && Object.keys(columnSizing).length > 0) {
      setState({
        fields: state.fields.map((f) => {
          const width = columnSizing[f.name];

          return width ? { ...f, width: Math.round(width) } : f;
        }),
      });
    }

    wasResizing.current = resizing;
  }, [resizing]);

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastIndex >= rows.length - 6) {
      query.fetchNextPage();
    }
  }, [lastIndex, rows.length, query]);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Escape clears the selection, unless the user is typing or the delete confirmation is open.
  const hasSelection = selection.ids.size > 0;
  const clearSelection = selection.clear;
  useEffect(() => {
    if (!hasSelection || confirmDelete) {
      return;
    }

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !isTypingTarget(event.target)) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [hasSelection, confirmDelete, clearSelection]);
  const totalWidth = table.getTotalSize() + SELECT_WIDTH;
  const editable = !object.readOnly;
  // The header's checkbox stays out of the way until the header is hovered or something is already selected.
  const checkboxClass = cn(
    'flex shrink-0 items-center justify-center opacity-0 transition-opacity focus-within:opacity-100',
    selection.ids.size > 0 && 'opacity-100',
  );
  // A row shows its number, swapped for its checkbox while hovered, focused or selected.
  const rowCheckboxClass = cn(
    'hidden size-full items-center justify-center group-focus-within/row:flex group-hover/row:flex group-data-[state=selected]/row:flex',
    selection.ids.size > 0 && 'flex',
  );
  const rowNumberClass = cn(
    'flex size-full items-center justify-center text-xs text-subtle-foreground tabular-nums group-focus-within/row:hidden group-hover/row:hidden group-data-[state=selected]/row:hidden',
    selection.ids.size > 0 && 'hidden',
  );

  const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: string, field: string) => {
    if (!editable) {
      return;
    }

    if (event.key === 'Enter' && !editing) {
      event.preventDefault();
      setEditing({ id, field });
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-slot="table-view">
      {/* Bulk actions float over the table instead of pushing it down. */}
      {selection.ids.size > 0 ? (
        <div
          role="toolbar"
          aria-label="Selected records"
          data-slot="bulk-actions"
          className="absolute bottom-8 left-1/2 z-30 flex h-10 -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-popover py-1 pr-1 pl-3.5 text-xs text-popover-foreground shadow-lg duration-150 animate-in fade-in-0 slide-in-from-bottom-2"
        >
          <span className="pr-2 font-medium whitespace-nowrap tabular-nums">{selection.ids.size} selected</span>
          <span className="mr-1 h-4 w-px bg-border" aria-hidden />
          {editable ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash-2" className="size-3.5" /> Delete
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            title="Clear selection · Esc"
            onClick={selection.clear}
          >
            <Icon name="x" className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {!query.isLoading && rows.length === 0 ? (
        // Nothing to list: no table, just the message, in the middle of the whole content area.
        <div className="mt-2 flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={object.icon ?? 'inbox'}
            title={`No ${object.labelPlural.toLowerCase()} yet`}
            description={
              state.filter || state.search
                ? 'Try clearing the filters or search.'
                : `Create the first ${object.labelSingular.toLowerCase()}.`
            }
            action={
              editable ? (
                <Button size="lg" onClick={() => actions.createRecord()}>
                  <Icon name="plus" className="size-4" /> New {object.labelSingular.toLowerCase()}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {/* Full width, no card: the table scrolls inside this box both ways, under a hairline from the toolbar. */}
          <div className="flex min-h-0 flex-col overflow-clip border-y border-border">
            <div ref={scrollRef} className="min-h-0 overflow-auto" data-slot="table-scroll">
              <div style={{ width: totalWidth, minWidth: '100%' }}>
                <div className="group/header sticky top-0 z-10 flex h-9 border-b border-border bg-background text-xs font-medium text-muted-foreground">
                  <div className={cn(checkboxClass, 'group-hover/header:opacity-100')} style={{ width: SELECT_WIDTH }}>
                    <Checkbox
                      aria-label="Select all"
                      checked={rows.length > 0 && table.getIsAllRowsSelected()}
                      indeterminate={table.getIsSomeRowsSelected()}
                      onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
                    />
                  </div>
                  {table.getFlatHeaders().map((header) => (
                    <div
                      key={header.id}
                      className="relative flex items-center px-2"
                      style={{ width: header.getSize() }}
                    >
                      <span className="truncate">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {/* Resize handle, straddling the column edge. Hovering the header shows a short divider at
                      every edge so the handles can be found; hovering or dragging one extends it to full height. */}
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven column resize handle */}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        title="Drag to resize"
                        className="group/resize absolute top-0 -right-1 z-10 flex h-full w-2 cursor-col-resize touch-none justify-center select-none"
                      >
                        <span
                          className={cn(
                            'my-auto h-4 w-px rounded-full bg-border opacity-0 transition-[height,opacity,background-color]',
                            'group-hover/header:opacity-100 group-hover/resize:h-full group-hover/resize:bg-foreground/40',
                            header.column.getIsResizing() && 'h-full bg-foreground/50 opacity-100',
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {query.isLoading ? (
                  <TableSkeleton />
                ) : (
                  <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {virtualItems.map((virtualRow) => {
                      const row = rows[virtualRow.index];

                      if (!row) {
                        return null;
                      }

                      const record = row.original;

                      return (
                        <div
                          key={row.id}
                          data-state={row.getIsSelected() ? 'selected' : undefined}
                          className="group/row absolute left-0 flex items-center border-b border-border text-xs last:border-b-0 hover:bg-background-hover/50 data-[state=selected]:bg-accent [&_[data-slot=empty-value]]:invisible"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                            height: ROW_HEIGHT,
                            width: totalWidth,
                            minWidth: '100%',
                          }}
                        >
                          <div className="flex h-full shrink-0" style={{ width: SELECT_WIDTH }}>
                            <span className={rowNumberClass} aria-hidden>
                              {virtualRow.index + 1}
                            </span>
                            <span className={rowCheckboxClass}>
                              <Checkbox
                                aria-label="Select row"
                                checked={row.getIsSelected()}
                                onCheckedChange={(checked) => row.toggleSelected(checked)}
                              />
                            </span>
                          </div>
                          {row.getVisibleCells().map((cell) => {
                            const field = columnFields.find((f) => f.name === cell.column.id);

                            if (!field) {
                              return null;
                            }

                            const fieldType = getFieldType(fieldTypes, field.type);
                            const isLabel = field.name === primaryField?.name;
                            const isEditing = editing?.id === record.id && editing.field === field.name;
                            const Cell = fieldType.cell;

                            return (
                              // biome-ignore lint/a11y/noStaticElementInteractions: cells are focusable and open the inline editor on Enter
                              <div
                                key={cell.id}
                                // biome-ignore lint/a11y/noNoninteractiveTabindex: cells are keyboard-focusable so Enter opens the editor
                                tabIndex={0}
                                data-field={field.name}
                                className={cn(
                                  'flex h-full min-w-0 items-center px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                                  isEditing && 'p-0.5',
                                )}
                                style={{ width: cell.column.getSize() }}
                                onDoubleClick={() => editable && setEditing({ id: record.id, field: field.name })}
                                onKeyDown={(e) => onCellKeyDown(e, record.id, field.name)}
                              >
                                {isEditing ? (
                                  <InlineCellEditor
                                    field={field}
                                    fieldType={fieldType}
                                    record={record}
                                    object={object}
                                    onCommit={(value) => {
                                      setEditing(null);
                                      void actions.updateRecord(record.id, { [field.name]: value });
                                    }}
                                    onCancel={() => setEditing(null)}
                                  />
                                ) : isLabel ? (
                                  <span className="flex min-w-0 items-center gap-2">
                                    {imageField ? (
                                      <RecordImage
                                        src={
                                          typeof record[imageField.name] === 'string'
                                            ? (record[imageField.name] as string)
                                            : null
                                        }
                                        icon={object.icon as IconName | undefined}
                                      />
                                    ) : null}
                                    <Link
                                      href={links.record(slug, object.nameSingular, record.id)}
                                      className="truncate font-medium text-foreground underline-offset-2 hover:underline"
                                    >
                                      {recordLabel(record, primaryField)}
                                    </Link>
                                  </span>
                                ) : (
                                  <div className="flex min-w-0 flex-1 items-center">
                                    <Cell
                                      field={field as FieldMetadata & { settings: Record<string, unknown> }}
                                      value={record[field.name] ?? null}
                                      record={record}
                                      object={object}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
                {query.isFetchingNextPage ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Loading more…</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selection.ids.size} {selection.ids.size === 1 ? 'record' : 'records'}?
            </AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false);
                void actions.deleteRecords([...selection.ids]);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const tableViewType = defineViewType({
  type: 'table',
  label: 'Table',
  icon: 'table',
  capabilities: { filter: true, sort: true, fields: true, search: true, groupBy: false },
  component: TableView,
});
