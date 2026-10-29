import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Asset } from '@devias/core';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, signUp } from './helpers';

const ORIGIN = 'http://localhost:3000';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 220 } } });

/** The files kept under `v/`: the variants. */
const variantsIn = (folder: string): string[] =>
  readdirSync(folder, { recursive: true })
    .map(String)
    .filter((path) => path.includes('/v/'));

describe('pictures: sizes and thumbnails', () => {
  let server: Server;
  let folder: string;
  let cookie: string;
  let base: string;
  let png: Uint8Array;

  const upload = async (name: string, body: Uint8Array | string, to = base, auth = cookie) => {
    const response = await server.app.request(`${to}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { cookie: auth, 'content-type': 'application/octet-stream' },
      body,
    });

    expect(response.status).toBe(201);

    return (await response.json()) as Asset;
  };
  const get = (url: string, headers: Record<string, string> = {}) =>
    server.app.request(url.replace(ORIGIN, ''), { headers });
  const dimensions = async (response: Response) => {
    const meta = await sharp(new Uint8Array(await response.arrayBuffer())).metadata();

    return { width: meta.width, height: meta.height, format: meta.format };
  };

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'devias-images-'));
    server = await createTestServer({ filesDir: folder });
    cookie = (await signUp(server, 'alice@example.com', 'Alice')).cookie;
    base = `/api/workspaces/${(await createWorkspace(client(server, { cookie }), 'Acme', 'acme')).id}`;
    png = new Uint8Array(await solid(600, 300).png().toBuffer());
  });
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('knows the size of a picture from the moment it is stored', async () => {
    const turned = new Uint8Array(await solid(100, 50).withMetadata({ orientation: 6 }).jpeg().toBuffer());

    expect(await upload('wide.png', png)).toMatchObject({ contentType: 'image/png', width: 600, height: 300 });
    // As it is shown: the orientation turns it a quarter.
    expect(await upload('phone.jpg', turned)).toMatchObject({ contentType: 'image/jpeg', width: 50, height: 100 });
    expect(await upload('notes.txt', 'text')).toMatchObject({ width: null, height: null });
    expect(
      await upload('broken.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toMatchObject({
      contentType: 'image/png',
      width: null,
    });
  });

  it('serves a small WebP made on the first request and kept for the next', async () => {
    const asset = await upload('photo.png', png);
    const before = variantsIn(folder).length;

    const first = await get(`${asset.url}&w=256`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/webp');
    expect(first.headers.get('content-disposition')).toBe(`inline; filename="photo.webp"; filename*=UTF-8''photo.webp`);
    expect(first.headers.get('etag')).toBe(`"${asset.checksum}-w256-inside"`);
    expect(first.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 256, height: 128 });
    expect(bytes.byteLength).toBeLessThan(png.byteLength);
    expect(variantsIn(folder)).toHaveLength(before + 1);

    // The same request again is read from where it was kept, byte for byte.
    const again = new Uint8Array(await (await get(`${asset.url}&w=256`)).arrayBuffer());
    expect(again).toEqual(bytes);
    expect(variantsIn(folder)).toHaveLength(before + 1);

    // The original is untouched and has its own tag.
    const original = await get(asset.url);
    expect(original.headers.get('etag')).toBe(`"${asset.checksum}"`);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(png);
  });

  it('answers a browser that has the variant with 304, and gives ranges of it', async () => {
    const asset = await upload('ranged.png', png);
    const first = await get(`${asset.url}&w=128`);
    const tag = first.headers.get('etag') ?? '';

    const again = await get(`${asset.url}&w=128`, { 'if-none-match': tag });
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(tag);
    // The original's tag does not stand for the variant.
    expect((await get(`${asset.url}&w=128`, { 'if-none-match': `"${asset.checksum}"` })).status).toBe(200);

    const part = await get(`${asset.url}&w=128`, { range: 'bytes=0-3' });
    expect(part.status).toBe(206);
    expect(new TextDecoder().decode(new Uint8Array(await part.arrayBuffer()).slice(0, 4))).toBe('RIFF');
  });

  it('fits a picture inside the square, or fills it with cover', async () => {
    const asset = await upload('square.png', new Uint8Array(await solid(300, 600).png().toBuffer()));

    expect(await dimensions(await get(`${asset.url}&w=128`))).toEqual({ width: 64, height: 128, format: 'webp' });
    expect(await dimensions(await get(`${asset.url}&w=128&fit=inside`))).toEqual({
      width: 64,
      height: 128,
      format: 'webp',
    });
    expect(await dimensions(await get(`${asset.url}&w=128&fit=cover`))).toEqual({
      width: 128,
      height: 128,
      format: 'webp',
    });
    // It never enlarges what is already small, unless asked to fill the square.
    const small = await upload('small.png', new Uint8Array(await solid(40, 20).png().toBuffer()));
    expect((await dimensions(await get(`${small.url}&w=256`))).width).toBe(40);
    expect(await dimensions(await get(`${small.url}&w=256&fit=cover`))).toMatchObject({ width: 256, height: 256 });
  });

  it('refuses a width that is not on the list and a fit that does not exist', async () => {
    const asset = await upload('guarded.png', png);

    for (const query of ['w=300', 'w=0', 'w=-64', 'w=abc', 'w=256.5', 'w=256&fit=stretch', 'w=999999']) {
      const response = await get(`${asset.url}&${query}`);

      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }

    // Every width on the list works.
    for (const w of [64, 128, 256, 512, 1024, 2048]) {
      expect((await get(`${asset.url}&w=${w}`)).status, String(w)).toBe(200);
    }

    expect(variantsIn(folder).filter((path) => path.includes(asset.id))).toHaveLength(6);
  });

  it('serves the original of what cannot be resized: animated, vector, text, unreadable', async () => {
    const frame = (r: number) => solid(20, 10).tint({ r, g: 0, b: 0 }).png().toBuffer();
    const gif = new Uint8Array(
      await sharp(await Promise.all([frame(255), frame(0)]), { join: { animated: true } })
        .gif()
        .toBuffer(),
    );
    const files = {
      'moving.gif': gif,
      'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      'notes.txt': 'hello',
      'broken.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    };

    for (const [name, body] of Object.entries(files)) {
      const asset = await upload(name, body);
      const response = await get(`${asset.url}&w=64&fit=cover`);

      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type'), name).not.toBe('image/webp');
      expect(response.headers.get('etag'), name).toBe(`"${asset.checksum}"`);
      expect(new Uint8Array(await response.arrayBuffer()), name).toEqual(
        typeof body === 'string' ? new TextEncoder().encode(body) : body,
      );
    }
  });

  it('downloads a variant as a WebP file', async () => {
    const asset = await upload('mine.png', png);

    const download = await get(`${asset.url}&w=64&fit=cover&download=true`);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="mine\.webp"/);
    expect(await dimensions(download)).toEqual({ width: 64, height: 64, format: 'webp' });
  });

  it('removes the variants with the asset', async () => {
    const asset = await upload('doomed.png', png);
    await get(`${asset.url}&w=64`);
    await get(`${asset.url}&w=128&fit=cover`);
    expect(variantsIn(folder).filter((path) => path.includes(asset.id))).toHaveLength(2);

    expect((await client(server, { cookie })(`${base}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(204);

    expect(variantsIn(folder).filter((path) => path.includes(asset.id))).toHaveLength(0);
    expect((await get(`${asset.url}&w=64`)).status).toBe(404);
  });
});

