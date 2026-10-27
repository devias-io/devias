import { timestamp } from 'drizzle-orm/pg-core';

/** A timestamp with its time zone, as a `Date`. */
export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });
