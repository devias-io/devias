import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// biome-ignore lint/suspicious/noExplicitAny: driver-independent handle shared with the engine
export type Db = PgDatabase<PgQueryResultHKT, any, any>;
export type SqlFragment = ReturnType<typeof sql>;

export const PLACES: [city: string, country: string, timeZone: string][] = [
  ['Bucharest', 'Romania', 'Europe/Bucharest'],
  ['Cluj-Napoca', 'Romania', 'Europe/Bucharest'],
  ['Timișoara', 'Romania', 'Europe/Bucharest'],
  ['Iași', 'Romania', 'Europe/Bucharest'],
  ['London', 'United Kingdom', 'Europe/London'],
  ['Berlin', 'Germany', 'Europe/Berlin'],
  ['Paris', 'France', 'Europe/Paris'],
  ['Madrid', 'Spain', 'Europe/Madrid'],
  ['Milan', 'Italy', 'Europe/Rome'],
  ['Amsterdam', 'Netherlands', 'Europe/Amsterdam'],
  ['Warsaw', 'Poland', 'Europe/Warsaw'],
  ['New York', 'United States', 'America/New_York'],
  ['San Francisco', 'United States', 'America/Los_Angeles'],
  ['Austin', 'United States', 'America/Chicago'],
  ['Toronto', 'Canada', 'America/Toronto'],
];

export const SOURCES = ['inbound', 'outbound', 'referral', 'partner', 'event', 'other'];

/** A Postgres text array literal of the given strings, for `(array[...])[n]` picks. */
export const list = (values: readonly string[]) =>
  sql.raw(`array[${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(',')}]::text[]`);
/**
 * Every random draw mentions the row number (`g.n * 0`), otherwise Postgres sees a subquery that does not depend on
 * the row and evaluates it once for all of them.
 */
/** A random element of a text array: `pick(arr)`. */
export const pick = (values: readonly string[]) =>
  sql`(${list(values)})[1 + floor(greatest(random(), g.n * 0) * ${values.length})::int]`;
