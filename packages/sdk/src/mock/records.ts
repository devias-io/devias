import {
  type AggregateQuery,
  AggregateQuerySchema,
  type AggregateResult,
  aggregateProblem,
  aggregateRecords,
  cascadeRelationsOf,
  DeviasApiError,
  evaluateFilter,
  type FieldMetadata,
  filterFields,
  hashValue,
  IMPORT_ERRORS_MAX,
  type ImportBody,
  type ImportReport,
  type Include,
  isDeletable,
  isImportable,
  type LookupHit,
  type LookupInput,
  LookupInputSchema,
  matchesSearch,
  type ObjectMetadata,
  type Page,
  primaryFieldOf,
  QUERY_DEFAULT_LIMIT,
  type Query,
  QuerySchema,
  RESERVED_FIELD_NAMES,
  type RecordData,
  readCell,
  SEARCHABLE_FIELD_TYPES,
  type Sort,
  sortRecords,
  stableStringify,
  valueSchemaForField,
} from '@devias/core';
import type { MockStore, StoredRecord } from './store';

/**
 * Record operations over the store. Reads run the query IR through core's evaluators so behaviour
 * matches the server's SQL compiler; writes validate with the same value schemas the studio uses.
 */

const SYSTEM_KEYS = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'] as const;
const DEFAULT_SORT: Sort[] = [{ field: 'updated_at', direction: 'desc' }];

interface Issue {
  field: string;
  message: string;
}

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

