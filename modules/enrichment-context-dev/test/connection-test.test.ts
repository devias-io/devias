import { describe, expect, it } from 'vitest';
import { testConnection } from '../src/server/connection-test';
import { contextWith, fakeFetch } from './helpers';

describe('testConnection', () => {
  const test = (status: number) =>
    testConnection(
      contextWith(
        { api_key: 'ctx_key' },
        fakeFetch(() => ({ status })),
      ),
    );

  it('sends an enrichment request with nothing to go on, which a good key answers with 400 and costs nothing', async () => {
    const fetch = fakeFetch(() => ({ status: 400 }));
    expect(await testConnection(contextWith({ api_key: 'ctx_key' }, fetch))).toEqual({
      ok: true,
      message: 'Connected',
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.context.dev/v1/people/enrich');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ctx_key');
  });

  it('says what is wrong with a key that is refused, out of credits or not allowed', async () => {
    expect(await test(401)).toEqual({ ok: false, message: 'Context.dev rejected the API key' });
    expect(await test(402)).toEqual({ ok: true, message: 'Connected, but the account is out of credits' });
    expect(await test(403)).toEqual({
      ok: false,
      message: 'Context.dev says this key is not allowed to look people up',
    });
    expect(await test(500)).toEqual({ ok: false, message: 'Context.dev answered 500' });
  });

  it('reports a service that cannot be reached', async () => {
    const ctx = contextWith({ api_key: 'k' }, async () => {
      throw new Error('offline');
    });
    expect(await testConnection(ctx)).toEqual({ ok: false, message: 'Context.dev could not be reached: offline' });
  });
});
