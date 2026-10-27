import {
  andFilters,
  defineViewType,
  type FieldMetadata,
  fieldRef,
  primaryFieldOf,
  QUERY_MAX_LIMIT,
  type Query,
  type RecordData,
  type ViewProps,
} from '@devias/core';
import { Button, cn, EmptyState, Icon } from '@devias/ui';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useRecords } from '../../hooks/use-records';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { getFieldType, useFieldTypes } from '../../registries';

interface CalendarSettings {
  dateFieldId: string;
}

const dayKey = (value: unknown): string | null =>
  typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;

/** A month grid: each record on the day its date field names, opening it on click. */
export function CalendarView({ object, view, state, actions }: ViewProps<CalendarSettings>) {
  const { index } = useSchema();
  const fieldTypes = useFieldTypes();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const dateField = fieldRef(fields, view.settings.dateFieldId);
  const primaryField = primaryFieldOf(index, object);
  const extraField = useMemo(
    () =>
      state.fields
        .filter((f) => f.visible && f.name !== primaryField?.name && f.name !== dateField?.name)
        .map((f) => fields.find((x) => x.name === f.name))
        .find((f): f is FieldMetadata => Boolean(f)),
    [state.fields, fields, primaryField, dateField],
  );
  // The days on the grid, whole weeks, so the days either side of the month show their records too.
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );

  // The visible range is the view's own query, layered on the user's filters and search. It is not written
  // back to the view state, so moving between months never counts as a change to the view.
  const monthQuery = useMemo<Query | null>(() => {
    if (!dateField || days.length === 0) {
      return null;
    }

    const range = [format(days[0] as Date, 'yyyy-MM-dd'), format(days[days.length - 1] as Date, 'yyyy-MM-dd')];
    const search = state.search.trim();

    return {
      object: object.nameSingular,
      filter: andFilters(state.filter, { field: dateField.name, op: 'between', value: range }) ?? undefined,
      ...(search ? { search } : {}),
      ...(extraField?.type === 'relation' ? { include: { [extraField.name]: true as const } } : {}),
      limit: QUERY_MAX_LIMIT,
    };
  }, [object.nameSingular, dateField, days, state.filter, state.search, extraField]);
  const items = useRecords(monthQuery).data?.items;

  const byDay = useMemo(() => {
    const map = new Map<string, RecordData[]>();

    for (const record of items ?? []) {
      const key = dateField ? dayKey(record[dateField.name]) : null;

      if (!key) {
        continue;
      }

      map.set(key, [...(map.get(key) ?? []), record]);
    }

    return map;
  }, [items, dateField]);

  if (!dateField) {
    return (
      <EmptyState
        icon="calendar"
        title="No date field configured"
        description="Set `settings.dateFieldId` on this view to a date field."
      />
    );
  }

  const ExtraCell = extraField ? getFieldType(fieldTypes, extraField.type).cell : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="calendar-view">
      <div className="flex h-9 shrink-0 items-center gap-1 px-5 pb-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setMonth((m) => addMonths(m, -1))}
        >
          <Icon name="chevron-left" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <Icon name="chevron-right" />
        </Button>
        <span className="ml-1 text-xs font-medium">{format(month, 'MMMM yyyy')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => setMonth(startOfMonth(new Date()))}
        >
          Today
        </Button>
      </div>
      <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <div className="grid shrink-0 grid-cols-7 border-b border-border text-center text-xs font-medium text-muted-foreground uppercase">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-auto [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const records = byDay.get(key) ?? [];

            return (
              <div
                key={key}
                className={cn(
                  'flex min-h-24 flex-col gap-0.5 border-r border-b border-border p-1',
                  !isSameMonth(day, month) && 'bg-muted/30 text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'self-end px-1 text-xs tabular-nums',
                    isToday(day) && 'rounded-full bg-primary px-1.5 text-primary-foreground',
                  )}
                >
                  {format(day, 'd')}
                </span>
                {records.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className="flex min-w-0 items-center gap-1 rounded-sm bg-secondary px-1 py-0.5 text-left text-xs text-secondary-foreground hover:bg-secondary/80"
                    onClick={() => actions.openRecord(record.id)}
                  >
                    <span className="truncate font-medium">{recordLabel(record, primaryField)}</span>
                    {ExtraCell && extraField ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        <ExtraCell
                          field={extraField as FieldMetadata & { settings: Record<string, unknown> }}
                          value={record[extraField.name] ?? null}
                          record={record}
                          object={object}
                        />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const calendarViewType = defineViewType<CalendarSettings>({
  type: 'calendar',
  label: 'Calendar',
  icon: 'calendar',
  settingsSchema: z.object({ dateFieldId: z.string() }),
  defaultSettings: (_object, fields) => ({
    dateFieldId: fields.find((f) => f.type === 'date' || f.type === 'date_time')?.id ?? '',
  }),
  capabilities: { filter: true, search: true, sort: false, fields: true, groupBy: false },
  component: CalendarView,
});