export const resolveObject = (store: MockStore, name: string): ObjectMetadata => {
  const object = store.objectByName(name);

  if (!object) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Unknown object "${name}"`);
  }

  return object;
};

const toPublic = (record: StoredRecord): RecordData => {
  const { deleted_at: _deletedAt, ...rest } = record;

  return structuredClone(rest);
};

const project = (record: RecordData, select: string[] | undefined): RecordData => {
  if (!select) {
    return record;
  }

  const out: Record<string, unknown> = {};

  for (const key of [...SYSTEM_KEYS, ...select]) {
    if (key in record) {
      out[key] = record[key];
    }
  }

  return out as RecordData;
};

// Cursors are opaque: an offset plus a hash of the parts of the query that define the ordering.
const encodeCursor = (offset: number, key: string): string => btoa(JSON.stringify({ o: offset, k: key }));

const decodeCursor = (cursor: string, key: string): number => {
  try {
    const parsed = JSON.parse(atob(cursor)) as { o?: unknown; k?: unknown };

    if (parsed.k !== key || typeof parsed.o !== 'number' || !Number.isInteger(parsed.o) || parsed.o < 0) {
      throw 0;
    }

    return parsed.o;
  } catch {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The cursor is malformed or belongs to a different query');
  }
};

const relationTarget = (store: MockStore, field: FieldMetadata): ObjectMetadata | undefined => {
  const target = (field.settings as { targetObjectId?: unknown }).targetObjectId;

  return typeof target === 'string' ? store.objectById(target) : undefined;
};

const buildIncluded = (
  store: MockStore,
  object: ObjectMetadata,
  fields: FieldMetadata[],
  items: StoredRecord[],
  include: Include,
): Record<string, RecordData[]> => {
  const included: Record<string, RecordData[]> = {};

  for (const [name, spec] of Object.entries(include)) {
    const field = fields.find((candidate) => candidate.name === name);

    if (field?.type !== 'relation') {
      throw validation(`include.${name}: "${name}" is not a relation field of ${object.nameSingular}`);
    }

    const target = relationTarget(store, field);

    if (!target) {
      included[name] = [];
      continue;
    }

    const ids = new Set<string>();

    for (const item of items) {
      const value = item[name];

      if (typeof value === 'string') {
        ids.add(value);
      }
    }

    const options = spec === true ? {} : spec;
    let rows = [...ids].map((id) => store.liveRecord(target.id, id)).filter((row): row is StoredRecord => !!row);

    if (options.limit !== undefined) {
      rows = rows.slice(0, options.limit);
    }

    included[name] = rows.map((row) => project(toPublic(row), options.select));
  }

  return included;
};

export const listRecords = (store: MockStore, input: Query): Page<RecordData> => {
  const parsed = QuerySchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid query', parsed.error.issues);
  }

  const query = parsed.data;
  const object = resolveObject(store, query.object);
  const fields = store.fieldsOf(object.id);
  const known = new Set<string>([...SYSTEM_KEYS, ...fields.map((field) => field.name)]);
  const referenced = [...filterFields(query.filter), ...(query.sort ?? []).map((sort) => sort.field)];
  const unknown = referenced.filter((name) => !known.has(name));

  if (unknown.length > 0) {
    throw validation(`Unknown field(s) on ${object.nameSingular}: ${[...new Set(unknown)].join(', ')}`, {
      fields: unknown,
    });
  }

  const searchable = fields.filter((field) => SEARCHABLE_FIELD_TYPES.has(field.type)).map((field) => field.name);
  const sort = query.sort && query.sort.length > 0 ? query.sort : DEFAULT_SORT;
  const key = hashValue({ object: query.object, filter: query.filter ?? null, sort, search: query.search ?? '' });
  const offset = query.cursor ? decodeCursor(query.cursor, key) : 0;
  const limit = query.limit ?? QUERY_DEFAULT_LIMIT;
  const search = query.search;
  const matching = store
    .liveRecords(object.id)
    .filter((record) => evaluateFilter(record, query.filter) && (!search || matchesSearch(record, searchable, search)));
  const sorted = sortRecords(matching, sort);
  const slice = sorted.slice(offset, offset + limit);
  const page: Page<RecordData> = {
    items: slice.map((record) => project(toPublic(record), query.select)),
    nextCursor: offset + limit < sorted.length ? encodeCursor(offset + limit, key) : null,
  };

  if (query.count) {
    page.totalCount = sorted.length;
  }

  if (query.include) {
    page.included = buildIncluded(store, object, fields, slice, query.include);
  }

  return page;
};

export const getRecord = (store: MockStore, objectName: string, id: string): RecordData => {
  const object = resolveObject(store, objectName);
  const record = store.liveRecord(object.id, id);

  if (!record) {
    throw new DeviasApiError(404, 'NOT_FOUND', `${object.labelSingular} "${id}" not found`);
  }

  return toPublic(record);
};

const normalizeUnique = (field: FieldMetadata, value: unknown): string =>
  field.type === 'email' ? String(value).trim().toLowerCase() : stableStringify(value);

const validateValues = (
  object: ObjectMetadata,
  fields: FieldMetadata[],
  data: unknown,
  partial: boolean,
): Record<string, unknown> => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw validation('Record data must be an object');
  }

  const input = data as Record<string, unknown>;
  const issues: Issue[] = [];
  const byName = new Map(fields.map((field) => [field.name, field]));

  for (const key of Object.keys(input)) {
    if (byName.has(key)) {
      continue;
    }

    const reserved = RESERVED_FIELD_NAMES.has(key) || (SYSTEM_KEYS as readonly string[]).includes(key);
    issues.push({
      field: key,
      message: reserved ? `"${key}" is a system field and read-only` : `Unknown field "${key}"`,
    });
  }

  const values: Record<string, unknown> = {};

  for (const field of fields) {
    const provided = Object.hasOwn(input, field.name) && input[field.name] !== undefined;

    if (!provided) {
      if (partial) {
        continue;
      }

      const fallback = field.defaultValue !== undefined ? structuredClone(field.defaultValue) : null;

      if (fallback === null && field.isRequired) {
        issues.push({ field: field.name, message: `${field.label} is required` });
      }

      values[field.name] = fallback;
      continue;
    }

    const result = valueSchemaForField(field).safeParse(input[field.name]);

    if (result.success) {
      values[field.name] = result.data;
    } else {
      issues.push({ field: field.name, message: result.error.issues.map((issue) => issue.message).join('; ') });
    }
  }

  if (issues.length > 0) {
    throw validation(`Invalid ${object.labelSingular.toLowerCase()} data`, { issues });
  }

  return values;
};

const checkRelations = (store: MockStore, fields: FieldMetadata[], values: Record<string, unknown>): void => {
  const issues: Issue[] = [];

  for (const field of fields) {
    if (field.type !== 'relation') {
      continue;
    }

    const value = values[field.name];

    if (value === null || value === undefined) {
      continue;
    }

    const target = relationTarget(store, field);

    if (!target || typeof value !== 'string' || !store.liveRecord(target.id, value)) {
      issues.push({
        field: field.name,
        message: `${target?.labelSingular ?? 'Related record'} "${String(value)}" does not exist`,
      });
    }
  }

  if (issues.length > 0) {
    throw validation('Related record not found', { issues });
  }
};

const checkUnique = (
  store: MockStore,
  object: ObjectMetadata,
  fields: FieldMetadata[],
  values: Record<string, unknown>,
  excludeId?: string,
): void => {
  for (const field of fields) {
    if (!field.isUnique) {
      continue;
    }

    const value = values[field.name];

    if (value === null || value === undefined || value === '') {
      continue;
    }

    const needle = normalizeUnique(field, value);

    for (const other of store.liveRecords(object.id)) {
      if (other.id === excludeId) {
        continue;
      }

      const otherValue = other[field.name];

      if (otherValue === null || otherValue === undefined || otherValue === '') {
        continue;
      }

      if (normalizeUnique(field, otherValue) === needle) {
        throw new DeviasApiError(
          409,
          'UNIQUE_VIOLATION',
          `${field.label} must be unique: "${String(value)}" is taken`,
          {
            field: field.name,
            value,
            recordId: other.id,
          },
        );
      }
    }
  }
};

const assertWritable = (object: ObjectMetadata): void => {
  if (object.readOnly) {
    throw new DeviasApiError(403, 'FORBIDDEN', `${object.labelPlural} are read-only`);
  }
};

export interface InsertOptions {
  /** The import that writes it: the event says so, and workflows that do not ask for imports skip it. */
  importId?: string;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const createRecord = (
  store: MockStore,
  objectName: string,
  data: Record<string, unknown>,
  options: InsertOptions = {},
): RecordData => {
  const object = resolveObject(store, objectName);
  assertWritable(object);
  const fields = store.fieldsOf(object.id);
  const values = validateValues(object, fields, data, false);
  checkRelations(store, fields, values);
  checkUnique(store, object, fields, values);
  const id = options.id ?? store.newId();

  if (store.recordsOf(object.id).has(id)) {
    throw new DeviasApiError(409, 'CONFLICT', `Record "${id}" already exists`);
  }

  const now = store.now();
  const createdAt = options.createdAt ?? now;
  const record: StoredRecord = {
    id,
    created_at: createdAt,
    updated_at: options.updatedAt ?? createdAt,
    created_by: store.actor.id,
    updated_by: store.actor.id,
    ...values,
  };
  store.recordsOf(object.id).set(id, record);
  const event = store.emit({
    type: 'record.created',
    objectId: object.id,
    object: object.nameSingular,
    recordId: id,
    ...(options.importId ? { importId: options.importId } : {}),
  });
  store.track(event, { kind: 'created' });
  store.changed();

  return toPublic(record);
};

export const updateRecord = (
  store: MockStore,
  objectName: string,
  id: string,
  patch: Record<string, unknown>,
  options: { importId?: string } = {},
): RecordData => {
  const object = resolveObject(store, objectName);
  assertWritable(object);
  const record = store.liveRecord(object.id, id);

  if (!record) {
    throw new DeviasApiError(404, 'NOT_FOUND', `${object.labelSingular} "${id}" not found`);
  }

  const fields = store.fieldsOf(object.id);
  const values = validateValues(object, fields, patch, true);
  checkRelations(store, fields, values);
  checkUnique(store, object, fields, values, id);
  const changedFields = Object.keys(values).filter(
    (name) => !(stableStringify(record[name]) === stableStringify(values[name])),
  );
  const changes = changedFields.map((field) => ({
    field,
    before: structuredClone(record[field] ?? null),
    after: structuredClone(values[field] ?? null),
  }));
  Object.assign(record, values);
  record.updated_at = store.now();
  record.updated_by = store.actor.id;
  const event = store.emit({
    type: 'record.updated',
    objectId: object.id,
    object: object.nameSingular,
    recordId: id,
    changedFields,
    ...(options.importId ? { importId: options.importId } : {}),
  });

  if (changes.length > 0) {
    store.track(event, { kind: 'updated', changes });
  }

  store.changed();

  return toPublic(record);
};

/** Soft-delete; unknown ids are ignored so deletes are idempotent. */
export const deleteRecords = (store: MockStore, objectName: string, ids: string[]): void => {
  const object = resolveObject(store, objectName);
  assertWritable(object);

  if (!Array.isArray(ids)) {
    throw validation('ids must be an array');
  }

  const doomed: { object: ObjectMetadata; record: StoredRecord }[] = [];

  for (const id of ids) {
    const record = store.liveRecord(object.id, id);

    if (!record || doomed.some((entry) => entry.record === record)) {
      continue;
    }

    // The object's own rule says which records may be deleted, as it does on the server.
    if (!isDeletable(object, record)) {
      throw new DeviasApiError(
        409,
        'CONFLICT',
        `${object.labelSingular} "${id}" cannot be deleted in its current state (the object's delete rule)`,
        { id, deleteWhen: object.deleteWhen },
      );
    }

    doomed.push({ object, record });
  }

  // The records that go with them: those whose relation says `onDelete: cascade`, and so on down.
  const index = store.index();
  const seen = new Set(doomed.map((entry) => entry.record.id));
  let frontier = [{ object, ids: new Set(seen) }];

  while (frontier.length > 0) {
    const next: typeof frontier = [];

    for (const level of frontier) {
      for (const { object: child, field } of cascadeRelationsOf(index, level.object)) {
        const rows = store
          .liveRecords(child.id)
          .filter((row) => level.ids.has(String(row[field.name])) && !seen.has(row.id));

        if (rows.length === 0) {
          continue;
        }

        for (const row of rows) {
          seen.add(row.id);
          doomed.push({ object: child, record: row });
        }

        next.push({ object: child, ids: new Set(rows.map((row) => row.id)) });
      }
    }

    frontier = next;
  }

  for (const { object: owner, record } of doomed) {
    record.deleted_at = store.now();
    record.updated_at = record.deleted_at;

    // A record's notes go with it.
    for (const note of store.notes) {
      if (note.recordId === record.id) {
        note.deleted = true;
      }
    }

    const event = store.emit({
      type: 'record.deleted',
      objectId: owner.id,
      object: owner.nameSingular,
      recordId: record.id,
    });
    store.track(event, { kind: 'deleted' });
  }

  store.changed();
};

