import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, signUp } from './helpers';

const ORIGIN = 'http://localhost:3000';

describe('a person’s picture', () => {
  let server: Server;
  let folder: string;
  let ana: string;
  let anaId: string;
  let bob: string;
  let png: Uint8Array;

  const upload = (cookie: string, name: string, body: Uint8Array | string) =>
    server.app.request(`/api/me/avatar?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body,
    });
  const imageOf = async (cookie: string) =>
    ((await client(server, { cookie })('/api/me')).json as { user: { image: string | null } }).user.image;
  const get = (url: string) => server.app.request(url.replace(ORIGIN, ''));
  const stored = () =>
    readdirSync(folder, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('/original'));
  const solid = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } } });

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'devias-avatar-'));
    server = await createTestServer({ filesDir: folder });
    const a = await signUp(server, 'ana@example.com', 'Ana');
    ana = a.cookie;
    anaId = a.userId;
    bob = (await signUp(server, 'bob@example.com', 'Bob')).cookie;
    png = new Uint8Array(await solid(600, 300).png().toBuffer());
  });
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('is stored as a public file that anyone can open, and is the account’s image', async () => {
    const response = await upload(ana, 'me.png', png);
    const { image } = (await response.json()) as { image: string };

    expect(response.status).toBe(200);
    expect(image).toMatch(new RegExp(`^${ORIGIN}/files/[0-9a-f-]{36}\\?w=256&fit=cover$`));
    expect(await imageOf(ana)).toBe(image);

    // No session and no signature: the picture of someone is for everyone who sees them.
    const plain = await get(image.split('?')[0] as string);
    expect(plain.status).toBe(200);
    expect(plain.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await plain.arrayBuffer())).toEqual(png);

    // And what the account holds is the square thumbnail of it.
    const square = await get(image);
    expect(square.headers.get('content-type')).toBe('image/webp');
    expect(await sharp(new Uint8Array(await square.arrayBuffer())).metadata()).toMatchObject({
      width: 256,
      height: 256,
    });
    // The picture shows in no library.
    const workspace = await createWorkspace(client(server, { cookie: ana }), 'Acme', 'acme');
    expect(
      ((await client(server, { cookie: ana })(`/api/workspaces/${workspace.id}/assets`)).json as { total: number })
        .total,
    ).toBe(0);
  });

  it('replaces the last one, which is deleted', async () => {
    const before = (await imageOf(ana)) as string;
    const next = (await (
      await upload(ana, 'new.png', new Uint8Array(await solid(100, 100).png().toBuffer()))
    ).json()) as {
      image: string;
    };

    expect(next.image).not.toBe(before);
    expect(await imageOf(ana)).toBe(next.image);
    expect((await get(before.split('?')[0] as string)).status).toBe(404);
    expect((await get(next.image.split('?')[0] as string)).status).toBe(200);
    expect(stored()).toHaveLength(1);
  });

  it('refuses what is not a raster picture, or is too big, and keeps what it had', async () => {
    const before = await imageOf(ana);
    const kept = stored();
    const refusals = [
      await upload(ana, 'notes.txt', 'just text'),
      await upload(ana, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
      await upload(ana, 'setup.png', 'MZ not a picture'),
      await upload(ana, 'big.png', new Uint8Array(5 * 1024 * 1024 + 1)),
    ];

    for (const response of refusals) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }

    expect(await imageOf(ana)).toBe(before);
    expect(stored()).toEqual(kept);
  });

  it('is removed with its file, and only people have one', async () => {
    const image = (await imageOf(ana)) as string;

    const removed = await server.app.request('/api/me/avatar', { method: 'DELETE', headers: { cookie: ana } });
    expect(removed.status).toBe(204);
    expect(await imageOf(ana)).toBeNull();
    expect((await get(image.split('?')[0] as string)).status).toBe(404);
    expect(stored()).toHaveLength(0);
    // Again is fine.
    expect((await server.app.request('/api/me/avatar', { method: 'DELETE', headers: { cookie: ana } })).status).toBe(
      204,
    );

    expect((await server.app.request('/api/me/avatar?name=a.png', { method: 'POST', body: png })).status).toBe(401);
    const key = (
      (await client(server, { cookie: ana })('/api/workspaces', { body: { name: 'Keys', slug: 'keys' } })).json as {
        id: string;
      }
    ).id;
    const made = (
      (await client(server, { cookie: ana })(`/api/workspaces/${key}/api-keys`, { body: { name: 'k' } })).json as {
        key: string;
      }
    ).key;
    const viaKey = await server.app.request('/api/me/avatar?name=a.png', {
      method: 'POST',
      headers: { 'x-api-key': made },
      body: png,
    });
    expect(viaKey.status).toBe(403);
  });

  it('never deletes a file that is someone else’s, even when the account names it', async () => {
    const hers = (await (await upload(ana, 'hers.png', png)).json()) as { image: string };
    // Bob puts Ana's link on his own account, then sets and removes a picture of his own.
    await server.auth.api.updateUser({ headers: new Headers({ cookie: bob }), body: { image: hers.image } });
    expect((await upload(bob, 'his.png', png)).status).toBe(200);
    expect((await get(hers.image.split('?')[0] as string)).status).toBe(200);

    await server.auth.api.updateUser({ headers: new Headers({ cookie: bob }), body: { image: hers.image } });
    expect((await server.app.request('/api/me/avatar', { method: 'DELETE', headers: { cookie: bob } })).status).toBe(
      204,
    );
    expect((await get(hers.image.split('?')[0] as string)).status).toBe(200);
    expect(await imageOf(ana)).toBe(hers.image);
    void anaId;
  });

  it('is in the OpenAPI document', async () => {
    const document = (await (await server.app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };

    expect(Object.keys(document.paths)).toContain('/api/me/avatar');
  });
});
