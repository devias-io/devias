import type { FieldMetadata, ObjectMetadata, Sort, ViewMetadata, ViewState, ViewTypeDefinition } from '@devias/core';
import { formatRecordCount, GROUPABLE_FIELD_TYPES, primaryFieldOf, SORTABLE_FIELD_TYPES } from '@devias/core';
import {
  Button,
  cn,
  Icon,
  Input,
  Label,
  OptionSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  UnderlineTabs,
} from '@devias/ui';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRef, useState } from 'react';
import { SearchInput } from '../../components/search-input';
import { useSchema } from '../../providers/schema';
import { getFieldType, useFieldTypes } from '../../registries';
import { moveShownColumn } from '../columns';
import { chipsOf, filterOfChips } from '../filters';
import { AddFilterButton, FilterBar } from './filter-bar';

export interface ViewToolbarProps {
  object: ObjectMetadata;
  view: ViewMetadata;
  views: ViewMetadata[];
  viewType: ViewTypeDefinition;
  fields: FieldMetadata[];
  state: ViewState;
  setState: (patch: Partial<ViewState>) => void;
  hasOverrides: boolean;
  onReset: () => void;
  canSave: boolean;
  onSave: () => void;
  saving: boolean;
  onViewChange?: (viewId: string) => void;
  onNew?: () => void;
  /** Open the import of a file's rows; the button shows next to Create. */
  onImport?: () => void;
  totalCount?: number;
}

/** Toolbar tools are icons; one with something applied reads stronger and shows how many. */
const toolClass = (active: boolean) => cn('gap-1.5 px-2.5 text-muted-foreground', active && 'text-foreground');

function Count({ value }: { value: number }) {
  if (value === 0) {
    return null;
  }

  return <span className="text-xs text-foreground tabular-nums">{value}</span>;
}

/** Record timestamps every object has, offered after its own sortable fields. */
const SYSTEM_SORTS = [
  { name: 'updated_at', label: 'Last edited' },
  { name: 'created_at', label: 'Created' },
];

function SortMenu({
  fields,
  sorts,
  onChange,
}: {
  fields: FieldMetadata[];
  sorts: Sort[];
  onChange: (sorts: Sort[]) => void;
}) {
  const fieldTypes = useFieldTypes();
  const sortable = [
    ...fields
      .filter((f) => getFieldType(fieldTypes, f.type).sortable ?? SORTABLE_FIELD_TYPES.has(f.type))
      .map((f) => ({ name: f.name, label: f.label })),
    ...SYSTEM_SORTS,
  ];
  const remaining = sortable.filter((f) => !sorts.some((s) => s.field === f.name));

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="lg" aria-label="Sort" title="Sort" className={toolClass(sorts.length > 0)} />
        }
      >
        <Icon name="arrow-up-down" className="size-4" />
        Sort
        <Count value={sorts.length} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {sorts.length === 0 ? <div className="text-xs text-muted-foreground">No sorting applied.</div> : null}
        {sorts.map((sort, index) => (
          <div key={sort.field} className="flex items-center gap-1.5">
            <OptionSelect
              size="sm"
              className="min-w-0 flex-1"
              aria-label="Sort by"
              value={sort.field}
              onValueChange={(field) => onChange(sorts.map((s, i) => (i === index ? { ...s, field } : s)))}
              options={sortable.map((f) => ({ value: f.name, label: f.label }))}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange(
                  sorts.map((s, i) => (i === index ? { ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' } : s)),
                )
              }
            >
              <Icon name={sort.direction === 'asc' ? 'arrow-up' : 'arrow-down'} className="size-3.5" />
              {sort.direction === 'asc' ? 'Asc' : 'Desc'}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove sort"
              onClick={() => onChange(sorts.filter((_, i) => i !== index))}
            >
              <Icon name="x" className="size-3.5" />
            </Button>
          </div>
        ))}
        {remaining[0] ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onChange([...sorts, { field: remaining[0]?.name ?? '', direction: 'asc' }])}
          >
            <Icon name="plus" /> Add sort
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The list is vertical: a dragged row follows the pointer up and down only. */
const keepVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type ColumnRow = { column: ViewState['fields'][number]; index: number; field: FieldMetadata };

/** A column's row in the menu. A shown column carries a grip to drag it; the eye shows or hides it. */
function ColumnItem({
  row,
  shown,
  sortable,
  onToggle,
}: {
  row: ColumnRow;
  shown: boolean;
  /** Dragging is on for shown columns, except while a search narrows the list. */
  sortable: boolean;
  onToggle: () => void;
}) {
  const fieldTypes = useFieldTypes();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.column.name,
    disabled: !shown || !sortable,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex h-8 items-center gap-1 rounded-md pr-1 pl-0.5 text-xs hover:bg-muted',
        isDragging && 'relative z-10 bg-muted shadow-md',
      )}
      data-column={row.column.name}
    >
      {shown ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag ${row.field.label} to reorder`}
          disabled={!sortable}
          className={cn(
            'flex size-5 shrink-0 touch-none items-center justify-center rounded-xs text-muted-foreground',
            sortable ? 'cursor-grab opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : 'opacity-0',
            isDragging && 'cursor-grabbing opacity-100',
          )}
          {...attributes}
          {...listeners}
        >
          <Icon name="grip-vertical" className="size-3.5" />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <Icon name={getFieldType(fieldTypes, row.field.type).icon} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn('ml-1 flex-1 truncate', !shown && 'text-muted-foreground')}>{row.field.label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${shown ? 'Hide' : 'Show'} ${row.field.label}`}
        className="text-muted-foreground"
        onClick={onToggle}
      >
        <Icon name={shown ? 'eye' : 'eye-off'} className="size-3.5" />
      </Button>
    </li>
  );
}

