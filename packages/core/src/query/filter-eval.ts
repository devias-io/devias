import type { Filter, FilterCondition, RecordData, Sort } from './ir';

/**
 * Evaluate the query IR against plain JavaScript records. The SDK mock backend, tests and
 * client-side views (calendar ranges, kanban lanes) all use this so behaviour matches the SQL compiler.
 */

const isEmptyValue = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

const normalize = (value: unknown): unknown => (typeof value === 'string' ? value.toLowerCase() : value);

/** A value as text, like Postgres `->>`: strings as-is, other JSON (e.g. module field values) serialized. */
const textOf = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
};

const compare = (a: unknown, b: unknown): number => {
  if (a === b) {
    return 0;
  }

  if (a === null || a === undefined) {
    return 1;
  }

  if (b === null || b === undefined) {
    return -1;
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  const sa = String(a);
  const sb = String(b);

  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

export const evaluateCondition = (record: Record<string, unknown>, condition: FilterCondition): boolean => {
  const actual = record[condition.field];
  const expected = condition.value;

  switch (condition.op) {
    case 'is_empty':
      return isEmptyValue(actual);
    case 'is_not_empty':
      return !isEmptyValue(actual);
    case 'eq':
      return !isEmptyValue(actual) && normalize(actual) === normalize(expected);
    case 'neq':
      return !isEmptyValue(actual) && normalize(actual) !== normalize(expected);
    case 'in':
      return !isEmptyValue(actual) && Array.isArray(expected) && expected.map(normalize).includes(normalize(actual));
    case 'not_in':
      return !isEmptyValue(actual) && Array.isArray(expected) && !expected.map(normalize).includes(normalize(actual));
    case 'lt':
      return !isEmptyValue(actual) && compare(actual, expected) < 0;
    case 'lte':
      return !isEmptyValue(actual) && compare(actual, expected) <= 0;
    case 'gt':
      return !isEmptyValue(actual) && compare(actual, expected) > 0;
    case 'gte':
      return !isEmptyValue(actual) && compare(actual, expected) >= 0;
    case 'between': {
      if (isEmptyValue(actual) || !Array.isArray(expected) || expected.length !== 2) {
        return false;
      }

      return compare(actual, expected[0]) >= 0 && compare(actual, expected[1]) <= 0;
    }
    case 'contains': {
      const text = textOf(actual);

      return text !== null && typeof expected === 'string' && text.toLowerCase().includes(expected.toLowerCase());
    }
    case 'starts_with':
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        actual.toLowerCase().startsWith(expected.toLowerCase())
      );
    case 'any_of':
      return Array.isArray(actual) && Array.isArray(expected) && expected.some((v) => actual.includes(v));
    case 'all_of':
      return Array.isArray(actual) && Array.isArray(expected) && expected.every((v) => actual.includes(v));
    default:
      return false;
  }
};

export const evaluateFilter = (record: Record<string, unknown>, filter: Filter | undefined): boolean => {
  if (!filter) {
    return true;
  }

  if ('and' in filter) {
    return filter.and.every((f) => evaluateFilter(record, f));
  }

  if ('or' in filter) {
    return filter.or.length === 0 || filter.or.some((f) => evaluateFilter(record, f));
  }

  if ('not' in filter) {
    return !evaluateFilter(record, filter.not);
  }

  return evaluateCondition(record, filter);
};

/** Whether the object's `deleteWhen` rule lets this record be deleted (no rule: always). */
export const isDeletable = (object: { deleteWhen?: Filter | undefined }, record: Record<string, unknown>): boolean =>
  evaluateFilter(record, object.deleteWhen);

/** Sort with SQL-like null placement: nulls last ascending, first descending; `id` as the tiebreaker. */
export const sortRecords = <T extends RecordData>(records: T[], sorts: Sort[]): T[] =>
  [...records].sort((a, b) => {
    for (const sort of sorts) {
      const av = a[sort.field];
      const bv = b[sort.field];
      const aEmpty = isEmptyValue(av);
      const bEmpty = isEmptyValue(bv);

      if (aEmpty && bEmpty) {
        continue;
      }

      // Postgres defaults: NULLS LAST when ascending, NULLS FIRST when descending.
      if (aEmpty) {
        return sort.direction === 'desc' ? -1 : 1;
      }

      if (bEmpty) {
        return sort.direction === 'desc' ? 1 : -1;
      }

      const c = compare(av, bv);

      if (c !== 0) {
        return sort.direction === 'desc' ? -c : c;
      }
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

export const matchesSearch = (record: Record<string, unknown>, searchableFields: string[], text: string): boolean => {
  const needle = text.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return searchableFields.some((name) => {
    const value = record[name];

    return typeof value === 'string' && value.toLowerCase().includes(needle);
  });
};