export const lookupRecords = (store: MockStore, input: LookupInput): LookupHit[] => {
  const parsed = LookupInputSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid search input', parsed.error.issues);
  }

  const { text, limit = 20 } = parsed.data;
  const needle = text.trim().toLowerCase();
  const index = store.index();
  const objects = parsed.data.objects
    ? parsed.data.objects.map((name) => resolveObject(store, name))
    : [...store.objects.values()];
  const hits: LookupHit[] = [];

  for (const object of objects) {
    const fields = store.fieldsOf(object.id);
    const searchable = fields.filter((field) => SEARCHABLE_FIELD_TYPES.has(field.type)).map((field) => field.name);

    if (searchable.length === 0) {
      continue;
    }

    const primaryField = primaryFieldOf(index, object);
    const matches = sortRecords(
      store.liveRecords(object.id).filter((record) => matchesSearch(record, searchable, text)),
      DEFAULT_SORT,
    );

    for (const record of matches) {
      if (hits.length >= limit) {
        return hits;
      }

      const title = primaryField ? String(record[primaryField.name] ?? '') : '';
      const matched = searchable.find((name) => {
        const value = record[name];

        return name !== primaryField?.name && typeof value === 'string' && value.toLowerCase().includes(needle);
      });
      hits.push({
        object: object.nameSingular,
        objectId: object.id,
        recordId: record.id,
        title: title || record.id,
        subtitle: matched ? String(record[matched]) : object.labelSingular,
      });
    }
  }

  return hits;
};