/** The title column: first and shown whatever the view says, so it is listed with a lock and has no controls. */
function LockedColumnItem({ field }: { field: FieldMetadata }) {
  const fieldTypes = useFieldTypes();

  return (
    <ul>
      <li
        className="flex h-8 items-center gap-1 rounded-md pr-2 pl-0.5 text-xs"
        data-column={field.name}
        data-locked="true"
        title="The title column always comes first and is always shown"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          <Icon name="lock" className="size-3.5" />
        </span>
        <Icon name={getFieldType(fieldTypes, field.type).icon} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="ml-1 flex-1 truncate">{field.label}</span>
        <span className="text-xs text-muted-foreground">Locked</span>
      </li>
    </ul>
  );
}

/**
 * Which columns the table shows and in what order: the shown ones on top, dragged by their grip into the order the
 * table uses, the hidden ones below; the eye toggles each, and a search narrows long lists.
 */
function FieldsMenu({
  fields,
  columns,
  locked,
  onChange,
}: {
  fields: FieldMetadata[];
  columns: ViewState['fields'];
  /** The title column's field name: always first and always shown, so it is listed but cannot be changed. */
  locked?: string | undefined;
  onChange: (columns: ViewState['fields']) => void;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // A dragged row stays inside the list: dragging it out of the popover would dismiss the popover mid-drag.
  const keepInside: Modifier = ({ transform, draggingNodeRect }) => {
    const box = listRef.current?.getBoundingClientRect();

    if (!box || !draggingNodeRect) {
      return transform;
    }

    const min = box.top - draggingNodeRect.top;
    const max = box.bottom - draggingNodeRect.bottom;

    return { ...transform, y: Math.min(Math.max(transform.y, min), Math.max(min, max)) };
  };
  const lockedField = locked ? fields.find((f) => f.name === locked) : undefined;
  const rows = columns.flatMap((column, index): ColumnRow[] => {
    const field = fields.find((f) => f.name === column.name);

    return field && field.name !== locked ? [{ column, index, field }] : [];
  });
  const needle = query.trim().toLowerCase();
  const matches = (row: ColumnRow) => !needle || row.field.label.toLowerCase().includes(needle);
  const lockedMatches =
    Boolean(lockedField) && (!needle || (lockedField?.label.toLowerCase().includes(needle) ?? false));
  const lockedCount = lockedField ? 1 : 0;
  const visibleRows = rows.filter((row) => row.column.visible);
  const shown = visibleRows.filter(matches);
  const hidden = rows.filter((row) => !row.column.visible && matches(row));
  const hiddenCount = rows.length - visibleRows.length;

  const toggle = (index: number) =>
    onChange(columns.map((column, i) => (i === index ? { ...column, visible: !column.visible } : column)));
  const reorder = ({ active, over }: DragEndEvent) => {
    if (over) {
      onChange(moveShownColumn(columns, String(active.id), String(over.id)));
    }
  };

  return (
    <Popover onOpenChange={(open) => !open && setQuery('')}>
      <PopoverTrigger
        render={<Button variant="ghost" size="lg" aria-label="Fields" title="Fields" className={toolClass(false)} />}
      >
        <Icon name="list-bullets" className="size-4" />
        Fields
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 p-2.5" data-slot="columns-menu">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-medium">
            Columns{' '}
            <span className="font-normal text-muted-foreground tabular-nums">
              {visibleRows.length + lockedCount} of {rows.length + lockedCount}
            </span>
          </span>
          {hiddenCount > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => onChange(columns.map((column) => ({ ...column, visible: true })))}
            >
              Show all
            </Button>
          ) : null}
        </div>
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search columns"
            aria-label="Search columns"
            className="h-8 pl-8"
          />
        </div>
        <div ref={listRef} className="-mx-1 flex max-h-80 flex-col gap-2 overflow-y-auto px-1 [scrollbar-width:thin]">
          {shown.length > 0 || lockedMatches ? (
            <section className="flex flex-col gap-0.5">
              <h3 className="px-2 pt-1 text-xs font-normal text-muted-foreground">Shown</h3>
              {lockedMatches && lockedField ? <LockedColumnItem field={lockedField} /> : null}
              {shown.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[keepVertical, keepInside]}
                  onDragEnd={reorder}
                >
                  <SortableContext items={shown.map((row) => row.column.name)} strategy={verticalListSortingStrategy}>
                    <ul className="flex flex-col gap-0.5">
                      {shown.map((row) => (
                        <ColumnItem
                          key={row.column.name}
                          row={row}
                          shown
                          sortable={!needle}
                          onToggle={() => toggle(row.index)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : null}
            </section>
          ) : null}
          {hidden.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              <h3 className="px-2 pt-1 text-xs font-normal text-muted-foreground">Hidden</h3>
              <ul className="flex flex-col gap-0.5">
                {hidden.map((row) => (
                  <ColumnItem
                    key={row.column.name}
                    row={row}
                    shown={false}
                    sortable={false}
                    onToggle={() => toggle(row.index)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {shown.length === 0 && hidden.length === 0 && !lockedMatches ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No columns match.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The object's views as tabs; the active one sits on a soft pill. */
function ViewTabs({
  view,
  views,
  viewType,
  onViewChange,
}: {
  view: ViewMetadata;
  views: ViewMetadata[];
  viewType: ViewTypeDefinition;
  onViewChange?: (viewId: string) => void;
}) {
  const tabs = views.some((v) => v.id === view.id) ? views : [view];

  return (
    <UnderlineTabs
      aria-label="Views"
      variant="pill"
      value={view.id}
      onValueChange={onViewChange}
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        icon: tab.icon ?? (tab.id === view.id ? viewType.icon : 'table'),
      }))}
    />
  );
}

/** Local edits to the view (filters, sorts, columns): discard them, or save them for everyone. */
function UnsavedChanges({
  canSave,
  saving,
  onReset,
  onSave,
}: {
  canSave: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-slot="view-changes">
      <span className="flex items-center gap-1.5 px-1" title="These changes are only visible to you until saved">
        <span className="size-1.5 rounded-full bg-warning" />
        Unsaved
      </span>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onReset}>
        Reset
      </Button>
      {canSave ? (
        <Button variant="outline" size="xs" disabled={saving} onClick={onSave}>
          Save view
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The header above a view: the object as the page title with its record count, then the object's views as tabs
 * with the tools (search, filter, sort, fields, grouping) beside them, and the active filters below. The create button
 * sits at the right of the title row, above the tools.
 */
export function ViewToolbar({
  object,
  view,
  views,
  viewType,
  fields,
  state,
  setState,
  hasOverrides,
  onReset,
  canSave,
  onSave,
  saving,
  onViewChange,
  onNew,
  onImport,
  totalCount,
}: ViewToolbarProps) {
  const fieldTypes = useFieldTypes();
  const { index } = useSchema();
  const caps = viewType.capabilities ?? {};
  const chips = chipsOf(state.filter);
  const groupable = fields.filter(
    (f) => getFieldType(fieldTypes, f.type).groupable ?? GROUPABLE_FIELD_TYPES.has(f.type),
  );

  return (
    <div data-slot="view-header" className="flex shrink-0 flex-col px-4 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate font-heading text-heading">{object.labelPlural}</h1>
        {totalCount !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums" data-slot="record-count">
            {formatRecordCount(totalCount)} {totalCount === 1 ? 'record' : 'records'}
          </span>
        ) : null}
        {onImport && !object.readOnly ? (
          <Button
            variant="outline"
            className="ms-auto shrink-0"
            aria-label={`Import ${object.labelPlural.toLowerCase()}`}
            onClick={onImport}
          >
            <Icon name="upload" data-icon="inline-start" />
            Import
          </Button>
        ) : null}
        {onNew && !object.readOnly ? (
          <Button
            className={cn('shrink-0', !onImport && 'ms-auto')}
            aria-label={`New ${object.labelSingular.toLowerCase()}`}
            onClick={onNew}
          >
            <Icon name="plus" data-icon="inline-start" />
            Create {object.labelSingular.toLowerCase()}
          </Button>
        ) : null}
      </div>
      <div className="mt-4 flex min-h-9 min-w-0 items-center gap-2">
        <ViewTabs view={view} views={views} viewType={viewType} onViewChange={onViewChange} />
        {hasOverrides ? <UnsavedChanges canSave={canSave} saving={saving} onReset={onReset} onSave={onSave} /> : null}
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {caps.search !== false ? (
            <SearchInput label="Search records" value={state.search} onChange={(search) => setState({ search })} />
          ) : null}
          {caps.filter !== false ? (
            <AddFilterButton
              fields={fields}
              align="end"
              label="Filter"
              size="lg"
              className={toolClass(chips.length > 0)}
              onAdd={(condition) => setState({ filter: filterOfChips([...chips, { kind: 'condition', condition }]) })}
            >
              Filters
              <Count value={chips.length} />
            </AddFilterButton>
          ) : null}
          {caps.sort !== false ? (
            <SortMenu fields={fields} sorts={state.sorts} onChange={(sorts) => setState({ sorts })} />
          ) : null}
          {caps.fields !== false ? (
            <FieldsMenu
              fields={fields}
              columns={state.fields}
              locked={primaryFieldOf(index, object)?.name}
              onChange={(columns) => setState({ fields: columns })}
            />
          ) : null}
          {caps.groupBy && groupable.length > 0 ? (
            <Label className="ms-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              Group by
              <OptionSelect
                size="sm"
                aria-label="Group by"
                value={state.groupBy}
                onValueChange={(groupBy) => setState({ groupBy })}
                options={groupable.map((f) => ({
                  value: f.name,
                  label: f.label,
                  icon: getFieldType(fieldTypes, f.type).icon,
                }))}
              />
            </Label>
          ) : null}
        </div>
      </div>
      {caps.filter !== false && chips.length > 0 ? (
        <div className="pt-3">
          <FilterBar chips={chips} fields={fields} onChange={(next) => setState({ filter: filterOfChips(next) })} />
        </div>
      ) : null}
      <div className="h-3 shrink-0" />
    </div>
  );
}
