import { z } from 'zod';
import { FilterOpSchema } from '../metadata/field-types';

/**
 * The query IR is the single wire format shared by the SDK, the studio, the server compiler and
 * modules. Field names are API names; `object` is the object's `nameSingular`.
 */

export const FilterConditionSchema = z
  .object({
    field: z.string().min(1),
    op: FilterOpSchema,
    value: z.unknown().optional(),
  })
  .meta({ id: 'FilterCondition' });
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export type Filter = { and: Filter[] } | { or: Filter[] } | { not: Filter } | FilterCondition;

export const FilterSchema: z.ZodType<Filter> = z
  .lazy(() =>
    z.union([
      z.object({ and: z.array(FilterSchema) }),
      z.object({ or: z.array(FilterSchema) }),
      z.object({ not: FilterSchema }),
      FilterConditionSchema,
    ]),
  )
  .meta({ id: 'Filter' });

export const SortSchema = z
  .object({
    field: z.string().min(1),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .meta({ id: 'Sort' });
export type Sort = z.infer<typeof SortSchema>;

export const IncludeSchema = z.record(
  z.string(),
  z.union([
    z.literal(true),
    z.object({ select: z.array(z.string()).optional(), limit: z.number().int().positive().optional() }),
  ]),
);
export type Include = z.infer<typeof IncludeSchema>;

export const QUERY_MAX_LIMIT = 200;
export const QUERY_DEFAULT_LIMIT = 50;

export const QuerySchema = z
  .object({
    object: z.string().min(1),
    select: z.array(z.string()).optional(),
    filter: FilterSchema.optional(),
    sort: z.array(SortSchema).optional(),
    limit: z.number().int().min(1).max(QUERY_MAX_LIMIT).optional(),
    cursor: z.string().optional(),
    /** Free-text search across searchable fields; combined with `filter` using AND. */
    search: z.string().optional(),
    include: IncludeSchema.optional(),
    /** Request a (capped) total count alongside the page. */
    count: z.boolean().optional(),
  })
  .meta({ id: 'Query' });
export type Query = z.infer<typeof QuerySchema>;

export const RecordDataSchema = z
  .object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    created_by: z.string().optional(),
    updated_by: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: 'RecordData' });
export type RecordData = z.infer<typeof RecordDataSchema>;

export interface Page<T = RecordData> {
  items: T[];
  nextCursor: string | null;
  totalCount?: number;
  /** Related records requested through `include`, keyed by relation field name. */
  included?: Record<string, RecordData[]>;
}

export const PageSchema = z
  .object({
    items: z.array(RecordDataSchema),
    nextCursor: z.string().nullable(),
    totalCount: z.number().int().optional(),
    included: z.record(z.string(), z.array(RecordDataSchema)).optional(),
  })
  .meta({ id: 'Page' });

export const isCondition = (filter: Filter): filter is FilterCondition => 'field' in filter;

/** Combine filters with AND, dropping empty ones. */
export const andFilters = (...filters: (Filter | undefined | null)[]): Filter | undefined => {
  const present = filters.filter((f): f is Filter => Boolean(f));

  if (present.length === 0) {
    return undefined;
  }

  if (present.length === 1) {
    return present[0];
  }

  return { and: present };
};

/** Every field name referenced by a filter, useful for validation and cache keys. */
export const filterFields = (filter: Filter | undefined, into: Set<string> = new Set()): Set<string> => {
  if (!filter) {
    return into;
  }

  if ('and' in filter) {
    for (const f of filter.and) {
      filterFields(f, into);
    }
  } else if ('or' in filter) {
    for (const f of filter.or) {
      filterFields(f, into);
    }
  } else if ('not' in filter) {
    filterFields(filter.not, into);
  } else {
    into.add(filter.field);
  }

  return into;
};

/**
 * The most records a query's `count` reports: counting stops one past the cap, so a count of `RECORD_COUNT_CAP` means
 * "more than 10,000" and the real number is not known. Counting every row of a large object on each page load would be
 * slow; a count below the cap is exact.
 */
export const RECORD_COUNT_CAP = 10_001;

/** A count as people read it: exact below the cap, "10,000+" at it. */
export const formatRecordCount = (count: number): string =>
  count >= RECORD_COUNT_CAP ? `${(RECORD_COUNT_CAP - 1).toLocaleString('en')}+` : count.toLocaleString('en');
