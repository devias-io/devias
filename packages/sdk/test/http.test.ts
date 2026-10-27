import { describe, expect, it, vi } from 'vitest';
import {
  createClient,
  createHttpClient,
  createWorkspaceApi,
  DeviasApiError,
  joinUrl,
  parseRetryAfter,
  q,
} from '../src';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const stub = (handler: (call: Call, n: number) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);

    return handler(call, calls.length);
  });

  return { fetch, calls };
};

const headersOf = (call: Call | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries((call?.init?.headers ?? {}) as Record<string, string>));

const bodyOf = (call: Call | undefined): unknown => JSON.parse(String(call?.init?.body));

const expectError = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DeviasApiError);

    return error as DeviasApiError;
  }

  throw new Error('expected the call to reject');
};

describe('createClient', () => {
  const setup = () => {
    const { fetch, calls } = stub(() => json({ ok: true }));
    const client = createClient({ baseUrl: 'http://localhost:3000/', workspaceId: 'ws 1', apiKey: 'key-123', fetch });

    return { client, calls };
  };

  it('sends auth headers, JSON bodies and cookies on every request', async () => {
    const { client, calls } = setup();
    const query = q('person').limit(10).build();
    await client.records.list(query);
    const [call] = calls;
    expect(call?.url).toBe('http://localhost:3000/api/workspaces/ws%201/records/person/list');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.credentials).toBe('include');
    expect(headersOf(call)).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': 'key-123',
    });
    expect(bodyOf(call)).toEqual(query);
  });

  it('maps every record call to the REST contract', async () => {
    const { client, calls } = setup();
    await client.records.get('person', 'p1');
    await client.records.create('person', { first_name: 'Ada' });
    await client.records.update('person', 'p1', { last_name: 'Lovelace' });
    await client.records.delete('person', ['p1', 'p2']);
    await client.records.lookup({ text: 'ada', objects: ['person'] });
    expect(
      calls.map((c) => [c.init?.method, c.url.replace('http://localhost:3000/api/workspaces/ws%201', '')]),
    ).toEqual([
      ['GET', '/records/person/p1'],
      ['POST', '/records/person'],
      ['PATCH', '/records/person/p1'],
      ['DELETE', '/records/person'],
      ['POST', '/lookup'],
    ]);
    expect(bodyOf(calls[1])).toEqual({ first_name: 'Ada' });
    expect(bodyOf(calls[2])).toEqual({ last_name: 'Lovelace' });
    expect(bodyOf(calls[3])).toEqual({ ids: ['p1', 'p2'] });
    expect(bodyOf(calls[4])).toEqual({ text: 'ada', objects: ['person'] });
    expect(headersOf(calls[0])['content-type']).toBeUndefined();
  });

  it('maps metadata and module calls to the REST contract', async () => {
    const { client, calls } = setup();
    const manifest = { id: 'ext', version: '1.0.0' } as never;
    await client.metadata.getSchema();
    await client.metadata.objects.list();
    await client.metadata.fields.get('f1');
    await client.metadata.views.create({ objectId: 'o1', label: 'V', type: 'table' });
    await client.metadata.layouts.update('l1', { label: 'L' });
    await client.metadata.navItems.delete('n1');
    await client.metadata.commandItems.list();
    await client.modules.list();
    await client.modules.plan(manifest);
    await client.modules.apply(manifest, { expectedPlanHash: 'h', allowDestructive: true });
    await client.modules.uninstall('ext', { allowDestructive: true });
    await client.modules.uninstall('ext');
    expect(
      calls.map((c) => [c.init?.method, c.url.replace('http://localhost:3000/api/workspaces/ws%201', '')]),
    ).toEqual([
      ['GET', '/metadata'],
      ['GET', '/metadata/objects'],
      ['GET', '/metadata/fields/f1'],
      ['POST', '/metadata/views'],
      ['PATCH', '/metadata/layouts/l1'],
      ['DELETE', '/metadata/nav-items/n1'],
      ['GET', '/metadata/command-items'],
      ['GET', '/modules'],
      ['POST', '/modules/plan'],
      ['POST', '/modules/apply'],
      ['DELETE', '/modules/ext?allowDestructive=true'],
      ['DELETE', '/modules/ext'],
    ]);
    expect(bodyOf(calls[8])).toEqual({ manifest });
    expect(bodyOf(calls[9])).toEqual({ manifest, expectedPlanHash: 'h', allowDestructive: true });
  });

  it('resolves 204 responses to undefined', async () => {
    const { fetch } = stub(() => new Response(null, { status: 204 }));
    const client = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch });
    await expect(client.metadata.objects.delete('o1')).resolves.toBeUndefined();
    await expect(client.records.delete('person', ['p1'])).resolves.toBeUndefined();
  });

  it('throws DeviasApiError from the error envelope, INTERNAL for non-JSON failures', async () => {
    const { fetch } = stub((_, n) =>
      n === 1
        ? json({ error: { code: 'NOT_FOUND', message: 'No such person', details: { id: 'p1' } } }, { status: 404 })
        : new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const client = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch });
    const notFound = await expectError(client.records.get('person', 'p1'));
    expect(notFound.status).toBe(404);
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.message).toBe('No such person');
    expect(notFound.details).toEqual({ id: 'p1' });
    const internal = await expectError(client.records.get('person', 'p2'));
    expect(internal.status).toBe(502);
    expect(internal.code).toBe('INTERNAL');
    expect(internal.message).toContain('502');
  });

  it('retries idempotent GETs once on network errors but not writes', async () => {
    let failures = 0;
    const { fetch } = stub(() => {
      failures += 1;

      if (failures <= 1) {
        throw new TypeError('fetch failed');
      }

      return json({ id: 'p1' });
    });
    const client = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch });
    await expect(client.records.get('person', 'p1')).resolves.toEqual({ id: 'p1' });
    expect(fetch).toHaveBeenCalledTimes(2);

    const failing = stub(() => {
      throw new TypeError('fetch failed');
    });
    const flaky = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch: failing.fetch });
    const write = await expectError(flaky.records.create('person', {}));
    expect(write.code).toBe('NETWORK');
    expect(write.status).toBe(0);
    expect(failing.fetch).toHaveBeenCalledTimes(1);
    const read = await expectError(flaky.records.get('person', 'p1'));
    expect(read.code).toBe('NETWORK');
    expect(failing.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry or wrap aborted requests', async () => {
    const { fetch } = stub(() => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const http = createHttpClient({ baseUrl: 'http://localhost:3000', fetch });
    await expect(http.get('/api/me')).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits for Retry-After and retries once on 429', async () => {
    const { fetch, calls } = stub((_, n) =>
      n === 1
        ? json(
            { error: { code: 'RATE_LIMITED', message: 'Slow down' } },
            { status: 429, headers: { 'retry-after': '0' } },
          )
        : json({ items: [], nextCursor: null }),
    );
    const client = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch });
    await expect(client.records.list(q('person').build())).resolves.toEqual({ items: [], nextCursor: null });
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0])).toEqual(bodyOf(calls[1]));

    const always = stub(() =>
      json({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }, { status: 429, headers: { 'retry-after': '0' } }),
    );
    const limited = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', fetch: always.fetch });
    const error = await expectError(limited.records.get('person', 'p1'));
    expect(error.status).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(always.fetch).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After up to 5 seconds', async () => {
    vi.useFakeTimers();

    try {
      const { fetch } = stub((_, n) =>
        n === 1 ? json({}, { status: 429, headers: { 'retry-after': '120' } }) : json({ ok: true }),
      );
      const http = createHttpClient({ baseUrl: 'http://localhost:3000', fetch });
      const pending = http.get('/api/me');
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }

    expect(parseRetryAfter('120')).toBe(5_000);
    expect(parseRetryAfter('2')).toBe(2_000);
    expect(parseRetryAfter(null)).toBe(1_000);
    expect(parseRetryAfter('garbage')).toBe(1_000);
    const now = Date.parse('2026-09-21T10:00:00Z');
    expect(parseRetryAfter('Mon, 21 Sep 2026 10:00:03 GMT', 5_000, now)).toBe(3_000);
    expect(parseRetryAfter('Mon, 21 Sep 2026 09:00:00 GMT', 5_000, now)).toBe(0);
  });

  it('exposes the http client for custom routes', async () => {
    const { fetch, calls } = stub(() => json({ pong: true }));
    const client = createClient({ baseUrl: 'http://localhost:3000', workspaceId: 'ws', apiKey: 'k', fetch });
    await client.http.get('/api/workspaces/ws/mod/ping', { verbose: true, skip: undefined });
    expect(calls[0]?.url).toBe('http://localhost:3000/api/workspaces/ws/mod/ping?verbose=true');
    expect(client.http.headers()).toEqual({ 'x-api-key': 'k' });
    expect(joinUrl('http://x/', 'a?b=1', { c: 2 })).toBe('http://x/a?b=1&c=2');
    expect(joinUrl('http://x', 'a')).toBe('http://x/a');
  });
});