/** Counts and measures over an object's records, computed in memory the way the server does in SQL. */
export const aggregateMockRecords = (store: MockStore, input: AggregateQuery): AggregateResult => {
  const parsed = AggregateQuerySchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid aggregation', parsed.error.issues);
  }

  const query = parsed.data;
  const object = resolveObject(store, query.object);
  const fields = store.fieldsOf(object.id);
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const system = new Set<string>(SYSTEM_KEYS);
  const unknown = [...filterFields(query.filter)].filter((name) => !fieldsByName.has(name) && !system.has(name));

  if (unknown.length > 0) {
    throw validation(`Unknown field(s) on ${object.nameSingular}: ${unknown.join(', ')}`);
  }

  const problem = aggregateProblem(query, fieldsByName);

  if (problem) {
    throw validation(problem.message, problem.field ? { field: problem.field } : undefined);
  }

  const searchable = fields.filter((field) => SEARCHABLE_FIELD_TYPES.has(field.type)).map((field) => field.name);
  const search = query.search?.trim();
  const matching = store
    .liveRecords(object.id)
    .filter((record) => evaluateFilter(record, query.filter) && (!search || matchesSearch(record, searchable, search)))
    .map(toPublic);
  const result = aggregateRecords(matching, fields, { ...query, object: object.nameSingular });
  const groupBy = query.groupBy ? fieldsByName.get(query.groupBy) : undefined;
  const target = groupBy?.type === 'relation' ? relationTarget(store, groupBy) : undefined;
  const primaryField = target ? primaryFieldOf(store.index(), target) : undefined;

  if (target && primaryField) {
    for (const group of result.groups) {
      const related = store.liveRecords(target.id).find((record) => record.id === group.key);
      const label = related ? toPublic(related)[primaryField.name] : undefined;

      if (typeof label === 'string' && label !== '') {
        group.label = label;
      }
    }
  }

  return result;
};

