import type { ActionContext } from '@devias/server';
import { vi } from 'vitest';

export const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A fake `fetch` that records calls and answers with the given status, headers and JSON body. */
export const fakeFetch = (
  answer: (url: string, init?: RequestInit) => { status?: number; headers?: Record<string, string>; body?: unknown },
) =>
  vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const result = answer(url, init);

    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json', ...result.headers },
    });
  });

type Row = Record<string, unknown> & { id: string };

/** The records an action reads and writes, held in memory by object name. */
export const fakeRecords = (rows: Record<string, Row[]>) => {
  const update = vi.fn(async (object: string, id: string, patch: Record<string, unknown>) => {
    const row = rows[object]?.find((candidate) => candidate.id === id);

    if (!row) {
      throw new Error(`no ${object} ${id}`);
    }

    Object.assign(row, patch);

    return row;
  });
  const list = vi.fn(async (query: { object: string; filter?: { and?: { field: string; value: unknown }[] } }) => ({
    items: (rows[query.object] ?? []).filter((row) =>
      (query.filter?.and ?? []).every((condition) => row[condition.field] === condition.value),
    ),
  }));
  const get = vi.fn(async (object: string, id: string) => {
    const row = rows[object]?.find((candidate) => candidate.id === id);

    if (!row) {
      throw new Error(`no ${object} ${id}`);
    }

    return { ...row };
  });

  return { get, list, update };
};

/**
 * What a handler sees: one workspace API key connection with these values, an in-memory `kv` and these records.
 * `reportAuthFailure` records what the code reported.
 */
export const contextWith = (
  values: Record<string, string>,
  fetch: ActionContext['fetch'],
  options: { variables?: Record<string, string>; rows?: Record<string, Row[]> } = {},
) => {
  const store = new Map<string, unknown>();
  const records = fakeRecords(options.rows ?? {});
  const ctx = {
    workspaceId: 'ws_test',
    variables: options.variables ?? {},
    connection: async () => ({
      id: 'conn_test',
      providerId: 'default',
      kind: 'api_key' as const,
      visibility: 'workspace' as const,
      account: null,
      values,
      accessToken: '',
    }),
    reportAuthFailure: vi.fn<(message?: string) => void>(),
    kv: {
      get: async <T>(key: string) => store.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    },
    fetch,
    logger: noopLogger,
    actor: { kind: 'function', id: '01a17ead-51f9-718e-a1bd-6a0e7b0c1f10' },
    engine: { records } as unknown as ActionContext['engine'],
    notify: async () => ({ recipients: 0, created: 0, updated: 0 }),
  } satisfies ActionContext;

  return Object.assign(ctx, { records, store });
};