describe('createWorkspaceApi', () => {
  it('calls the workspace-independent endpoints', async () => {
    const { fetch, calls } = stub((_, n) =>
      n === 1
        ? json({ user: { id: 'u1', name: 'Dev', email: 'dev@example.com' }, workspaces: [] })
        : n === 2
          ? json([{ id: 'w1', name: 'W', slug: 'w', role: 'owner' }])
          : json({ id: 'w2', name: 'New', slug: 'new', role: 'owner' }, { status: 201 }),
    );
    const api = createWorkspaceApi({ baseUrl: 'http://localhost:3000', fetch });
    const me = await api.me();
    expect(me.user.email).toBe('dev@example.com');
    expect(await api.listWorkspaces()).toEqual([{ id: 'w1', name: 'W', slug: 'w', role: 'owner' }]);
    expect((await api.createWorkspace({ name: 'New', slug: 'new' })).id).toBe('w2');
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['GET', 'http://localhost:3000/api/me'],
      ['GET', 'http://localhost:3000/api/workspaces'],
      ['POST', 'http://localhost:3000/api/workspaces'],
    ]);
    expect(bodyOf(calls[2])).toEqual({ name: 'New', slug: 'new' });
  });

  it('says where a module logo is served from, outside the workspace, and the mock has none', () => {
    const client = createClient({
      baseUrl: 'http://localhost:3000/',
      workspaceId: 'ws',
      fetch: stub(() => json({})).fetch,
    });
    expect(client.modules.logoUrl('payment-stripe')).toBe('http://localhost:3000/api/modules/payment-stripe/logo');
    expect(client.modules.logoUrl('a b')).toBe('http://localhost:3000/api/modules/a%20b/logo');
  });
});
