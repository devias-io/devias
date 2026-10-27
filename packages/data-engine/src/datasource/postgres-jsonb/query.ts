import { RECORD_COUNT_CAP } from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import type { ValidatedQuery } from '../../query/validate';
import { queryHash } from './cursor';
import { compileFilter, compileSearch } from './filter';
import { type CompiledSort, compileSorts, keysetPredicate, orderByClause } from './sort';

export const COUNT_CAP = RECORD_COUNT_CAP;

export interface CompiledQuery {
  select: SQL;
  count?: SQL;
  sorts: CompiledSort[];
  hash: string;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const isoColumn = (column: string, alias: string): SQL =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', ${ISO}) AS ${alias}`);

/** Compile a validated query (plus already-decoded cursor keys) into the page SELECT and optional count. */
export const compileQuery = (workspaceId: string, q: ValidatedQuery, cursorKeys?: unknown[]): CompiledQuery => {
  const hash = queryHash({ object: q.object.nameSingular, filter: q.filter, sort: q.sort, search: q.search });
  const sorts = compileSorts(q.sort, q.fieldsByName);

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

  const baseWhere = sql.join(where, sql` AND `);
  const pageWhere = cursorKeys ? sql`${baseWhere} AND ${keysetPredicate(sorts, cursorKeys)}` : baseWhere;

  const columns: SQL[] = [
    sql.raw('r.id'),
    sql.raw('r.data'),
    isoColumn('r.created_at', 'created_at'),
    isoColumn('r.updated_at', 'updated_at'),
    sql.raw('r.created_by'),
    sql.raw('r.updated_by'),
  ];

  for (const [i, s] of sorts.slice(0, -1).entries()) {
    columns.push(sql`${s.expr} AS ${sql.raw(`__k${i}`)}`);
  }

  const select = sql`SELECT ${sql.join(columns, sql`, `)} FROM record r WHERE ${pageWhere} ORDER BY ${orderByClause(sorts)} LIMIT ${q.limit + 1}`;
  const count = q.count
    ? sql`SELECT count(*)::int AS count FROM (SELECT 1 FROM record r WHERE ${baseWhere} LIMIT ${COUNT_CAP}) t`
    : undefined;

  return { select, count, sorts, hash };
};

/** Sort key values of a page row, in `sorts` order (the trailing key is the id). */
export const sortKeysOf = (row: Record<string, unknown>, sorts: CompiledSort[]): unknown[] => {
  const keys: unknown[] = [];

  for (let i = 0; i < sorts.length - 1; i += 1) {
    keys.push(row[`__k${i}`] ?? null);
  }

  keys.push(row.id);

  return keys;
};
