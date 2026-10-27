import { type FieldMetadata, type ObjectMetadata, primaryFieldOf, type SchemaIndex, type ToolCall } from '@devias/core';
import { Icon } from '@devias/ui';
import { Fragment, type ReactNode } from 'react';
import { useNavigateTo } from '../../hooks/use-navigate-to';
import { useSchema } from '../../providers/schema';
import { getFieldType, useFieldTypes } from '../../registries';

/** `send_email` → "Send email", `create_record` → "Create record". */
export const toolLabel = (name: string): { title: string } => {
  const words = name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

  return { title: words.charAt(0).toUpperCase() + words.slice(1) };
};

/** The module whose action a tool is: a module's action is called by its name, which is unique across the tools. */
export const moduleOfTool = (index: SchemaIndex, name: string): string | undefined =>
  index.schema.modules.find((module) => module.actions.some((action) => action.name === name))?.id;

export const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Short human summary of a result: the error message, or a few key facts. */
export const summarize = (call: ToolCall): string | null => {
  const result = call.result as Record<string, unknown> | undefined;

  if (!result || typeof result !== 'object') {
    return null;
  }

  const error = result.error as { message?: string } | undefined;

  if (error?.message) {
    return error.message;
  }

  if (typeof result.message === 'string') {
    return result.message;
  }

  if (typeof result.deleted === 'number') {
    return `Deleted ${count(result.deleted, 'record', 'records')}`;
  }

  if (typeof result.totalCount === 'number') {
    return `${count(result.totalCount, 'matching record', 'matching records')}`;
  }

  if (typeof result.label === 'string') {
    return result.label;
  }

  if (Array.isArray(result.objects)) {
    return count(result.objects.length, 'object', 'objects');
  }

  if (Array.isArray(result.hits)) {
    return count(result.hits.length, 'hit', 'hits');
  }

  return null;
};

/** `job_title` → "Job title". */
const humanize = (key: string): string => {
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
};

const objectOf = (index: SchemaIndex, name: unknown): ObjectMetadata | undefined =>
  typeof name === 'string' ? index.objectsByName.get(name) : undefined;

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The name a record goes by: the object's label field, from a record the tool returned. */
const nameOf = (index: SchemaIndex, object: ObjectMetadata, record: unknown): string | undefined => {
  const field = primaryFieldOf(index, object);

  return field && isPlain(record) ? str(record[field.name]) : undefined;
};

/** The tools whose row is a sentence of its own (see `titleOf`), not their name. */
export const readsAsSentence = (name: string): boolean =>
  ['create_record', 'update_record', 'delete_records', 'get_record', 'lookup_records', 'list_records'].includes(name);

/** What a row says: the verb in the foreground, what it was about and a short result after it, muted. */
export interface CallTitle {
  verb: string;
  subject?: string;
  note?: string;
}

/**
 * A call as a sentence ("Updated Buy bread", "Searched companies for “Devias” · 1 match") for the tools whose input
 * and result say it plainly; any other tool gets its own name, its module and what it summed up.
 */
export const titleOf = (call: ToolCall, index: SchemaIndex): CallTitle => {
  const input = isPlain(call.input) ? call.input : {};
  const result = isPlain(call.result) && !call.isError ? call.result : {};
  const done = call.status === 'executed';
  const object = objectOf(index, input.object) ?? objectOf(index, result.object);
  const one = object ? `a ${object.labelSingular.toLowerCase()}` : 'a record';
  const many = object ? object.labelPlural.toLowerCase() : 'records';

  switch (call.name) {
    case 'create_record':
      return { verb: done ? 'Created' : 'Create', subject: (done ? str(result.label) : undefined) ?? one };
    case 'update_record':
      return { verb: done ? 'Updated' : 'Update', subject: (done ? str(result.label) : undefined) ?? one };
    case 'delete_records': {
      const n = Array.isArray(input.ids) ? input.ids.length : 0;
      const noun = object
        ? (n === 1 ? object.labelSingular : object.labelPlural).toLowerCase()
        : count(n, 'record', 'records').replace(/^\d+ /, '');

      return { verb: done ? 'Deleted' : 'Delete', subject: n > 0 ? `${n} ${noun}` : many };
    }
    case 'get_record':
      return { verb: 'Read', subject: (object ? nameOf(index, object, result.record) : undefined) ?? one };
    case 'lookup_records': {
      const where = Array.isArray(input.objects)
        ? input.objects
            .map((name) => objectOf(index, name)?.labelPlural.toLowerCase())
            .filter(Boolean)
            .join(' and ')
        : '';
      const hits = Array.isArray(result.hits) ? result.hits.length : undefined;

      return {
        verb: 'Searched',
        subject: `${where || 'everything'} for “${str(input.text) ?? ''}”`,
        ...(hits !== undefined ? { note: count(hits, 'match', 'matches') } : {}),
      };
    }
    case 'ask_user': {
      const answer = str(result.answer);

      // While it waits, the card below already shows the question; the row only names what is happening.
      if (call.status === 'pending') {
        return { verb: 'Question' };
      }

      return {
        verb: 'Asked',
        subject: `“${str(input.question) ?? ''}”`,
        ...(answer ? { note: `Answered: ${answer}` } : call.status === 'rejected' ? { note: 'Skipped' } : {}),
      };
    }
    case 'list_records': {
      const found = typeof result.totalCount === 'number' ? result.totalCount : undefined;
      const search = str(input.search);

      return {
        verb: search ? 'Searched' : 'Found',
        subject: search ? `${many} for “${search}”` : many,
        ...(found !== undefined ? { note: count(found, 'match', 'matches') } : {}),
      };
    }
  }

  const { title } = toolLabel(call.name);
  const note = [moduleOfTool(index, call.name), call.isError ? undefined : summarize(call)].filter(Boolean).join(' · ');

  return { verb: title, ...(note ? { note } : {}) };
};

