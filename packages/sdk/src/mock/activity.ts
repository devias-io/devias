import {
  ACTIVITY_DEFAULT_LIMIT,
  type ActivityPage,
  type ActivityQuery,
  ActivityQuerySchema,
  DeviasApiError,
} from '@devias/core';
import { resolveObject } from './records';
import type { MockStore } from './store';

/** A record's activity over the store's activity list, with the server's paging, validation and errors. */

// Cursors are opaque: how many entries the previous pages covered.
const encodeCursor = (offset: number): string => btoa(JSON.stringify({ a: offset }));

const decodeCursor = (cursor: string): number => {
  try {
    const parsed = JSON.parse(atob(cursor)) as { a?: unknown };

    if (typeof parsed.a !== 'number' || !Number.isInteger(parsed.a) || parsed.a < 0) {
      throw 0;
    }

    return parsed.a;
  } catch {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The activity cursor is malformed');
  }
};

export const listActivity = (
  store: MockStore,
  objectName: string,
  id: string,
  query: ActivityQuery = {},
): ActivityPage => {
  const object = resolveObject(store, objectName);
  const parsed = ActivityQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid activity query', parsed.error.issues);
  }

  const offset = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : 0;
  const limit = parsed.data.limit ?? ACTIVITY_DEFAULT_LIMIT;
  const entries = store.activity
    .filter((row) => row.objectId === object.id && row.recordId === id)
    .map((row) => row.entry)
    .reverse();

  return {
    items: structuredClone(entries.slice(offset, offset + limit)),
    nextCursor: offset + limit < entries.length ? encodeCursor(offset + limit) : null,
  };
};
