import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Asset, AssetPage, AssetsUsage } from '@devias/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const ORIGIN = 'http://localhost:3000';

describe('assets API', () => {
  let server: Server;
  let folder: string;
  let api: Api;
  let cookie: string;
  let base: string;
  let otherBase: string;

  type Auth = { cookie?: string; apiKey?: string };

  /** The upload route takes the file itself as the body. */
  const upload = async (
    name: string,
    body: Uint8Array | string,
    options: { auth?: Auth; headers?: Record<string, string> } = {},
  ) => {
    const auth = options.auth ?? { cookie };
    const response = await server.app.request(`${base}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        ...(auth.cookie ? { cookie: auth.cookie } : {}),
        ...(auth.apiKey ? { 'x-api-key': auth.apiKey } : {}),
        ...(options.headers ?? {}),
      },
      body,
    });

    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
  const get = (path: string, headers: Record<string, string> = {}, auth: Auth = { cookie }) =>
    server.app.request(path, {
      headers: {
        ...(auth.cookie ? { cookie: auth.cookie } : {}),
        ...(auth.apiKey ? { 'x-api-key': auth.apiKey } : {}),
        ...headers,
      },
    });
  const anonymous: Auth = {};
  const stored = async (name: string, bytes: Uint8Array = PNG) => {
    const response = await upload(name, bytes);
    expect(response.status).toBe(201);

    return response.json as unknown as Asset;
  };
  const pathOf = (url: string) => url.replace(ORIGIN, '');

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'devias-assets-api-'));
    server = await createTestServer({ filesDir: folder, env: { FILE_MAX_BYTES: '2000' } });
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    cookie = alice.cookie;
    api = client(server, { cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme', 'acme')).id}`;
    otherBase = `/api/workspaces/${(await createWorkspace(api, 'Other', 'other')).id}`;
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('stores an upload and reads its details back', async () => {
    const response = await upload('logo.png', PNG);
    const asset = response.json as unknown as Asset;

    expect(response.status).toBe(201);
    expect(asset).toMatchObject({ name: 'logo.png', contentType: 'image/png', size: PNG.byteLength, version: 1 });
    expect(asset.url).toMatch(new RegExp(`^${ORIGIN}/files/${asset.id}\\?exp=\\d+&sig=`));

    const read = await api(`${base}/assets/${asset.id}`);
    expect(read.status).toBe(200);
    expect(read.json).toEqual(asset);
    const page = (await api(`${base}/assets?search=logo`)).json as AssetPage;
    expect(page.items.map((item) => item.id)).toEqual([asset.id]);
    expect(page.total).toBe(1);
  });

  it('refuses a file over the limit and keeps nothing', async () => {
    const before = ((await api(`${base}/assets`)).json as AssetPage).total;
    const declared = await upload('big.bin', new Uint8Array(5000));
    expect(declared.status).toBe(400);
    expect(declared.json).toMatchObject({ error: { code: 'VALIDATION', message: expect.stringMatching(/at most/) } });

    // A body that does not say how long it is, counted as it streams.
    const streamed = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(900));
      },
    });
    const response = await server.app.request(`${base}/assets?name=endless.bin`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: streamed,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(400);
    expect(((await api(`${base}/assets`)).json as AssetPage).total).toBe(before);
  });

  it('asks for a name', async () => {
    const response = await server.app.request(`${base}/assets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: PNG,
    });
    expect(response.status).toBe(400);
  });

  it('detects the type from the bytes, whatever the name or the header says', async () => {
    const disguised = await upload('setup.exe', new TextEncoder().encode('MZ not a picture'), {
      headers: { 'content-type': 'image/png' },
    });
    expect(disguised.json).toMatchObject({ contentType: 'application/octet-stream' });
    const picture = await upload('photo.exe', PNG, { headers: { 'content-type': 'application/zip' } });
    expect(picture.json).toMatchObject({ contentType: 'image/png' });
  });

  it('shows pictures and PDFs in place and offers everything else as a download', async () => {
    const png = await stored('shown.png');
    const pdf = await stored('doc.pdf', PDF);
    const svg = await stored('vector.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const html = await stored('page.html', new TextEncoder().encode('<script>alert(1)</script>'));
    const tricky = await stored('évil"\r\n.png');

    const inline = await get(`${pathOf(png.url)}`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get('content-type')).toBe('image/png');
    expect(inline.headers.get('content-disposition')).toBe(`inline; filename="shown.png"; filename*=UTF-8''shown.png`);
    expect(inline.headers.get('x-content-type-options')).toBe('nosniff');
    expect(inline.headers.get('content-security-policy')).toContain('sandbox');
    expect(inline.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
    expect(inline.headers.get('accept-ranges')).toBe('bytes');
    expect(inline.headers.get('content-length')).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(PNG);

    const pdfResponse = await get(`${pathOf(pdf.url)}`);
    expect(pdfResponse.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(pdfResponse.headers.get('content-security-policy')).not.toContain('sandbox');
    expect(pdfResponse.headers.get('x-content-type-options')).toBe('nosniff');

    for (const asset of [svg, html]) {
      const response = await get(`${pathOf(asset.url)}`);
      expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
    }

    expect((await get(`${pathOf(png.url)}&download=true`)).headers.get('content-disposition')).toMatch(/^attachment;/);
    // The name cannot end the header.
    const header = (await get(`${pathOf(tricky.url)}`)).headers.get('content-disposition') ?? '';
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename*=UTF-8');
  });

  it('answers a repeat request with 304 and a range with the part asked for', async () => {
    const asset = await stored('ranged.png');
    const first = await get(`${pathOf(asset.url)}`);
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toBe(`"${asset.checksum}"`);

    const again = await get(`${pathOf(asset.url)}`, { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect((await get(`${pathOf(asset.url)}`, { 'if-none-match': '"other"' })).status).toBe(200);

    const part = await get(`${pathOf(asset.url)}`, { range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${PNG.byteLength}`);
    expect(part.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(PNG.slice(2, 6));

    const tail = await get(`${pathOf(asset.url)}`, { range: 'bytes=-4' });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(PNG.slice(-4));
    const open = await get(`${pathOf(asset.url)}`, { range: `bytes=${PNG.byteLength - 2}-` });
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(PNG.slice(-2));
    const beyond = await get(`${pathOf(asset.url)}`, { range: 'bytes=999-' });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${PNG.byteLength}`);
  });

  it('opens a file with its signed link, no credentials, and lets the browser keep it', async () => {
    const asset = await stored('signed.png');
    const response = await get(pathOf(asset.url), {}, anonymous);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
    expect(Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1])).toBeGreaterThan(86_000);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    // The same link all day: asking again gives the same address.
    expect(((await api(`${base}/assets/${asset.id}`)).json as Asset).url).toBe(asset.url);
    expect((await get(pathOf(asset.url), { 'if-none-match': `"${asset.checksum}"` }, anonymous)).status).toBe(304);
    expect((await get(`${pathOf(asset.url)}&download=true`, {}, anonymous)).headers.get('content-disposition')).toMatch(
      /^attachment;/,
    );
  });

  it('refuses a link that was changed, belongs to another file or has expired', async () => {
    const asset = await stored('guarded.png');
    const other = await stored('other.png');
    const url = new URL(asset.url);
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';

    expect((await get(`/files/${asset.id}?exp=${exp}&sig=${sig.slice(0, -2)}AA`, {}, anonymous)).status).toBe(403);
    expect((await get(`/files/${asset.id}?exp=${Number(exp) + 60}&sig=${sig}`, {}, anonymous)).status).toBe(403);
    expect((await get(`/files/${other.id}?exp=${exp}&sig=${sig}`, {}, anonymous)).status).toBe(403);
    expect((await get(`/files/${asset.id}`, {}, anonymous)).status).toBe(403);
    expect((await get(`/files/${asset.id}?exp=1&sig=x`, {}, anonymous)).status).toBe(403);

    // Three days later neither the page's link nor a short one works.
    const shortLink = pathOf(
      ((await api(`${base}/assets/${asset.id}/link`, { body: { ttlSeconds: 60 } })).json as { url: string }).url,
    );
    expect((await get(shortLink, {}, anonymous)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect((await get(pathOf(asset.url), {}, anonymous)).status).toBe(403);
    expect((await get(shortLink, {}, anonymous)).status).toBe(403);
  });

  it('makes a link for sharing, within the limits', async () => {
    const asset = await stored('shared.png');
    const made = await api(`${base}/assets/${asset.id}/link`, { body: { ttlSeconds: 3600 } });
    expect(made.status).toBe(201);
    const { url, expiresAt } = made.json as { url: string; expiresAt: string };
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(3_500_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
    expect((await get(pathOf(url), {}, anonymous)).status).toBe(200);
    expect((await api(`${base}/assets/${asset.id}/link`, { body: { ttlSeconds: 5 } })).status).toBe(400);
    expect((await api(`${base}/assets/${asset.id}/link`, { body: { ttlSeconds: 99_999_999 } })).status).toBe(400);
    expect((await api(`${base}/assets/${asset.id}/link`, { body: {} })).status).toBe(201);
  });

  it('renames and describes a file, and refuses a stale change', async () => {
    const asset = await stored('draft.png');
    const changed = await api(`${base}/assets/${asset.id}`, {
      method: 'PATCH',
      body: { name: 'final.png', description: 'The final logo' },
    });
    expect(changed.status).toBe(200);
    expect(changed.json).toMatchObject({ name: 'final.png', description: 'The final logo', version: 2 });
    const stale = await api(`${base}/assets/${asset.id}`, {
      method: 'PATCH',
      body: { name: 'x.png', expectedVersion: 1 },
    });
    expect(stale.status).toBe(409);
    expect((await api(`${base}/assets/${asset.id}`, { method: 'PATCH', body: {} })).status).toBe(400);
  });

  it('deletes a file for good: its link and its content stop working', async () => {
    const asset = await stored('doomed.png');
    expect((await get(pathOf(asset.url), {}, anonymous)).status).toBe(200);

    expect((await api(`${base}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(204);

    expect((await get(pathOf(asset.url), {}, anonymous)).status).toBe(404);
    expect((await api(`${base}/assets/${asset.id}`)).status).toBe(404);
    expect((await api(`${base}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(`${base}/assets/${asset.id}?force=true`, { method: 'DELETE' })).status).toBe(404);
  });

  it('reports where a file is used and what the workspace stores', async () => {
    const asset = await stored('counted.png');

    expect((await api(`${base}/assets/${asset.id}/usage`)).json).toEqual({ records: [], mentions: [], total: 0 });
    const usage = (await api(`${base}/asset-usage`)).json as AssetsUsage;
    expect(usage.count).toBeGreaterThan(0);
    expect(usage.bytes).toBeGreaterThanOrEqual(PNG.byteLength);
    expect(usage.quotaBytes).toBeNull();
  });

  it('says where a file is used, refuses to delete it meanwhile, and deletes it anyway when told to', async () => {
    const asset = await stored('used.png');
    const doc = (
      await api(`${base}/documents`, { body: { title: 'Brand', markdown: `Our [logo](asset:${asset.id}).` } })
    ).json as { id: string };
    const task = (await api(`${base}/tasks`, { body: { title: 'Update it', about: [`asset:${asset.id}`] } })).json as {
      id: string;
    };

    expect((await api(`${base}/assets/${asset.id}/usage`)).json).toEqual({
      records: [],
      mentions: [
        { kind: 'document', id: doc.id, role: 'mention' },
        { kind: 'task', id: task.id, role: 'about' },
      ],
      total: 2,
    });
    expect(
      ((await api(`${base}/documents?mentions=asset:${asset.id}`)).json as { items: unknown[] }).items,
    ).toHaveLength(1);

    const refused = await api(`${base}/assets/${asset.id}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: { code: 'CONFLICT', details: { usage: { total: 2 } } } });
    expect((await api(`${base}/assets/${asset.id}`)).status).toBe(200);

    expect((await api(`${base}/assets/${asset.id}?force=true`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`${base}/assets/${asset.id}`)).status).toBe(404);
  });

  it('keeps every workspace to its own files', async () => {
    const asset = await stored('private.png');

    expect((await api(`${otherBase}/assets/${asset.id}`)).status).toBe(404);
    expect((await api(`${otherBase}/assets/${asset.id}`, { method: 'PATCH', body: { name: 'x.png' } })).status).toBe(
      404,
    );
    expect((await api(`${otherBase}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(((await api(`${otherBase}/assets`)).json as AssetPage).total).toBe(0);
  });

  it('needs the asset area of an api key, and a caller of any kind', async () => {
    const asset = await stored('keyed.png');
    const key = async (permissions: Record<string, string[]>) =>
      ((await api(`${base}/api-keys`, { body: { name: 'k', permissions } })).json as { key: string }).key;
    const records = await key({ record: ['read', 'write'] });
    const reader = await key({ asset: ['read'] });
    const writer = await key({ asset: ['read', 'write'] });

    expect((await client(server, { apiKey: records })(`${base}/assets`)).status).toBe(403);
    expect((await client(server, { apiKey: reader })(`${base}/assets`)).status).toBe(200);
    expect((await client(server, { apiKey: reader })(`${base}/assets/${asset.id}`)).status).toBe(200);
    // A key reads a file the way everyone does: the asset it may read carries the link.
    const readable = (await client(server, { apiKey: reader })(`${base}/assets/${asset.id}`)).json as Asset;
    const content = await get(pathOf(readable.url), {}, anonymous);
    expect(content.status).toBe(200);
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PNG);
    expect((await upload('k.png', PNG, { auth: { apiKey: records } })).status).toBe(403);
    expect((await upload('k.png', PNG, { auth: { apiKey: reader } })).status).toBe(403);
    const made = await upload('k.png', PNG, { auth: { apiKey: writer } });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ createdBy: { kind: 'api_key' } });
    expect((await client(server, { apiKey: reader })(`${base}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(
      403,
    );
    expect((await upload('anon.png', PNG, { auth: anonymous })).status).toBe(401);
  });

  it('opens a public file by its plain link, kept for good, and a private one only by a signed link', async () => {
    const workspaceId = base.split('/').pop() ?? '';
    const actor = { kind: 'user', id: 'someone' } as const;
    const written = await server.engine.files.write({ workspaceId, actor }, { name: 'brand.png', body: PNG });
    await server.engine.db.transaction(async (tx) =>
      server.engine.files.add(tx, written, { kind: 'logo' }, actor, new Date()),
    );
    const plain = `/files/${written.id}`;

    const open = await get(plain, {}, anonymous);
    expect(open.status).toBe(200);
    expect(open.headers.get('content-type')).toBe('image/png');
    expect(open.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(open.headers.get('x-content-type-options')).toBe('nosniff');
    expect(open.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(PNG);
    expect((await get(plain, { 'if-none-match': `"${written.checksum}"` }, anonymous)).status).toBe(304);
    // It is not an asset: the library never shows it.
    expect(((await api(`${base}/assets?search=brand`)).json as AssetPage).total).toBe(0);

    // A private asset has no plain link.
    const asset = await stored('private.png');
    expect((await get(`/files/${asset.id}`, {}, anonymous)).status).toBe(403);
    expect((await get(pathOf(asset.url), {}, anonymous)).status).toBe(200);
  });

  it('exposes the headers a download needs to other origins', async () => {
    const asset = await stored('cors.png');
    const response = await get(`${pathOf(asset.url)}`, { origin: 'http://localhost:5173' });
    const exposed = response.headers.get('access-control-expose-headers') ?? '';

    for (const header of ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Disposition']) {
      expect(exposed).toContain(header);
    }
  });

  it('is in the OpenAPI document', async () => {
    const document = (await (await server.app.request('/api/openapi.json')).json()) as {
      paths: Record<string, Record<string, { requestBody?: { content: Record<string, unknown> } }>>;
    };

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/workspaces/{workspaceId}/assets',
        '/api/workspaces/{workspaceId}/assets/{id}',
        '/api/workspaces/{workspaceId}/assets/{id}/link',
        '/api/workspaces/{workspaceId}/assets/{id}/usage',
        '/api/workspaces/{workspaceId}/asset-usage',
        '/files/{id}',
      ]),
    );
    expect(
      Object.keys(document.paths['/api/workspaces/{workspaceId}/assets']?.post?.requestBody?.content ?? {}),
    ).toEqual(['application/octet-stream']);
  });
});
