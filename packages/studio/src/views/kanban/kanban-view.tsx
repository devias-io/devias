import {
  andFilters,
  defineViewType,
  type FieldMetadata,
  type Filter,
  fieldRef,
  formatRecordCount,
  GROUPABLE_FIELD_TYPES,
  primaryFieldOf,
  type Query,
  type RecordData,
  type ViewProps,
} from '@devias/core';
import { Button, cn, EmptyState, Icon, Skeleton } from '@devias/ui';
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { optionDotClass, optionsOf } from '../../fields/shared';
import { useInfiniteRecords } from '../../hooks/use-records';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { getFieldType, useFieldTypes } from '../../registries';
import { buildQuery } from '../build-query';

interface Lane {
  key: string;
  value: string | boolean | null;
  label: string;
  color?: string;
}

interface PendingMove {
  record: RecordData;
  lane: string;
}

const NO_VALUE = '__none__';

const lanesFor = (field: FieldMetadata): Lane[] => {
  const lanes: Lane[] =
    field.type === 'boolean'
      ? [
          { key: 'true', value: true, label: 'Yes', color: 'green' },
          { key: 'false', value: false, label: 'No', color: 'neutral' },
        ]
      : optionsOf(field.settings).map((o) => ({ key: o.value, value: o.value, label: o.label, color: o.color }));

  return [...lanes, { key: NO_VALUE, value: null, label: 'No value' }];
};

function KanbanCard({
  record,
  label,
  fields,
  object,
  className,
}: {
  record: RecordData;
  label: string;
  fields: FieldMetadata[];
  object: ViewProps['object'];
  className?: string;
}) {
  const fieldTypes = useFieldTypes();

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-xs transition-colors hover:border-strong-border',
        className,
      )}
    >
      <div className="truncate leading-snug font-medium">{label}</div>
      {fields.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {fields.map((field) => {
            const Cell = getFieldType(fieldTypes, field.type).cell;

            return (
              <div key={field.name} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="w-20 shrink-0 truncate text-subtle-foreground">{field.label}</span>
                <div className="flex min-w-0 flex-1 items-center">
                  <Cell
                    field={field as FieldMetadata & { settings: Record<string, unknown> }}
                    value={record[field.name] ?? null}
                    record={record}
                    object={object}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DraggableCard(props: {
  record: RecordData;
  lane: string;
  label: string;
  fields: FieldMetadata[];
  object: ViewProps['object'];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.record.id,
    data: { record: props.record, lane: props.lane },
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's attributes add role="button" and tabIndex
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        isDragging && 'opacity-40',
      )}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          props.onOpen();
        }
      }}
    >
      <KanbanCard record={props.record} label={props.label} fields={props.fields} object={props.object} />
    </div>
  );
}

