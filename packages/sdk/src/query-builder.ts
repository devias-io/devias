import {
  andFilters,
  DeviasApiError,
  type Filter,
  type FilterCondition,
  type FilterOp,
  type Include,
  QUERY_MAX_LIMIT,
  type Query,
  QuerySchema,
  type Sort,
} from '@devias/core';

/**
 * Fluent, immutable builder for the query IR. Every call returns a new builder, so a partially built
 * query (a view's base query, say) can be shared and specialised without side effects.
 *
 *   q('person')
 *     .select('first_name', 'company')
 *     .where((f) => f.and(f.eq('stage', 'won'), f.or(f.contains('name', 'a'), f.isEmpty('email'))))
 *     .orderBy('close_date', 'desc')
 *     .limit(50)
 *     .include('company')
 *     .build();
 */

export type FilterInput = Filter | undefined | null | false;

export interface FilterHelpers {
  /** AND of the given filters; falsy entries are dropped and a single filter is returned as is. */
  and(...filters: FilterInput[]): Filter;
  /** OR of the given filters; falsy entries are dropped and a single filter is returned as is. */
  or(...filters: FilterInput[]): Filter;
  not(filter: Filter): Filter;
  /** Escape hatch for any operator, including ones registered by modules. */
  op(field: string, op: FilterOp, value?: unknown): FilterCondition;
  eq(field: string, value: unknown): FilterCondition;
  neq(field: string, value: unknown): FilterCondition;
  in(field: string, values: readonly unknown[]): FilterCondition;
  notIn(field: string, values: readonly unknown[]): FilterCondition;
  lt(field: string, value: unknown): FilterCondition;
  lte(field: string, value: unknown): FilterCondition;
  gt(field: string, value: unknown): FilterCondition;
  gte(field: string, value: unknown): FilterCondition;
  between(field: string, from: unknown, to: unknown): FilterCondition;
  contains(field: string, text: string): FilterCondition;
  startsWith(field: string, text: string): FilterCondition;
  isEmpty(field: string): FilterCondition;
  isNotEmpty(field: string): FilterCondition;
  anyOf(field: string, values: readonly unknown[]): FilterCondition;
  allOf(field: string, values: readonly unknown[]): FilterCondition;
}

const present = (parts: FilterInput[]): Filter[] => parts.filter((part): part is Filter => Boolean(part));

const condition = (field: string, op: FilterOp, value?: unknown): FilterCondition =>
  value === undefined ? { field, op } : { field, op, value };

const combine = (kind: 'and' | 'or', parts: FilterInput[]): Filter => {
  const list = present(parts);
  const [only] = list;

  if (list.length === 1 && only) {
    return only;
  }

  return kind === 'and' ? { and: list } : { or: list };
};

export const filters: FilterHelpers = {
  and: (...parts) => combine('and', parts),
  or: (...parts) => combine('or', parts),
  not: (filter) => ({ not: filter }),
  op: (field, op, value) => condition(field, op, value),
  eq: (field, value) => condition(field, 'eq', value),
  neq: (field, value) => condition(field, 'neq', value),
  in: (field, values) => condition(field, 'in', [...values]),
  notIn: (field, values) => condition(field, 'not_in', [...values]),
  lt: (field, value) => condition(field, 'lt', value),
  lte: (field, value) => condition(field, 'lte', value),
  gt: (field, value) => condition(field, 'gt', value),
  gte: (field, value) => condition(field, 'gte', value),
  between: (field, from, to) => condition(field, 'between', [from, to]),
  contains: (field, text) => condition(field, 'contains', text),
  startsWith: (field, text) => condition(field, 'starts_with', text),
  isEmpty: (field) => condition(field, 'is_empty'),
  isNotEmpty: (field) => condition(field, 'is_not_empty'),
  anyOf: (field, values) => condition(field, 'any_of', [...values]),
  allOf: (field, values) => condition(field, 'all_of', [...values]),
};

/** Short alias, handy outside the builder: `f.eq('stage', 'won')`. */
export const f = filters;

export interface IncludeOptions {
  select?: string[];
  limit?: number;
}

