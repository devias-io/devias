import { type Filter, hashValue, type Sort } from '@devias/core';
import { EngineError } from '../../errors';

/** Keyset cursor: base64url JSON `{ v: 1, q: <query hash>, k: [...sort keys, id] }`. */
export interface CursorPayload {
  v: 1;
  q: string;
  k: unknown[];
}

export const queryHash = (input: { object: string; filter?: Filter; sort: Sort[]; search?: string }): string =>
  hashValue({ object: input.object, filter: input.filter ?? null, sort: input.sort, search: input.search ?? null });

export const encodeCursor = (q: string, keys: unknown[]): string =>
  Buffer.from(JSON.stringify({ v: 1, q, k: keys } satisfies CursorPayload), 'utf8').toString('base64url');

export const decodeCursor = (cursor: string, expectedHash: string, expectedKeys: number): unknown[] => {
  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new EngineError('INVALID_CURSOR', 'Cursor is not valid');
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new EngineError('INVALID_CURSOR', 'Cursor is not valid');
  }

  const { v, q, k } = payload as Partial<CursorPayload>;

  if (v !== 1 || typeof q !== 'string' || !Array.isArray(k)) {
    throw new EngineError('INVALID_CURSOR', 'Cursor is not valid');
  }

  if (q !== expectedHash) {
    throw new EngineError('INVALID_CURSOR', 'Cursor was issued for a different query (object, filter, sort or search)');
  }

  if (k.length !== expectedKeys) {
    throw new EngineError('INVALID_CURSOR', 'Cursor does not match the sort');
  }

  return k;
};