/** The pairs of a record page's details, as a call's body shows them: a fixed label column, so a wide panel leaves no gap. */
export const PAIRS = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1';

/** A record the call touched or found, as a link to it. */
function RecordLink({ object, id, label, detail }: { object: string; id: string; label: string; detail?: string }) {
  const nav = useNavigateTo();

  return (
    <a
      href={nav.href.record(object, id)}
      data-slot="tool-call-record"
      className="inline-flex w-fit max-w-full items-center gap-1 font-medium underline-offset-2 hover:underline"
      onClick={(event) => {
        event.preventDefault();
        nav.toRecord(object, id);
      }}
    >
      <span className="truncate">{label}</span>
      {detail ? <span className="shrink-0 font-normal text-muted-foreground">{detail}</span> : null}
      <Icon name="arrow-right" className="size-3.5 shrink-0" />
    </a>
  );
}

/** The fields a call set, each as the app shows it: its label, "In progress" for a select, the name of a relation. */
function ChangedFields({ object, values }: { object: ObjectMetadata; values: Record<string, unknown> }) {
  const { index } = useSchema();
  const fieldTypes = useFieldTypes();
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const rows = Object.entries(values).flatMap(([name, value]): { label: string; value: ReactNode }[] => {
    const field: FieldMetadata | undefined = fields.find((candidate) => candidate.name === name);

    if (value === null || value === '') {
      return [{ label: field?.label ?? humanize(name), value: 'Cleared' }];
    }

    if (!field) {
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? [{ label: humanize(name), value: String(value) }]
        : [];
    }

    const type = getFieldType(fieldTypes, field.type);

    if (field.type === 'relation') {
      const Cell = type.display ?? type.cell;
      const record = { id: '', created_at: '', updated_at: '', [name]: value };

      return [
        { label: field.label, value: <Cell field={field as never} value={value} record={record} object={object} /> },
      ];
    }

    // The agent writes rich text as Markdown, so a string is shown as it was written.
    const text = field.type === 'rich_text' && typeof value === 'string' ? value : type.toText(value, field as never);

    return text
      ? [{ label: field.label, value: <span className="line-clamp-4 whitespace-pre-line">{text}</span> }]
      : [];
  });

  if (rows.length === 0) {
    return null;
  }

  return (
    <dl data-slot="tool-call-changes" className={PAIRS}>
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className="truncate text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The most records a call lists before "and N more". */
const LISTED = 8;

/** The records a lookup found, each a link, and how many more there were. */
function Found({
  items,
  more,
}: {
  items: { object: string; id: string; label: string; detail?: string }[];
  more: number;
}) {
  return (
    <div data-slot="tool-call-found" className="flex flex-col gap-1">
      {items.map((item) => (
        <RecordLink key={`${item.object}/${item.id}`} {...item} />
      ))}
      {more > 0 ? <div className="text-muted-foreground">and {more} more</div> : null}
    </div>
  );
}

/**
 * What a call did, in the person's words, for the tools whose input and result say it plainly: the record it touched
 * as a link, the fields it set, the records it found. `null` for every other tool.
 */
export function callBody(call: ToolCall, index: SchemaIndex): ReactNode | null {
  const input = isPlain(call.input) ? call.input : null;

  if (!input) {
    return null;
  }

  const result = isPlain(call.result) && !call.isError ? call.result : {};
  const object = objectOf(index, input.object) ?? objectOf(index, result.object);

  switch (call.name) {
    case 'create_record':
    case 'update_record': {
      const values = isPlain(call.name === 'create_record' ? input.data : input.patch)
        ? call.name === 'create_record'
          ? input.data
          : input.patch
        : null;
      const target =
        str(result.id) && str(result.label)
          ? { object: object?.nameSingular ?? '', id: String(result.id), label: String(result.label) }
          : null;

      if (!target?.object && !(object && values)) {
        return null;
      }

      return (
        <>
          {target?.object ? <RecordLink {...target} /> : null}
          {object && values ? <ChangedFields object={object} values={values as Record<string, unknown>} /> : null}
        </>
      );
    }
    case 'get_record': {
      const id = str(input.id);
      const label = object ? nameOf(index, object, result.record) : undefined;

      return object && id && label ? <RecordLink object={object.nameSingular} id={id} label={label} /> : null;
    }
    case 'lookup_records': {
      const hits = Array.isArray(result.hits) ? result.hits.filter(isPlain) : [];
      const items = hits
        .filter((hit) => str(hit.object) && str(hit.id))
        .slice(0, LISTED)
        .map((hit) => ({
          object: String(hit.object),
          id: String(hit.id),
          label: str(hit.label) ?? String(hit.id),
          ...(str(hit.subtitle) ? { detail: String(hit.subtitle) } : {}),
        }));

      return items.length > 0 ? <Found items={items} more={hits.length - items.length} /> : null;
    }
    case 'list_records': {
      if (!object || !Array.isArray(result.items)) {
        return null;
      }

      const items = result.items
        .filter(isPlain)
        .slice(0, LISTED)
        .flatMap((item) => {
          const label = nameOf(index, object, item) ?? str(item.id);

          return label && str(item.id) ? [{ object: object.nameSingular, id: String(item.id), label }] : [];
        });
      const total = typeof result.totalCount === 'number' ? result.totalCount : result.items.length;

      return items.length > 0 ? <Found items={items} more={total - items.length} /> : null;
    }
  }

  return null;
}
