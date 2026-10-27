import { createHmac } from 'node:crypto';
import type { ActionContext } from '@devias/server';
import { vi } from 'vitest';

export const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A fake `fetch` that records calls and answers with the given status and JSON body. */
export const fakeFetch = (
  answer: (url: string, init?: RequestInit) => { status?: number; body?: unknown } | Response,
) =>
  vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const result = answer(url, init);

    if (result instanceof Response) {
      return result;
    }

    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });

/**
 * What a handler sees: one workspace API key connection with these values. These providers never touch the engine,
 * so it is an empty stand-in; `reportAuthFailure` records what the code reported.
 */
export const contextWith = (values: Record<string, string>, fetch: ActionContext['fetch']) =>
  ({
    workspaceId: 'ws_test',
    variables: {},
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
    kv: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    fetch,
    logger: noopLogger,
    actor: { kind: 'function', id: '01a17522-1eb2-7772-9d81-443b90f3b919' },
    engine: {} as ActionContext['engine'],
    notify: async () => ({ recipients: 0, created: 0, updated: 0 }),
  }) satisfies ActionContext;

export const stripeSignature = (secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
