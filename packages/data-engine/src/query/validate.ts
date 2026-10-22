import {
  AGGREGATE_DEFAULT_GROUPS,
  type AggregateMeasure,
  AggregateQuerySchema,
  aggregateProblem,
  type FieldMetadata,
  type Filter,
  type FilterCondition,
  type FilterOp,
  type Include,
  isCondition,
  type ObjectMetadata,
  opsForFieldType,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_LIMIT,
  type Query,
  type SchemaIndex,
  SORTABLE_FIELD_TYPES,
  type Sort,
  SYSTEM_FIELD_OPS,
} from '@devias/core';
import { z } from 'zod';
import { fromZodError, notFound, validationError } from '../errors';

export interface ValidatedQuery {
  object: ObjectMetadata;
  fields: FieldMetadata[];
  fieldsByName: Map<string, FieldMetadata>;
  select?: string[];
  filter?: Filter;
  sort: Sort[];
  limit: number;
  cursor?: string;
  search?: string;
  include?: Include;
  count: boolean;
}

export const SYSTEM_FILTER_FIELDS = new Set(['id', 'created_at', 'updated_at']);
export const SYSTEM_SELECT_FIELDS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Scalar value schema used for comparison operators; looser than write validation (no option enums). */
const scalarSchemaFor = (type: string): z.ZodType<unknown> => {
  switch (type) {
    case 'number':
    case 'money':
      return z.number().finite();
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD');
    case 'date_time':
    case 'created_at':
    case 'updated_at':
      return z.iso.datetime({ offset: true });
    case 'id':
      return z.string().regex(UUID, 'Expected a record id');
    default:
      return z.string();
  }
};

const validateCondition = (condition: FilterCondition, fieldsByName: Map<string, FieldMetadata>): void => {
  const { field, op } = condition;
  const details = { field, op };
  let type: string;
  let ops: FilterOp[];

  if (SYSTEM_FILTER_FIELDS.has(field)) {
    type = field;
    ops = SYSTEM_FIELD_OPS[field] ?? [];
  } else {
    const meta = fieldsByName.get(field);

    if (!meta) {
      throw validationError(`Unknown field "${field}" in filter`, details);
    }

    type = meta.type;
    ops = opsForFieldType(meta.type);
  }

  if (!ops.includes(op)) {
    throw validationError(`Operator "${op}" is not supported on field "${field}" (${type})`, details);
  }

  const value = condition.value;
  const scalar = scalarSchemaFor(type);
  const expectScalar = (v: unknown) => {
    if (!scalar.safeParse(v).success) {
      throw validationError(`Invalid value for "${field}" with operator "${op}"`, details);
    }
  };

  switch (op) {
    case 'is_empty':
    case 'is_not_empty':
      return;
    case 'eq':
    case 'neq':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      expectScalar(value);

      return;
    case 'in':
    case 'not_in':
      if (!Array.isArray(value)) {
        throw validationError(`Operator "${op}" expects an array value`, details);
      }

      for (const v of value) {
        expectScalar(v);
      }

      return;
    case 'between':
      if (!Array.isArray(value) || value.length !== 2) {
        throw validationError('Operator "between" expects [from, to]', details);
      }

      for (const v of value) {
        expectScalar(v);
      }

      return;
    case 'contains':
    case 'starts_with':
      if (typeof value !== 'string') {
        throw validationError(`Operator "${op}" expects a string value`, details);
      }

      return;
    case 'any_of':
    case 'all_of':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        throw validationError(`Operator "${op}" expects an array of strings`, details);
      }

      return;
    default:
      throw validationError(`Unknown operator "${op}"`, details);
  }
};

const validateFilter = (filter: Filter, fieldsByName: Map<string, FieldMetadata>, depth = 0): void => {
  if (depth > 32) {
    throw validationError('Filter is nested too deeply');
  }

  if (isCondition(filter)) {
    validateCondition(filter, fieldsByName);

    return;
  }

  if ('and' in filter) {
    for (const f of filter.and) {
      validateFilter(f, fieldsByName, depth + 1);
    }
  } else if ('or' in filter) {
    for (const f of filter.or) {
      validateFilter(f, fieldsByName, depth + 1);
    }
  } else if ('not' in filter) {
    validateFilter(filter.not, fieldsByName, depth + 1);
  } else {
    throw validationError('Invalid filter node');
  }
};

