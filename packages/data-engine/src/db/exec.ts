import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * A drizzle Postgres database or transaction, regardless of driver (node-postgres or PGlite).
 * The engine only relies on the shared PgDatabase surface.
 */
// biome-ignore lint/suspicious/noExplicitAny: driver-independent database handle
export type Db = PgDatabase<PgQueryResultHKT, any, any>;

/** Run raw SQL and return plain row objects; normalizes the different `execute()` result shapes. */
export const runRaw = async <T extends Record<string, unknown> = Record<string, unknown>>(
  db: Db,
  query: SQL,
): Promise<T[]> => {
  const result: unknown = await db.execute(query);

  if (Array.isArray(result)) {
    return result as T[];
  }

  const rows = (result as { rows?: unknown }).rows;

  return Array.isArray(rows) ? (rows as T[]) : [];
};

/** Postgres timestamps arrive as Date (typed queries) or text (raw queries); always emit ISO 8601. */
export const toIso = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  return new Date(0).toISOString();
};

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return 0;
};

/** jsonb columns arrive parsed from both drivers, but a text fallback keeps us safe. */
export const parseJson = <T = unknown>(value: unknown): T => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  return value as T;
};
