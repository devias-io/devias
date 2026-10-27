import type { FieldMetadata, Sort } from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import { validationError } from '../../errors';
import { castFor, resolveFieldRef, sortExpr, typedParam, type ValueCast } from './fields';

export interface CompiledSort {
  name: string;
  expr: SQL;
  direction: 'asc' | 'desc';
  cast: ValueCast;
}

/** Sort list plus the mandatory `r.id ASC` tiebreaker. */
export const compileSorts = (sort: Sort[], fieldsByName: Map<string, FieldMetadata>): CompiledSort[] => {
  const sorts: CompiledSort[] = sort.map((s) => {
    const ref = resolveFieldRef(fieldsByName, s.field);

    if (!ref) {
      throw validationError(`Unknown field "${s.field}" in sort`, { field: s.field });
    }

    return { name: s.field, expr: sortExpr(ref), direction: s.direction, cast: castFor(ref) };
  });
  sorts.push({ name: 'id', expr: sql.raw('r.id'), direction: 'asc', cast: 'uuid' });

  return sorts;
};

/** `ORDER BY e0 ASC NULLS LAST, e1 DESC NULLS FIRST, ..., r.id ASC` (Postgres defaults, made explicit). */
export const orderByClause = (sorts: CompiledSort[]): SQL =>
  sql.join(
    sorts.map((s) => sql`${s.expr} ${sql.raw(s.direction === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS FIRST')}`),
    sql`, `,
  );

/**
 * Keyset predicate: rows strictly after the cursor keys in `sorts` order, with null-aware pieces.
 * ASC (nulls last): after a non-null key = `(e > k OR e IS NULL)`, after a null key = nothing.
 * DESC (nulls first): after a non-null key = `e < k`, after a null key = `e IS NOT NULL`.
 * Equality is `IS NOT DISTINCT FROM` so null keys chain correctly to the next sort.
 */
export const keysetPredicate = (sorts: CompiledSort[], keys: unknown[]): SQL => {
  if (keys.length !== sorts.length) {
    throw validationError('Cursor does not match the sort');
  }

  const after = (s: CompiledSort, key: unknown): SQL => {
    if (key === null || key === undefined) {
      return s.direction === 'asc' ? sql.raw('false') : sql`${s.expr} IS NOT NULL`;
    }

    const param = typedParam(key, s.cast);

    if (s.name === 'id') {
      return sql`${s.expr} > ${param}`;
    }

    return s.direction === 'asc' ? sql`(${s.expr} > ${param} OR ${s.expr} IS NULL)` : sql`${s.expr} < ${param}`;
  };
  const equal = (s: CompiledSort, key: unknown): SQL =>
    key === null || key === undefined
      ? sql`${s.expr} IS NULL`
      : sql`${s.expr} IS NOT DISTINCT FROM ${typedParam(key, s.cast)}`;

  const branches: SQL[] = [];

  for (let i = 0; i < sorts.length; i += 1) {
    const s = sorts[i] as CompiledSort;
    const pieces: SQL[] = [];

    for (let j = 0; j < i; j += 1) {
      pieces.push(equal(sorts[j] as CompiledSort, keys[j]));
    }

    pieces.push(after(s, keys[i]));
    branches.push(pieces.length === 1 ? (pieces[0] as SQL) : sql`(${sql.join(pieces, sql` AND `)})`);
  }

  return sql`(${sql.join(branches, sql` OR `)})`;
};