/** Check a filter over a fixed list of fields (a task's) rather than an object's. */
export const validateFilterOver = (filter: Filter, fields: readonly FieldMetadata[]): void =>
  validateFilter(filter, new Map(fields.map((field) => [field.name, field])));

export const resolveObject = (index: SchemaIndex, name: string): ObjectMetadata => {
  const object = index.objectsByName.get(name);

  if (!object) {
    throw notFound('Object', name);
  }

  return object;
};

/** Validate a Query against the metadata snapshot; throws VALIDATION / NOT_FOUND. */
export const validateQuery = (index: SchemaIndex, query: Query): ValidatedQuery => {
  const object = resolveObject(index, query.object);
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const fieldsByName = new Map(fields.map((f) => [f.name, f]));

  if (query.select) {
    for (const name of query.select) {
      if (!fieldsByName.has(name) && !SYSTEM_SELECT_FIELDS.has(name)) {
        throw validationError(`Unknown field "${name}" in select`, { field: name });
      }
    }
  }

  if (query.filter) {
    validateFilter(query.filter, fieldsByName);
  }

  const sort: Sort[] = (query.sort ?? []).map((s) => ({ field: s.field, direction: s.direction ?? 'asc' }));

  for (const s of sort) {
    if (SYSTEM_FILTER_FIELDS.has(s.field)) {
      continue;
    }

    const meta = fieldsByName.get(s.field);

    if (!meta) {
      throw validationError(`Unknown field "${s.field}" in sort`, { field: s.field });
    }

    if (!SORTABLE_FIELD_TYPES.has(meta.type)) {
      throw validationError(`Field "${s.field}" (${meta.type}) is not sortable`, { field: s.field });
    }
  }

  if (query.include) {
    for (const [name, spec] of Object.entries(query.include)) {
      const meta = fieldsByName.get(name);

      if (meta?.type !== 'relation') {
        throw validationError(`Include key "${name}" is not a relation field`, { field: name });
      }

      if (spec !== true && spec.select) {
        for (const s of spec.select) {
          if (typeof s !== 'string') {
            throw validationError(`Invalid include select for "${name}"`, { field: name });
          }
        }
      }
    }
  }

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? QUERY_DEFAULT_LIMIT), 1), QUERY_MAX_LIMIT);
  const search = query.search?.trim();

  return {
    object,
    fields,
    fieldsByName,
    select: query.select,
    filter: query.filter,
    sort,
    limit,
    cursor: query.cursor,
    search: search ? search : undefined,
    include: query.include,
    count: query.count === true,
  };
};

export interface ValidatedAggregate {
  object: ObjectMetadata;
  fields: FieldMetadata[];
  fieldsByName: Map<string, FieldMetadata>;
  filter?: Filter;
  search?: string;
  groupBy?: FieldMetadata;
  measures: AggregateMeasure[];
  limit: number;
}

/** Validate an aggregation against the metadata snapshot; throws VALIDATION / NOT_FOUND. */
export const validateAggregate = (index: SchemaIndex, input: unknown): ValidatedAggregate => {
  const parsed = AggregateQuerySchema.safeParse(input);

  if (!parsed.success) {
    throw fromZodError(parsed.error, 'Invalid aggregation');
  }

  const query = parsed.data;
  const object = resolveObject(index, query.object);
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const fieldsByName = new Map(fields.map((f) => [f.name, f]));

  if (query.filter) {
    validateFilter(query.filter, fieldsByName);
  }

  const problem = aggregateProblem(query, fieldsByName);

  if (problem) {
    throw validationError(problem.message, problem.field ? { field: problem.field } : undefined);
  }

  const search = query.search?.trim();
  const groupBy = query.groupBy ? fieldsByName.get(query.groupBy) : undefined;

  return {
    object,
    fields,
    fieldsByName,
    ...(query.filter ? { filter: query.filter } : {}),
    ...(search ? { search } : {}),
    ...(groupBy ? { groupBy } : {}),
    measures: query.measures,
    limit: query.limit ?? AGGREGATE_DEFAULT_GROUPS,
  };
};
