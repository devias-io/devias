import { z } from 'zod';
import type { FieldMetadata } from '../metadata/schema';
import { type Filter, FilterSchema, type RecordData } from './ir';

/**
 * Aggregation over one object's records: counts and sums per group (pipeline by stage, revenue by company), or for
 * every matching record at once. The server computes it in SQL; `aggregateRecords` does the same in memory for the
 * mock backend.
 */

export const AGGREGATE_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number];

/** Fields records can be grouped by: one value per record, compared as is. */
export const AGGREGATE_GROUP_FIELD_TYPES = new Set([
  'select',
  'boolean',
  'relation',
  'member',
  'text',
  'email',
  'phone',
  'url',
  'date',
]);
/** Fields `sum` and `avg` apply to. */
export const SUMMABLE_FIELD_TYPES = new Set(['number', 'money']);
/** Fields `min` and `max` apply to. */
export const ORDERED_FIELD_TYPES = new Set(['number', 'money', 'date', 'date_time']);

export const AGGREGATE_MAX_GROUPS = 500;
export const AGGREGATE_DEFAULT_GROUPS = 100;

export const AggregateMeasureSchema = z
  .object({
    fn: z.enum(AGGREGATE_FUNCTIONS),
    /** Required except for `count`, which counts records without it and non-empty values with it. */
    field: z.string().optional(),
  })
  .meta({ id: 'AggregateMeasure' });
export type AggregateMeasure = z.infer<typeof AggregateMeasureSchema>;

export const AggregateQuerySchema = z
  .object({
    object: z.string(),
    filter: FilterSchema.optional(),
    search: z.string().optional(),
    /** A select, boolean, relation, text-like or date field; omit for one total over every matching record. */
    groupBy: z.string().optional(),
    measures: z
      .array(AggregateMeasureSchema)
      .min(1)
      .max(10)
      .default([{ fn: 'count' }]),
    /** Most groups returned, largest first (select fields keep their option order). */
    limit: z.number().int().min(1).max(AGGREGATE_MAX_GROUPS).optional(),
  })
  .meta({ id: 'AggregateQuery' });
/** What callers send: `measures` may be left out (it counts records). */
export type AggregateQuery = Omit<z.input<typeof AggregateQuerySchema>, 'filter'> & { filter?: Filter };

const MeasureValuesSchema = z.record(z.string(), z.union([z.number(), z.string()]).nullable());

export const AggregateGroupSchema = z.object({
  /** The group's value: an option value, a record id, true/false, a date; null for records without one. */
  key: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** The option label or the related record's label, when there is one. */
  label: z.string().optional(),
  count: z.number().int(),
  /** Measures by key: `count`, `sum.amount`, `max.close_date`… */
  values: MeasureValuesSchema,
});
export type AggregateGroup = z.infer<typeof AggregateGroupSchema>;

export const AggregateResultSchema = z
  .object({
    object: z.string(),
    groupBy: z.string().nullable(),
    groups: z.array(AggregateGroupSchema),
    /** The same measures over every matching record. */
    total: z.object({ count: z.number().int(), values: MeasureValuesSchema }),
    /** More groups exist than `limit` returned. */
    truncated: z.boolean(),
  })
  .meta({ id: 'AggregateResult' });
export type AggregateResult = z.infer<typeof AggregateResultSchema>;

/** `count`, or `<fn>.<field>`: how a measure is keyed in `values`. */
export const measureKey = (measure: AggregateMeasure): string =>
  measure.field ? `${measure.fn}.${measure.field}` : measure.fn;

