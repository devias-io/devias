import type { WorkspaceEvent } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient } from '../src/mock';

const mock = () => createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mock assets', () => {
  it('stores, reads, changes and removes files like the server, and tells the feed', async () => {
    const client = mock();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const progress: number[] = [];
    const asset = await client.assets.upload(
      { name: 'dir/logo.png', description: 'Our logo', body: PNG },
      { onProgress: ({ loaded }) => progress.push(loaded) },
    );

    expect(asset).toMatchObject({
      name: 'logo.png',
      description: 'Our logo',
      contentType: 'image/png',
      size: PNG.byteLength,
      version: 1,
      createdBy: { kind: 'user' },
    });
    expect(asset.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.url).toMatch(/^data:image\/png;base64,/);
    expect(progress).toEqual([0, PNG.byteLength]);
    expect(await client.assets.get(asset.id)).toEqual(asset);

    const renamed = await client.assets.update(asset.id, { name: 'brand.png' });
    expect(renamed).toMatchObject({ name: 'brand.png', version: 2, checksum: asset.checksum });
    expect((await failure(client.assets.update(asset.id, { name: 'x.png', expectedVersion: 1 }))).code).toBe(
      'CONFLICT',
    );
    expect((await failure(client.assets.update(asset.id, {}))).code).toBe('VALIDATION');

    await client.assets.delete(asset.id);
    expect((await failure(client.assets.get(asset.id))).code).toBe('NOT_FOUND');
    expect((await failure(client.assets.delete(asset.id))).code).toBe('NOT_FOUND');
    expect((await client.assets.list()).total).toBe(0);

    await flush();
    expect(
      events.filter((event) => event.type === 'asset.changed').map((event) => (event as { change: string }).change),
    ).toEqual(['created', 'updated', 'deleted']);
  });

  it('detects the type from the bytes and accepts text, bytes and blobs', async () => {
    const client = mock();
    const disguised = await client.assets.upload({ name: 'setup.png', body: 'MZ not a picture' });
    const text = await client.assets.upload({ name: 'notes.txt', body: 'Quarterly notes' });
    const blob = await client.assets.upload({ name: 'blob.png', body: new Blob([PNG]) });
    const buffer = await client.assets.upload({ name: 'buffer.png', body: PNG.buffer.slice(0) as ArrayBuffer });

    expect(disguised.contentType).toBe('application/octet-stream');
    expect(text.contentType).toBe('text/plain');
    expect([blob.contentType, buffer.contentType]).toEqual(['image/png', 'image/png']);
    expect([blob.size, buffer.size]).toEqual([PNG.byteLength, PNG.byteLength]);
  });

  it('refuses a file over the limit and a bad name', async () => {
    const client = mock();

    expect(
      (await failure(client.assets.upload({ name: 'big.bin', body: new Uint8Array(26 * 1024 * 1024) }))).code,
    ).toBe('VALIDATION');
    expect((await failure(client.assets.upload({ name: '  ', body: 'x' }))).code).toBe('VALIDATION');
    expect((await client.assets.list()).total).toBe(0);
  });

  it('lists newest first with the server’s filters and paging', async () => {
    let tick = 0;
    const client = createMockClient({
      workspaceId: 'ws_test',
      manifests: [fixture],
      now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, tick++)).toISOString(),
    });
    const report = await client.assets.upload({
      name: 'Q3 report.txt',
      description: 'Revenue numbers',
      body: 'figures',
    });
    const photo = await client.assets.upload({ name: 'Team photo.png', body: PNG });
    const pdf = await client.assets.upload({ name: 'invoice.pdf', body: '%PDF-1.4 x' });
    const names = async (query = {}) => (await client.assets.list(query)).items.map((item) => item.name);

    expect(await names()).toEqual(['invoice.pdf', 'Team photo.png', 'Q3 report.txt']);
    expect(await names({ search: 'revenue' })).toEqual(['Q3 report.txt']);
    // Only the name and the description are searched, not what is inside.
    expect(await names({ search: 'figures' })).toEqual([]);
    expect(await names({ type: 'image' })).toEqual(['Team photo.png']);
    expect(await names({ type: 'pdf' })).toEqual(['invoice.pdf']);
    expect(await names({ type: 'text' })).toEqual(['Q3 report.txt']);
    expect(await names({ type: 'other' })).toEqual([]);
    expect(await names({ ids: `${report.id},${pdf.id}` })).toEqual(['invoice.pdf', 'Q3 report.txt']);
    expect(await names({ createdBy: 'user_dev' })).toHaveLength(3);
    expect(await names({ createdBy: 'user:someone' })).toEqual([]);

    const first = await client.assets.list({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([pdf.id, photo.id]);
    expect(first.total).toBe(3);
    const second = await client.assets.list({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((item) => item.id)).toEqual([report.id]);
    expect(second.nextCursor).toBeNull();
    expect((await failure(client.assets.list({ cursor: 'garbage' }))).code).toBe('INVALID_CURSOR');
  });

  it('makes links, says where a file is used and what the workspace stores', async () => {
    const client = mock();
    const asset = await client.assets.upload({ name: 'a.png', body: PNG });
    await client.assets.upload({ name: 'b.txt', body: 'text' });

    const link = await client.assets.link(asset.id, { ttlSeconds: 3600 });
    expect(link.url).toBe(asset.url);
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now() + 3_500_000);
    expect((await failure(client.assets.link(asset.id, { ttlSeconds: 5 }))).code).toBe('VALIDATION');
    expect(await client.assets.usage(asset.id)).toEqual({ records: [], mentions: [], total: 0 });
    expect(await client.assets.workspaceUsage()).toEqual({ count: 2, bytes: PNG.byteLength + 4, quotaBytes: null });
  });

  it('says where an asset is used and refuses to delete it meanwhile, like the server', async () => {
    const client = mock();
    const asset = await client.assets.upload({ name: 'logo.png', body: PNG });
    const link = `asset:${asset.id}`;
    const doc = await client.documents.create({ title: 'Brand', markdown: `Our [logo](${link}).` });
    const about = await client.tasks.create({ title: 'Update the logo', about: [link] });

    const usage = await client.assets.usage(asset.id);
    expect(usage.total).toBe(2);
    expect(usage.mentions).toEqual([
      { kind: 'document', id: doc.id, role: 'mention' },
      { kind: 'task', id: about.id, role: 'about' },
    ]);
    expect((await failure(client.assets.delete(asset.id))).code).toBe('CONFLICT');
    expect((await client.assets.get(asset.id)).id).toBe(asset.id);

    await client.documents.delete(doc.id);
    expect((await client.assets.usage(asset.id)).total).toBe(1);
    await client.assets.delete(asset.id, { force: true });
    expect((await failure(client.assets.get(asset.id))).code).toBe('NOT_FOUND');
  });
});
