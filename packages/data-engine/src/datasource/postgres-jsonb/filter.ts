import {
  type FieldMetadata,
  type Filter,
  type FilterCondition,
  isCondition,
  SEARCHABLE_FIELD_TYPES,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import { validationError } from '../../errors';
import {
  castFor,
  escapeLike,
  type FieldRef,
  isTextLike,
  jsonArrayElements,
  jsonText,
  jsonTextArray,
  jsonTextNonEmpty,
  jsonValue,
  resolveFieldRef,
  typedParam,
  valueExpr,
} from './fields';

/**
 * Filter tree → SQL. Every leaf is wrapped in `coalesce(..., false)` so the tree evaluates with
 * two-valued logic exactly like `evaluateFilter` in core (a NOT over a null comparison is true).
 */

const TRUE = sql.raw('true');
const FALSE = sql.raw('false');

const emptyPredicate = (ref: FieldRef): SQL => {
  if (ref.kind === 'system') {
    return sql`${valueExpr(ref)} IS NULL`;
  }

  const name = ref.field.name;

  switch (castFor(ref)) {
    case 'text':
      return sql`(${jsonText(name)} IS NULL OR ${jsonText(name)} = '')`;
    case 'jsonb':
      return sql`(${jsonValue(name)} IS NULL OR ${jsonValue(name)} = 'null'::jsonb OR (jsonb_typeof(${jsonValue(name)}) = 'array' AND jsonb_array_length(${jsonValue(name)}) = 0))`;
    default:
      return sql`${jsonText(name)} IS NULL`;
  }
};

const eqPredicate = (ref: FieldRef, value: unknown): SQL => {
  if (ref.kind === 'field' && isTextLike(ref)) {
    const type = ref.field.type;

    if (type === 'text' || type === 'email' || type === 'phone' || type === 'url') {
      return sql`lower(${jsonTextNonEmpty(ref.field.name)}) = lower(${value})`;
    }

    // select / relation: exact match through the GIN-indexable containment operator
    return sql`r.data @> ${JSON.stringify({ [ref.field.name]: value })}::jsonb`;
  }

  if (ref.kind === 'field' && (castFor(ref) === 'numeric' || castFor(ref) === 'boolean')) {
    return sql`r.data @> ${JSON.stringify({ [ref.field.name]: value })}::jsonb`;
  }

  return sql`${valueExpr(ref)} = ${typedParam(value, castFor(ref))}`;
};

const neqPredicate = (ref: FieldRef, value: unknown): SQL => {
  if (ref.kind === 'field' && isTextLike(ref)) {
    return sql`lower(${jsonTextNonEmpty(ref.field.name)}) <> lower(${value})`;
  }

  return sql`${valueExpr(ref)} <> ${typedParam(value, castFor(ref))}`;
};

const inPredicate = (ref: FieldRef, values: unknown[]): SQL => {
  if (ref.kind === 'field' && isTextLike(ref)) {
    const lowered = values.map((v) => (typeof v === 'string' ? v.toLowerCase() : v));

    return sql`lower(${jsonTextNonEmpty(ref.field.name)}) IN ${jsonArrayElements(lowered, 'text')}`;
  }

  return sql`${valueExpr(ref)} IN ${jsonArrayElements(values, castFor(ref))}`;
};

const compare = (ref: FieldRef, op: string, value: unknown): SQL =>
  sql`${valueExpr(ref)} ${sql.raw(op)} ${typedParam(value, castFor(ref))}`;

const compileCondition = (condition: FilterCondition, fieldsByName: Map<string, FieldMetadata>): SQL => {
  const ref = resolveFieldRef(fieldsByName, condition.field);

  if (!ref) {
    throw validationError(`Unknown field "${condition.field}" in filter`, { field: condition.field });
  }

  const value = condition.value;
  const arr = Array.isArray(value) ? value : [];

  switch (condition.op) {
    case 'is_empty':
      return emptyPredicate(ref);
    case 'is_not_empty':
      return sql`NOT ${emptyPredicate(ref)}`;
    case 'eq':
      return eqPredicate(ref, value);
    case 'neq':
      return neqPredicate(ref, value);
    case 'in':
      return inPredicate(ref, arr);
    case 'not_in':
      return sql`NOT (${inPredicate(ref, arr)})`;
    case 'lt':
      return compare(ref, '<', value);
    case 'lte':
      return compare(ref, '<=', value);
    case 'gt':
      return compare(ref, '>', value);
    case 'gte':
      return compare(ref, '>=', value);
    case 'between':
      return sql`(${compare(ref, '>=', arr[0])} AND ${compare(ref, '<=', arr[1])})`;
    case 'contains':
      return sql`${jsonText(refName(ref))} ILIKE ${`%${escapeLike(String(value))}%`} ESCAPE '\\'`;
    case 'starts_with':
      return sql`${jsonText(refName(ref))} ILIKE ${`${escapeLike(String(value))}%`} ESCAPE '\\'`;
    case 'any_of':
      return sql`${jsonValue(refName(ref))} ?| ${jsonTextArray(arr.map(String))}`;
    case 'all_of':
      return sql`${jsonValue(refName(ref))} ?& ${jsonTextArray(arr.map(String))}`;
    default:
      throw validationError(`Unknown operator "${condition.op}"`, { field: condition.field });
  }
};

const refName = (ref: FieldRef): string => {
  if (ref.kind === 'system') {
    throw validationError(`Operator not supported on system field "${ref.name}"`);
  }

  return ref.field.name;
};

export const compileFilter = (filter: Filter | undefined, fieldsByName: Map<string, FieldMetadata>): SQL => {
  if (!filter) {
    return TRUE;
  }

  if (isCondition(filter)) {
    return sql`coalesce((${compileCondition(filter, fieldsByName)}), false)`;
  }

  if ('and' in filter) {
    if (filter.and.length === 0) {
      return TRUE;
    }

    return sql`(${sql.join(
      filter.and.map((f) => compileFilter(f, fieldsByName)),
      sql` AND `,
    )})`;
  }

  if ('or' in filter) {
    if (filter.or.length === 0) {
      return TRUE;
    }

    return sql`(${sql.join(
      filter.or.map((f) => compileFilter(f, fieldsByName)),
      sql` OR `,
    )})`;
  }

  return sql`NOT ${compileFilter(filter.not, fieldsByName)}`;
};

/** Free-text search: OR of ILIKE over the object's searchable (text-like) fields. */
export const compileSearch = (text: string, fields: FieldMetadata[]): SQL => {
  const needle = `%${escapeLike(text.trim())}%`;
  const searchable = fields.filter((f) => SEARCHABLE_FIELD_TYPES.has(f.type));

  if (searchable.length === 0) {
    return FALSE;
  }

  return sql`(${sql.join(
    searchable.map((f) => sql`${jsonText(f.name)} ILIKE ${needle} ESCAPE '\\'`),
    sql` OR `,
  )})`;
};