/** Why an aggregation does not fit the object's fields, or null when it does. */
export const aggregateProblem = (
  query: { groupBy?: string | undefined; measures: AggregateMeasure[] },
  fieldsByName: Map<string, FieldMetadata>,
): { message: string; field?: string } | null => {
  if (query.groupBy) {
    const field = fieldsByName.get(query.groupBy);

    if (!field) {
      return { message: `Unknown field "${query.groupBy}" in groupBy`, field: query.groupBy };
    }

    if (!AGGREGATE_GROUP_FIELD_TYPES.has(field.type)) {
      return { message: `Records cannot be grouped by "${field.name}" (${field.type})`, field: field.name };
    }
  }

  const keys = new Set<string>();

  for (const measure of query.measures) {
    const key = measureKey(measure);

    if (keys.has(key)) {
      return { message: `Measure "${key}" is listed twice` };
    }

    keys.add(key);

    if (!measure.field) {
      if (measure.fn !== 'count') {
        return { message: `"${measure.fn}" needs a field` };
      }

      continue;
    }

    const field = fieldsByName.get(measure.field);

    if (!field) {
      return { message: `Unknown field "${measure.field}" in measures`, field: measure.field };
    }

    if ((measure.fn === 'sum' || measure.fn === 'avg') && !SUMMABLE_FIELD_TYPES.has(field.type)) {
      return {
        message: `"${measure.fn}" needs a number or money field; "${field.name}" is ${field.type}`,
        field: field.name,
      };
    }

    if ((measure.fn === 'min' || measure.fn === 'max') && !ORDERED_FIELD_TYPES.has(field.type)) {
      return {
        message: `"${measure.fn}" needs a number, money or date field; "${field.name}" is ${field.type}`,
        field: field.name,
      };
    }
  }

  return null;
};

const present = (value: unknown) => value !== null && value !== undefined && value !== '';

/** The measures over a set of records, keyed by `measureKey`. */
export const measureRecords = (
  records: RecordData[],
  measures: AggregateMeasure[],
): Record<string, number | string | null> => {
  const values: Record<string, number | string | null> = {};

  for (const measure of measures) {
    const key = measureKey(measure);
    const raw = measure.field ? records.map((record) => record[measure.field as string]).filter(present) : [];

    switch (measure.fn) {
      case 'count':
        values[key] = measure.field ? raw.length : records.length;
        break;
      case 'sum':
      case 'avg': {
        const numbers = raw.filter((value): value is number => typeof value === 'number');
        const sum = numbers.reduce((total, value) => total + value, 0);
        values[key] = measure.fn === 'sum' ? sum : numbers.length > 0 ? sum / numbers.length : null;
        break;
      }
      default: {
        const sorted = (raw as (number | string)[]).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        values[key] = (measure.fn === 'min' ? sorted[0] : sorted.at(-1)) ?? null;
      }
    }
  }

  return values;
};

/**
 * Order groups and apply the limit, the same way wherever they were computed: largest first, except select fields,
 * whose options all appear in their order (empty ones too, labelled), followed by values no longer among them.
 */
export const finishGroups = (
  groups: AggregateGroup[],
  field: FieldMetadata | undefined,
  measures: AggregateMeasure[],
  limit = AGGREGATE_DEFAULT_GROUPS,
): { groups: AggregateGroup[]; truncated: boolean } => {
  let ordered = [...groups].sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  const options = (field?.settings as { options?: { value: string; label: string }[] } | undefined)?.options;

  if (field?.type === 'select' && options) {
    const byKey = new Map(ordered.map((group) => [group.key, group]));
    const empty = measureRecords([], measures);
    ordered = [
      ...options.map(
        (option): AggregateGroup => ({
          ...(byKey.get(option.value) ?? { key: option.value, count: 0, values: empty }),
          label: option.label,
        }),
      ),
      ...ordered.filter((group) => !options.some((option) => option.value === group.key)),
    ];
  }

  return { groups: ordered.slice(0, limit), truncated: ordered.length > limit };
};

/** Aggregate records already filtered to the query's object and filter, the way the server does. */
export const aggregateRecords = (
  records: RecordData[],
  fields: FieldMetadata[],
  query: { object: string; groupBy?: string | undefined; measures: AggregateMeasure[]; limit?: number | undefined },
): AggregateResult => {
  const total = { count: records.length, values: measureRecords(records, query.measures) };

  if (!query.groupBy) {
    return { object: query.object, groupBy: null, groups: [], total, truncated: false };
  }

  const buckets = new Map<string, { key: AggregateGroup['key']; records: RecordData[] }>();

  for (const record of records) {
    const raw = record[query.groupBy];
    const key = present(raw) ? (raw as string | number | boolean) : null;
    const id = JSON.stringify(key);
    const bucket = buckets.get(id) ?? { key, records: [] };
    bucket.records.push(record);
    buckets.set(id, bucket);
  }

  const groups = [...buckets.values()].map((bucket) => ({
    key: bucket.key,
    count: bucket.records.length,
    values: measureRecords(bucket.records, query.measures),
  }));
  const field = fields.find((candidate) => candidate.name === query.groupBy);

  return {
    object: query.object,
    groupBy: query.groupBy,
    total,
    ...finishGroups(groups, field, query.measures, query.limit),
  };
};