interface BuilderState {
  readonly object: string;
  readonly select?: readonly string[];
  readonly filter?: Filter;
  readonly sort: readonly Sort[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly include?: Include;
  readonly count?: boolean;
}

export interface QueryBuilder {
  /** The object this query targets (its `nameSingular`). */
  readonly object: string;
  /** Fields to return; repeated calls accumulate. System fields are always returned. */
  select(...fields: (string | readonly string[])[]): QueryBuilder;
  /** Add a filter; repeated calls are ANDed. Accepts a filter or a callback receiving the helpers. */
  where(filter: FilterInput | ((f: FilterHelpers) => FilterInput)): QueryBuilder;
  /** Append a sort key. */
  orderBy(field: string, direction?: Sort['direction']): QueryBuilder;
  /** Replace all sort keys. */
  sort(sorts: readonly Sort[]): QueryBuilder;
  /** Page size, clamped to `1..QUERY_MAX_LIMIT`; `null` clears it. */
  limit(limit: number | null | undefined): QueryBuilder;
  cursor(cursor: string | null | undefined): QueryBuilder;
  include(field: string, options?: IncludeOptions): QueryBuilder;
  include(include: Include): QueryBuilder;
  /** Free-text search across searchable fields; empty text clears it. */
  search(text: string | null | undefined): QueryBuilder;
  /** Ask for a (capped) total count alongside the page. */
  count(enabled?: boolean): QueryBuilder;
  /** Validate and return the query IR. Throws `DeviasApiError('VALIDATION')` when it is malformed. */
  build(): Query;
  toJSON(): Query;
}

const clampLimit = (limit: number): number => Math.min(QUERY_MAX_LIMIT, Math.max(1, Math.floor(limit)));

const includeSpec = (options: IncludeOptions | undefined): Include[string] => {
  if (!options) {
    return true;
  }

  const spec: Exclude<Include[string], true> = {};

  if (options.select) {
    spec.select = [...options.select];
  }

  if (options.limit !== undefined) {
    spec.limit = options.limit;
  }

  return Object.keys(spec).length > 0 ? spec : true;
};

const build = (state: BuilderState): Query => {
  const query: Query = { object: state.object };

  if (state.select && state.select.length > 0) {
    query.select = [...new Set(state.select)];
  }

  if (state.filter) {
    query.filter = state.filter;
  }

  if (state.sort.length > 0) {
    query.sort = state.sort.map((sort) => ({ ...sort }));
  }

  if (state.limit !== undefined) {
    query.limit = state.limit;
  }

  if (state.cursor !== undefined) {
    query.cursor = state.cursor;
  }

  if (state.search !== undefined) {
    query.search = state.search;
  }

  if (state.include && Object.keys(state.include).length > 0) {
    query.include = { ...state.include };
  }

  if (state.count) {
    query.count = true;
  }

  const parsed = QuerySchema.safeParse(query);

  if (!parsed.success) {
    const summary = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

    throw new DeviasApiError(400, 'VALIDATION', `Invalid query: ${summary.join('; ')}`, parsed.error.issues);
  }

  return parsed.data;
};

const make = (state: BuilderState): QueryBuilder => ({
  object: state.object,
  select: (...fields) => make({ ...state, select: [...(state.select ?? []), ...fields.flat()] }),
  where: (input) => {
    const next = typeof input === 'function' ? input(filters) : input;

    return make({ ...state, filter: andFilters(state.filter, next || undefined) });
  },
  orderBy: (field, direction = 'asc') => make({ ...state, sort: [...state.sort, { field, direction }] }),
  sort: (sorts) => make({ ...state, sort: sorts.map((sort) => ({ ...sort })) }),
  limit: (limit) =>
    make({ ...state, limit: typeof limit === 'number' && Number.isFinite(limit) ? clampLimit(limit) : undefined }),
  cursor: (cursor) => make({ ...state, cursor: cursor ?? undefined }),
  include: (fieldOrMap: string | Include, options?: IncludeOptions) => {
    const addition: Include = typeof fieldOrMap === 'string' ? { [fieldOrMap]: includeSpec(options) } : fieldOrMap;

    return make({ ...state, include: { ...state.include, ...addition } });
  },
  search: (text) => make({ ...state, search: text ? text : undefined }),
  count: (enabled = true) => make({ ...state, count: enabled }),
  build: () => build(state),
  toJSON: () => build(state),
});

/** Start a query for `object` (its `nameSingular`). */
export const q = (object: string): QueryBuilder => make({ object, sort: [] });