describe('pictures without the image library', () => {
  let server: Server;
  let folder: string;

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'devias-no-images-'));
    server = await createTestServer({ filesDir: folder, imageProcessor: null });
  });
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('starts, stores pictures with no size and serves the original whatever size is asked for', async () => {
    const cookie = (await signUp(server, 'bob@example.com', 'Bob')).cookie;
    const base = `/api/workspaces/${(await createWorkspace(client(server, { cookie }), 'Acme', 'acme')).id}`;
    const png = new Uint8Array(await solid(600, 300).png().toBuffer());
    const response = await server.app.request(`${base}/assets?name=photo.png`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: png,
    });
    const asset = (await response.json()) as Asset;

    expect(response.status).toBe(201);
    expect(asset).toMatchObject({ contentType: 'image/png', width: null, height: null });

    for (const query of ['', '&w=256', '&w=256&fit=cover']) {
      const served = await server.app.request(asset.url.replace(ORIGIN, '') + query);

      expect(served.status, query).toBe(200);
      expect(served.headers.get('content-type'), query).toBe('image/png');
      expect(served.headers.get('etag'), query).toBe(`"${asset.checksum}"`);
      expect(new Uint8Array(await served.arrayBuffer()), query).toEqual(png);
    }

    expect(
      readdirSync(folder, { recursive: true })
        .map(String)
        .filter((path) => path.includes('/v/')),
    ).toEqual([]);
  });
});
