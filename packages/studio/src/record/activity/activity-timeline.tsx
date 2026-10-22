import {
  type ActivityChange,
  type ActivityEntry,
  type FieldMetadata,
  type ObjectMetadata,
  primaryFieldOf,
  type RecordData,
} from '@devias/core';
import { Button, cn, EmptyState, Icon, type IconName, Skeleton } from '@devias/ui';
import { startOfDay } from 'date-fns';
import { type ComponentProps, type ReactNode, useMemo, useState } from 'react';
import { PlainOptionsContext } from '../../fields/shared';
import { useActivity } from '../../hooks/use-activity';
import { ago } from '../../lib/time';
import { useSchema } from '../../providers/schema';
import { getFieldType, useFieldTypes } from '../../registries';
import { ActorName, dayLabel, fullDate, Marker, type Person, useActors } from './shared';

function ChangeIcon({ name }: { name: IconName }) {
  return <Icon name={name} className="size-4" />;
}

const isBlank = (value: unknown): boolean => value === null || value === undefined || value === '';

/** The full date and time under a change, the way a payments dashboard shows it; how long ago on hover. */
function Stamp({ at }: { at: string }) {
  const date = new Date(at);

  return (
    <time dateTime={at} title={ago(date)} className="mt-0.5 block w-fit text-[12px] text-muted-foreground tabular-nums">
      {fullDate(date)}
    </time>
  );
}

/**
 * A value in a change, the way its field shows it. One that was replaced is quieter and struck through (`replaced`), or
 * only quieter (`quiet`) where its column already says it is the old one.
 */
