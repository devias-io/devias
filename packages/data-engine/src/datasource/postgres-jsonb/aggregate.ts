import type { AggregateGroup, AggregateMeasure, FieldMetadata } from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import { type Db, runRaw, toNumber } from '../../db/exec';
import type { ValidatedAggregate } from '../../query/validate';
import { jsonTextNonEmpty, valueExpr } from './fields';
import { compileFilter, compileSearch } from './filter';

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** One measure as a SQL expression; numbers come back as float8, dates as ISO text. */
const measureExpr = (measure: AggregateMeasure, fieldsByName: Map<string, FieldMetadata>): SQL => {
  if (!measure.field) {
    return sql`count(*)::int`;
  }

  const field = fieldsByName.get(measure.field) as FieldMetadata;
  const ref = { kind: 'field', field } as const;

  switch (measure.fn) {
    case 'count':
      return sql`count(${jsonTextNonEmpty(field.name)})::int`;
    case 'sum':
      return sql`coalesce(sum(${valueExpr(ref)}), 0)::float8`;
    case 'avg':
      return sql`avg(${valueExpr(ref)})::float8`;
    default: {
      const fn = sql.raw(measure.fn);

      if (field.type === 'date') {
        return sql`${fn}(${valueExpr(ref)})::text`;
      }

      if (field.type === 'date_time') {
        return sql`to_char(${fn}(${valueExpr(ref)}) AT TIME ZONE 'UTC', ${sql.raw(ISO)})`;
      }

      return sql`${fn}(${valueExpr(ref)})::float8`;
    }
  }
};

/** The group key: the field's value, or null for records without one. */
const groupExpr = (field: FieldMetadata): SQL =>
  field.type === 'boolean' ? valueExpr({ kind: 'field', field }) : jsonTextNonEmpty(field.name);

type Row = Record<string, unknown>;

const valuesOf = (row: Row, measures: AggregateMeasure[], keys: string[]) =>
  Object.fromEntries(
    measures.map((measure, i) => {
      const raw = row[`m${i}`];
      const value =
        raw === null || raw === undefined
          ? null
          : typeof raw === 'string' && measure.fn !== 'min' && measure.fn !== 'max'
            ? toNumber(raw)
            : raw;

      return [keys[i] as string, value as number | string | null];
    }),
  );

/**
 * Counts and measures per group in one GROUP BY, plus the totals. Select fields return every group (their options are
 * few, and all of them are shown); other fields return one more group than the limit, so the caller knows it was cut.
 */
export const aggregate = async (
  db: Db,
  workspaceId: string,
  q: ValidatedAggregate,
  keys: string[],
): Promise<{ groups: AggregateGroup[]; total: { count: number; values: Record<string, number | string | null> } }> => {
  const where: SQL[] = [
    sql`r.workspace_id = ${workspaceId}`,
    sql`r.object_id = ${q.object.id}`,
    sql`r.deleted_at IS NULL`,
  ];

  if (q.filter) {
    where.push(compileFilter(q.filter, q.fieldsByName));
  }

  if (q.search) {
    where.push(compileSearch(q.search, q.fields));
  }

  const whereSql = sql.join(where, sql` AND `);
  const measures = sql.join(
    q.measures.map((measure, i) => sql`${measureExpr(measure, q.fieldsByName)} AS ${sql.raw(`m${i}`)}`),
    sql`, `,
  );

  const totals = await runRaw<Row>(db, sql`SELECT count(*)::int AS count, ${measures} FROM record r WHERE ${whereSql}`);
  const totalRow = totals[0] ?? { count: 0 };
  const total = { count: toNumber(totalRow.count ?? 0), values: valuesOf(totalRow, q.measures, keys) };

  if (!q.groupBy) {
    return { groups: [], total };
  }

  const limit = q.groupBy.type === 'select' ? sql`` : sql` LIMIT ${q.limit + 1}`;
  const rows = await runRaw<Row>(
    db,
    sql`SELECT ${groupExpr(q.groupBy)} AS key, count(*)::int AS count, ${measures} FROM record r WHERE ${whereSql} GROUP BY 1 ORDER BY 2 DESC, 1 NULLS LAST${limit}`,
  );
  const groups = rows.map(
    (row): AggregateGroup => ({
      key: (row.key ?? null) as AggregateGroup['key'],
      count: toNumber(row.count ?? 0),
      values: valuesOf(row, q.measures, keys),
    }),
  );

  return { groups, total };
};