/** Update the record whose unique field `match` names, or create one with the values and the match (like the server). */
export const upsertRecord = (
  store: MockStore,
  objectName: string,
  match: Record<string, unknown>,
  values: Record<string, unknown>,
): { record: RecordData; created: boolean } => {
  const object = resolveObject(store, objectName);
  const entries = Object.entries(match ?? {});
  const [name, value] = entries[0] ?? [];

  if (entries.length !== 1 || name === undefined) {
    throw validation('Match on exactly one unique field: { field: value }', { path: 'match' });
  }

  const field = store.fieldsOf(object.id).find((candidate) => candidate.name === name);

  if (!field) {
    throw validation(`${object.labelSingular} has no field "${name}"`, { path: `match.${name}` });
  }

  if (!field.isUnique) {
    throw validation(`"${name}" is not unique, so it cannot identify one ${object.labelSingular}`, {
      path: `match.${name}`,
    });
  }

  if (value === null || value === undefined || value === '') {
    throw validation(`Give a value to match "${name}" on`, { path: `match.${name}` });
  }

  const existing = listRecords(store, {
    object: object.nameSingular,
    filter: { field: name, op: 'eq', value },
    limit: 1,
  }).items[0];

  return existing
    ? { record: updateRecord(store, objectName, existing.id, values), created: false }
    : { record: createRecord(store, objectName, { ...values, [name]: value }), created: true };
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_TYPES = new Set(['text', 'email', 'phone', 'url']);
const sameText = (a: unknown, b: unknown): boolean => String(a).toLowerCase() === String(b).toLowerCase();

/** The import of the server (see `RecordService.import`) over the mock's store: the same rules, the same report. */
export const importRecords = (store: MockStore, objectName: string, input: ImportBody): ImportReport => {
  const object = resolveObject(store, objectName);
  assertWritable(object);
  const fields = store.fieldsOf(object.id);

  if (input.rows.length > 500) {
    throw validation('An import may contain at most 500 rows per call', { total: input.rows.length });
  }

  const columns: (FieldMetadata | null)[] = [];
  const named = new Set<string>();

  for (const [i, ref] of input.columns.entries()) {
    const field = ref === null ? null : fields.find((one) => one.name === ref || one.id === ref);

    if (ref !== null && !field) {
      throw validation(`${object.labelSingular} has no field "${ref}"`, { path: `columns[${i}]` });
    }

    if (field && !isImportable(field)) {
      throw validation(`${field.label} cannot be filled from a file`, { path: `columns[${i}]` });
    }

    if (field && named.has(field.name)) {
      throw validation(`${field.label} is the field of two columns`, { path: `columns[${i}]` });
    }

    if (field) {
      named.add(field.name);
    }

    columns.push(field ?? null);
  }

  const matchField = input.matchOn
    ? fields.find((one) => one.name === input.matchOn || one.id === input.matchOn)
    : undefined;

  if (input.matchOn && (!matchField?.isUnique || !named.has(matchField.name))) {
    throw validation(
      `"${input.matchOn}" must be a unique field of ${object.labelSingular} that one of the columns fills`,
      {
        path: 'matchOn',
      },
    );
  }

  const problems: { row: number; field?: string; message: string }[] = [];
  const creates: Record<string, unknown>[] = [];
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const claimed = new Map<string, number>();
  let skipped = 0;

  for (const [r, cells] of input.rows.entries()) {
    if (cells.every((cell) => cell.trim() === '')) {
      continue;
    }

    const row = (input.firstRow ?? 2) + r;
    const mine: { row: number; field?: string; message: string }[] = [];
    const values: Record<string, unknown> = {};

    for (const [c, field] of columns.entries()) {
      if (!field) {
        continue;
      }

      const cell = readCell(field, cells[c] ?? '', { dateOrder: input.dateOrder, timeZone: input.timeZone });

      if (cell.kind === 'value') {
        values[field.name] = cell.value;
      } else if (cell.kind === 'error') {
        mine.push({ row, field: field.label, message: cell.message });
      } else if (cell.kind === 'lookup' && field.type === 'member') {
        values[field.name] = cell.text;
      } else if (cell.kind === 'lookup') {
        const target = relationTarget(store, field);
        const naming = target
          ? store
              .fieldsOf(target.id)
              .filter(
                (one) =>
                  TEXT_TYPES.has(one.type) && (one.isUnique || one.id === primaryFieldOf(store.index(), target)?.id),
              )
          : [];
        const found = target
          ? UUID_LIKE.test(cell.text)
            ? store.liveRecords(target.id).filter((record) => record.id === cell.text)
            : store
                .liveRecords(target.id)
                .filter((record) =>
                  naming.some((one) => record[one.name] != null && sameText(record[one.name], cell.text)),
                )
          : [];

        if (found.length === 1) {
          values[field.name] = (found[0] as StoredRecord).id;
        } else {
          const what = target?.labelSingular ?? 'record';
          mine.push({
            row,
            field: field.label,
            message:
              found.length === 0
                ? `No ${what.toLowerCase()} is called "${cell.text}"`
                : `${found.length} ${(target?.labelPlural ?? 'records').toLowerCase()} are called "${cell.text}": use a unique field or its id`,
          });
        }
      }
    }

    let matched: StoredRecord | undefined;

    for (const field of fields.filter((one) => one.isUnique && named.has(one.name))) {
      const value = values[field.name];

      if (value === undefined || value === null) {
        continue;
      }

      const key = `${field.name}\u0000${String(value).toLowerCase()}`;
      const earlier = claimed.get(key);

      if (earlier !== undefined) {
        mine.push({ row, field: field.label, message: `"${String(value)}" is also in row ${earlier}` });
        continue;
      }

      claimed.set(key, row);
      const existing = store
        .liveRecords(object.id)
        .find((record) => record[field.name] != null && sameText(record[field.name], value));

      if (existing && matchField && field.name === matchField.name) {
        matched = existing;
      } else if (existing) {
        mine.push({ row, field: field.label, message: `"${String(value)}" already exists` });
      }
    }

    if (matchField && !matched && values[matchField.name] === undefined) {
      mine.push({ row, field: matchField.label, message: `${matchField.label} is empty, so no record can be matched` });
    }

    if (mine.length === 0) {
      try {
        const checked = validateValues(object, fields, values, matched !== undefined);
        checkRelations(store, fields, checked);
      } catch (error) {
        const issues = (error as { details?: { issues?: Issue[] } }).details?.issues ?? [
          { field: '', message: String((error as Error).message) },
        ];

        for (const issue of issues) {
          const field = fields.find((one) => one.name === issue.field);
          mine.push({ row, ...(field ? { field: field.label } : {}), message: issue.message });
        }
      }
    }

    if (mine.length > 0) {
      skipped++;
      problems.push(...mine);
    } else if (matched) {
      updates.push({ id: matched.id, values });
    } else {
      creates.push(values);
    }
  }

  const importId = input.dryRun ? undefined : store.newId();

  if (importId) {
    for (const values of creates) {
      createRecord(store, object.nameSingular, values, { importId });
    }

    for (const update of updates) {
      updateRecord(store, object.nameSingular, update.id, update.values, { importId });
    }
  }

  problems.sort((a, b) => a.row - b.row);

  return {
    created: creates.length,
    updated: updates.length,
    skipped,
    errorCount: problems.length,
    errors: problems.slice(0, IMPORT_ERRORS_MAX),
    dryRun: input.dryRun === true,
    ...(importId ? { importId } : {}),
  };
};