function KanbanLane({
  lane,
  groupField,
  baseQuery,
  cardFields,
  primaryField,
  aggregateField,
  object,
  pending,
  onSettled,
  actions,
}: {
  lane: Lane;
  groupField: FieldMetadata;
  baseQuery: Query;
  cardFields: FieldMetadata[];
  primaryField: FieldMetadata | undefined;
  aggregateField: FieldMetadata | undefined;
  object: ViewProps['object'];
  pending: Map<string, PendingMove>;
  onSettled: (id: string) => void;
  actions: ViewProps['actions'];
}) {
  const fieldTypes = useFieldTypes();
  const query = useMemo<Query>(() => {
    const laneFilter: Filter =
      lane.value === null
        ? { field: groupField.name, op: 'is_empty' }
        : { field: groupField.name, op: 'eq', value: lane.value };
    const filter = andFilters(baseQuery.filter, laneFilter);

    return { ...baseQuery, ...(filter ? { filter } : {}) };
  }, [baseQuery, groupField.name, lane.value]);
  const result = useInfiniteRecords(query);
  const { setNodeRef, isOver } = useDroppable({ id: lane.key });

  const items = useMemo(() => {
    const own = result.items.filter((r) => {
      const move = pending.get(r.id);

      return !move || move.lane === lane.key;
    });
    const incoming = [...pending.values()]
      .filter((m) => m.lane === lane.key && !result.items.some((r) => r.id === m.record.id))
      .map((m) => m.record);

    return [...incoming, ...own];
  }, [result.items, pending, lane.key]);

  useEffect(() => {
    for (const record of result.items) {
      const move = pending.get(record.id);

      if (move && move.lane === lane.key) {
        onSettled(record.id);
      }
    }
  }, [result.items, pending, lane.key, onSettled]);

  const sum = aggregateField
    ? items.reduce(
        (acc, r) => acc + (typeof r[aggregateField.name] === 'number' ? (r[aggregateField.name] as number) : 0),
        0,
      )
    : undefined;
  const count = result.totalCount ?? items.length;

  return (
    <div
      ref={setNodeRef}
      data-lane={lane.key}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg bg-muted/30 ring-1 ring-transparent transition-colors ring-inset',
        isOver && 'bg-muted/60 ring-border',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        {lane.value === null ? (
          <span className="size-2 shrink-0 rounded-full border border-subtle-foreground" />
        ) : (
          <span className={cn('size-2 shrink-0 rounded-full', optionDotClass(lane.color))} />
        )}
        <span className="truncate text-xs font-medium">{lane.label}</span>
        <span className="text-xs text-subtle-foreground tabular-nums">{formatRecordCount(count)}</span>
        {sum !== undefined && aggregateField && count > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {getFieldType(fieldTypes, aggregateField.type).toText(
              sum,
              aggregateField as FieldMetadata & { settings: Record<string, unknown> },
            )}
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {result.isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : null}
        {items.map((record) => (
          <DraggableCard
            key={record.id}
            record={record}
            lane={lane.key}
            label={recordLabel(record, primaryField)}
            fields={cardFields}
            object={object}
            onOpen={() => actions.openRecord(record.id)}
          />
        ))}
        {result.hasNextPage ? (
          <Button variant="ghost" size="sm" disabled={result.isFetchingNextPage} onClick={result.fetchNextPage}>
            Load more
          </Button>
        ) : null}
        {/* Right after the cards, so adding one never means travelling to the bottom of the screen. */}
        {!object.readOnly && !result.isLoading ? (
          items.length === 0 ? (
            <button
              type="button"
              className="flex h-20 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-subtle-foreground transition-colors outline-none hover:border-strong-border hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => actions.createRecord({ [groupField.name]: lane.value })}
            >
              <Icon name="plus" className="size-3.5" /> New
            </button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full shrink-0 justify-start text-muted-foreground"
              onClick={() => actions.createRecord({ [groupField.name]: lane.value })}
            >
              <Icon name="plus" className="size-3.5" /> New
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

export function KanbanView({ object, view, state, setState, actions }: ViewProps) {
  const { index } = useSchema();
  const fieldTypes = useFieldTypes();
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const primaryField = primaryFieldOf(index, object);
  const groupField =
    fieldRef(fields, state.groupBy ?? view.config.groupById) ??
    fields.find((f) => getFieldType(fieldTypes, f.type).groupable ?? GROUPABLE_FIELD_TYPES.has(f.type));

  useEffect(() => {
    if (groupField && state.groupBy !== groupField.name) {
      setState({ groupBy: groupField.name });
    }
  }, [groupField, state.groupBy, setState]);

  const [pending, setPending] = useState<Map<string, PendingMove>>(() => new Map());
  const [active, setActive] = useState<RecordData | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const lanes = useMemo(() => (groupField ? lanesFor(groupField) : []), [groupField]);
  const baseQuery = useMemo(
    () => buildQuery(object, state, fieldTypes, fields, { limit: 50, count: true }),
    [object, state, fieldTypes, fields],
  );
  const cardFields = useMemo(
    () =>
      state.fields
        .filter((f) => f.visible && f.name !== primaryField?.name && f.name !== groupField?.name)
        .map((f) => fields.find((x) => x.name === f.name))
        .filter((f): f is FieldMetadata => Boolean(f)),
    [state.fields, fields, primaryField, groupField],
  );
  const aggregate = (view.settings as { aggregate?: { fieldId?: string } }).aggregate;
  const aggregateField = fieldRef(fields, aggregate?.fieldId);

  const onSettled = (id: string) =>
    setPending((current) => {
      if (!current.has(id)) {
        return current;
      }

      const next = new Map(current);
      next.delete(id);

      return next;
    });

  if (!groupField) {
    return (
      <EmptyState
        icon="kanban"
        title="Nothing to group by"
        description="A kanban needs a select or checkbox field. Add one to this object or pick a table view."
      />
    );
  }

  const onDragEnd = async (event: DragEndEvent) => {
    setActive(null);
    const lane = lanes.find((l) => l.key === event.over?.id);
    const data = event.active.data.current as { record?: RecordData; lane?: string } | undefined;
    const record = data?.record;

    if (!lane || !record || data?.lane === lane.key) {
      return;
    }

    const moved = { ...record, [groupField.name]: lane.value };
    setPending((current) => new Map(current).set(record.id, { record: moved, lane: lane.key }));

    try {
      await actions.updateRecord(record.id, { [groupField.name]: lane.value });
      setTimeout(() => onSettled(record.id), 5000);
    } catch {
      onSettled(record.id);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) =>
        setActive((event.active.data.current as { record?: RecordData } | undefined)?.record ?? null)
      }
      onDragCancel={() => setActive(null)}
      onDragEnd={(event) => void onDragEnd(event)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-6 pt-3 pb-6" data-slot="kanban-view">
        {lanes.map((lane) => (
          <KanbanLane
            key={lane.key}
            lane={lane}
            groupField={groupField}
            baseQuery={baseQuery}
            cardFields={cardFields}
            primaryField={primaryField}
            aggregateField={aggregateField}
            object={object}
            pending={pending}
            onSettled={onSettled}
            actions={actions}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <KanbanCard
            record={active}
            label={recordLabel(active, primaryField)}
            fields={cardFields}
            object={object}
            className="w-68 rotate-1 shadow-md"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export const kanbanViewType = defineViewType({
  type: 'kanban',
  label: 'Kanban',
  icon: 'kanban',
  capabilities: { filter: true, sort: true, fields: true, search: true, groupBy: true },
  component: KanbanView,
});