function Value({
  field,
  value,
  record,
  object,
  replaced,
  quiet: faded,
}: {
  field: FieldMetadata | undefined;
  value: unknown;
  record: RecordData;
  object: ObjectMetadata;
  replaced?: boolean;
  quiet?: boolean;
}) {
  const fieldTypes = useFieldTypes();
  const actors = useActors();
  const quiet = replaced
    ? 'text-muted-foreground line-through decoration-muted-foreground/40 opacity-75'
    : faded
      ? 'text-muted-foreground opacity-75'
      : '';

  if (!field) {
    return <span className={cn('truncate', quiet)}>{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
  }

  // A team member is their name here, without the avatar, and resting on it says who they are.
  if (field.type === 'member' && typeof value === 'string' && value !== '') {
    return (
      <span className={cn('truncate', quiet)}>
        <ActorName person={actors({ kind: 'user', id: value })} />
      </span>
    );
  }

  const Cell = getFieldType(fieldTypes, field.type).cell;

  return (
    <span className={cn('inline-flex max-w-72 min-w-0 items-center overflow-hidden align-middle', quiet)}>
      <PlainOptionsContext.Provider value>
        <Cell
          field={field as FieldMetadata & { settings: Record<string, unknown> }}
          value={value}
          record={record}
          object={object}
        />
      </PlainOptionsContext.Provider>
    </span>
  );
}

const Arrow = () => <Icon name="arrow-right" className="size-3.5 shrink-0 text-muted-foreground" />;

/** What a field went from and to: the new value alone when there was none before, the old one struck through otherwise. */
function Transition({
  change,
  field,
  record,
  object,
}: {
  change: ActivityChange;
  field: FieldMetadata | undefined;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const had = !isBlank(change.before);
  const has = !isBlank(change.after);

  return (
    <>
      {had ? <Value field={field} value={change.before} record={record} object={object} replaced /> : null}
      {had && has ? <Arrow /> : null}
      {has ? (
        <Value field={field} value={change.after} record={record} object={object} />
      ) : (
        <>
          {had ? <Arrow /> : null}
          <span className="text-muted-foreground italic">empty</span>
        </>
      )}
    </>
  );
}

const Dash = () => <span className="text-muted-foreground">–</span>;

/** Every change of an update as a table: the field, what it was, what it is now. */
function ChangeTable({
  changes,
  fields,
  record,
  object,
}: {
  changes: ActivityChange[];
  fields: Map<string, FieldMetadata>;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const cell = 'min-w-0 border-t border-border py-1.5 pr-4 align-middle';

  return (
    <table className="mt-3 mb-1 w-full table-fixed border-collapse text-xs" data-slot="activity-changes">
      <thead>
        <tr className="text-left text-xs font-medium text-foreground">
          <th scope="col" className="w-28 pr-4 pb-1.5 font-medium sm:w-36">
            Field
          </th>
          <th scope="col" className="pr-4 pb-1.5 font-medium">
            Before
          </th>
          <th scope="col" className="pb-1.5 font-medium">
            After
          </th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => {
          const field = fields.get(change.field);

          return (
            <tr key={change.field}>
              <th scope="row" className={cn(cell, 'truncate text-left font-normal')}>
                {field?.label ?? change.field}
              </th>
              <td className={cell}>
                {isBlank(change.before) ? (
                  <Dash />
                ) : (
                  <Value field={field} value={change.before} record={record} object={object} quiet />
                )}
              </td>
              <td className={cn(cell, 'pr-0 text-foreground')}>
                {isBlank(change.after) ? (
                  <Dash />
                ) : (
                  <Value field={field} value={change.after} record={record} object={object} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const NAMES_SHOWN = 6;

/** The fields an update touched, in a quiet line: the first few, then how many more. */
const namesOf = (changes: ActivityChange[], fields: Map<string, FieldMetadata>): string => {
  const names = changes.map((change) => fields.get(change.field)?.label ?? change.field);
  const more = names.length - NAMES_SHOWN;

  return more > 0 ? `${names.slice(0, NAMES_SHOWN).join(', ')} +${more} more` : names.join(', ');
};

/** One change as a sentence: "set Website to …", "cleared Logo …", "changed Stage … → …". */
function ChangeSentence({
  who,
  change,
  field,
  record,
  object,
}: {
  who: ReactNode;
  change: ActivityChange;
  field: FieldMetadata | undefined;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const verb = isBlank(change.before) ? 'set' : isBlank(change.after) ? 'cleared' : 'changed';

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        {who} {verb} <span className="text-foreground">{field?.label ?? change.field}</span>
        {verb === 'set' ? ' to' : ''}
      </span>
      {verb === 'set' ? (
        <span className="inline-flex min-w-0 items-center text-foreground">
          <Value field={field} value={change.after} record={record} object={object} />
        </span>
      ) : verb === 'cleared' ? (
        // What it was, struck through; "empty" after an arrow would only say it twice.
        <span className="inline-flex min-w-0 items-center text-foreground">
          <Value field={field} value={change.before} record={record} object={object} replaced />
        </span>
      ) : (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
          <Transition change={change} field={field} record={record} object={object} />
        </span>
      )}
    </span>
  );
}

function ChangeItem({
  entry,
  person,
  fields,
  primaryField,
  record,
  object,
}: {
  entry: ActivityEntry;
  person: Person;
  fields: Map<string, FieldMetadata>;
  primaryField: string | undefined;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const [open, setOpen] = useState(false);
  const noun = object.labelSingular.toLowerCase();
  const who = <ActorName person={person} className="font-medium text-foreground" />;
  let icon: IconName = 'pencil';
  let summary: ReactNode;
  // The fields an update touched beyond the one the headline names, and every change of it as a table.
  let touched: ActivityChange[] = [];
  let several = false;

  if (entry.kind === 'created') {
    icon = 'plus';
    summary = (
      <>
        {who} created this {noun}
      </>
    );
  } else if (entry.kind === 'deleted') {
    icon = 'trash-2';
    summary = (
      <>
        {who} deleted this {noun}
      </>
    );
  } else {
    const [only] = entry.changes;

    if (entry.changes.length === 1 && only) {
      summary = (
        <ChangeSentence who={who} change={only} field={fields.get(only.field)} record={record} object={object} />
      );
    } else {
      several = true;
      // The headline is what the record is called now, when that changed; the rest is counted and named below it.
      const named = entry.changes.find((change) => change.field === primaryField && !isBlank(change.after));
      touched = entry.changes.filter((change) => change !== named);
      summary = named ? (
        <>
          {who} {isBlank(named.before) ? 'named' : 'renamed'} this {noun} to{' '}
          <span className="font-medium text-foreground">
            <Value field={fields.get(named.field)} value={named.after} record={record} object={object} />
          </span>{' '}
          and changed {touched.length} other {touched.length === 1 ? 'field' : 'fields'}
        </>
      ) : (
        <>
          {who} updated {entry.changes.length} fields
        </>
      );
    }
  }

  return (
    <li className="flex gap-3" data-activity={entry.kind}>
      <Marker>
        <ChangeIcon name={icon} />
      </Marker>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        <div className="pt-1">
          {summary}
          {several ? (
            <button
              type="button"
              aria-expanded={open}
              className="ms-1.5 inline-flex items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setOpen((value) => !value)}
            >
              <Icon name="chevron-right" className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
              {open ? 'Hide changes' : 'Show changes'}
            </button>
          ) : null}
        </div>
        <Stamp at={entry.occurredAt} />
        {several && !open ? <p className="mt-0.5 text-[13px]">{namesOf(touched, fields)}</p> : null}
        {several && open && entry.kind === 'updated' ? (
          <ChangeTable changes={entry.changes} fields={fields} record={record} object={object} />
        ) : null}
      </div>
    </li>
  );
}

/** Updates by the same actor closer together than this read as one run. */
const RUN_GAP_MS = 30 * 60_000;

type Row = { entries: [ActivityEntry, ...ActivityEntry[]] };

const sameActor = (a: ActivityEntry, b: ActivityEntry): boolean => JSON.stringify(a.actor) === JSON.stringify(b.actor);

/**
 * Newest first: consecutive updates by the same actor, close in time, become one row, so a burst of edits is one line
 * that opens, not a page of them. Everything else is a row of its own.
 */
const foldRuns = (entries: ActivityEntry[]): Row[] => {
  const rows: Row[] = [];

  for (const entry of entries) {
    const row = rows.at(-1);
    const last = row?.entries.at(-1);

    if (
      row &&
      last &&
      entry.kind === 'updated' &&
      last.kind === 'updated' &&
      sameActor(last, entry) &&
      Math.abs(new Date(last.occurredAt).getTime() - new Date(entry.occurredAt).getTime()) <= RUN_GAP_MS
    ) {
      row.entries.push(entry);
    } else {
      rows.push({ entries: [entry] });
    }
  }

  return rows;
};

/** Several updates by one actor in a row: counted and named, and opened into the updates themselves. */
function RunItem({
  entries,
  person,
  fields,
  primaryField,
  record,
  object,
}: {
  entries: ActivityEntry[];
  person: Person;
  fields: Map<string, FieldMetadata>;
  primaryField: string | undefined;
  record: RecordData;
  object: ObjectMetadata;
}) {
  const [open, setOpen] = useState(false);
  // Each field once, in the order it was last touched.
  const touched = [
    ...new Map(
      entries
        .flatMap((entry) => (entry.kind === 'updated' ? entry.changes : []))
        .map((change) => [change.field, change]),
    ),
  ].map(([, change]) => change);

  return (
    <>
      <li className="flex gap-3" data-activity="run">
        <button
          type="button"
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setOpen((value) => !value)}
        >
          <Marker>
            <Icon name="chevrons-up-down" className="size-4" />
          </Marker>
          <span className="truncate">
            {open ? 'Hide' : 'Show'} {entries.length} updates{open ? '' : `: ${namesOf(touched, fields)}`}
          </span>
        </button>
      </li>
      {open
        ? entries.map((entry) => (
            <ChangeItem
              key={entry.id}
              entry={entry}
              person={person}
              fields={fields}
              primaryField={primaryField}
              record={record}
              object={object}
            />
          ))
        : null}
    </>
  );
}

/** What the activity lists need to tell who did what: the object's fields by name, the one that names a record, and the people. */
function useActivityContext(object: ObjectMetadata) {
  const { index } = useSchema();
  const fields = useMemo(
    () => new Map((index.fieldsByObjectId.get(object.id) ?? []).map((field) => [field.name, field])),
    [index, object.id],
  );
  const primaryField = primaryFieldOf(index, object)?.name;
  const personOfActor = useActors();

  return { fields, primaryField, personOfActor };
}

/** Entries as rows of the rail, updates in a burst by one actor folded into one. */
function ActivityList({
  object,
  record,
  entries,
  ...props
}: {
  object: ObjectMetadata;
  record: RecordData;
  entries: ActivityEntry[];
} & Omit<ComponentProps<'ol'>, 'children'>) {
  const { fields, primaryField, personOfActor } = useActivityContext(object);
  const rows = useMemo(() => foldRuns(entries), [entries]);

  return (
    <ol {...props}>
      {rows.map(({ entries: [first, ...rest] }) =>
        rest.length === 0 ? (
          <ChangeItem
            key={first.id}
            entry={first}
            person={personOfActor(first.actor)}
            fields={fields}
            primaryField={primaryField}
            record={record}
            object={object}
          />
        ) : (
          <RunItem
            key={first.id}
            entries={[first, ...rest]}
            person={personOfActor(first.actor)}
            fields={fields}
            primaryField={primaryField}
            record={record}
            object={object}
          />
        ),
      )}
    </ol>
  );
}

/**
 * Some entries of a record's activity, each a sentence with its date and time under it: the list a record's overview
 * shows as its recent activity. The timeline adds day headings.
 */
export function ActivityEntries({
  object,
  record,
  entries,
}: {
  object: ObjectMetadata;
  record: RecordData;
  entries: ActivityEntry[];
}) {
  return (
    <ActivityList
      object={object}
      record={record}
      entries={entries}
      className="flex flex-col gap-3"
      data-slot="recent-activity"
    />
  );
}

/**
 * A record's activity: what happened to the record, newest first and grouped by day. Changes show their values the way
 * the field displays them. Writing about a record is for its notes.
 */
export function ActivityTimeline({ object, record }: { object: ObjectMetadata; record: RecordData }) {
  const activity = useActivity(object.nameSingular, record.id);
  const days = useMemo(() => {
    const groups: { key: number; label: string; entries: ActivityEntry[] }[] = [];

    for (const entry of activity.data?.pages.flatMap((page) => page.items) ?? []) {
      const date = new Date(entry.occurredAt);
      const key = startOfDay(date).getTime();
      const group = groups.at(-1);

      if (group?.key === key) {
        group.entries.push(entry);
      } else {
        groups.push({ key, label: dayLabel(date), entries: [entry] });
      }
    }

    return groups;
  }, [activity.data]);

  return (
    <div className="flex flex-col gap-6" data-slot="activity-timeline">
      {activity.isPending ? (
        <div className="flex flex-col gap-3 pl-10">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : activity.isError ? (
        <EmptyState icon="circle-alert" title="Could not load the activity" description="Try again in a moment." />
      ) : days.length === 0 ? (
        <p className="pl-10 text-xs text-muted-foreground">Nothing has happened here yet.</p>
      ) : (
        <div className="flex flex-col gap-7">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label}>
              <h3 className="mb-3 flex items-center gap-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase after:h-px after:flex-1 after:bg-border">
                {day.label}
              </h3>
              <ActivityList object={object} record={record} entries={day.entries} className="flex flex-col gap-3" />
            </section>
          ))}
        </div>
      )}
      {activity.hasNextPage ? (
        <div className="pl-10">
          <Button
            variant="outline"
            size="sm"
            disabled={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            Show older activity
          </Button>
        </div>
      ) : null}
    </div>
  );
}
