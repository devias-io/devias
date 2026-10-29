import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDataEngine,
  createFileUrlSigner,
  createLocalFileStore,
  type DataEngine,
  type EngineContext,
  EngineError,
  type FileStore,
  readEventsAfter,
  silentLogger,
} from '../src';
import { createTestDb, type TestDb } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const sha256 = async (bytes: Uint8Array): Promise<string> => createHash('sha256').update(bytes).digest('hex');
const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

/** Where the store keeps an asset's bytes: an asset is a file, so its id is the file's. */
const keyOf = (workspaceId: string, asset: { id: string }): string =>
  `${workspaceId}/${asset.id.slice(-2)}/${asset.id}/original`;

const keysOf = async (store: FileStore, prefix = ''): Promise<string[]> => {
  const keys: string[] = [];

  for await (const object of store.list(prefix)) {
    keys.push(object.key);
  }

  return keys.sort();
};

describe('assets on PGlite', () => {
  let testDb: TestDb;
  let root: string;
  let store: FileStore;
  let engine: DataEngine;
  let now = new Date('2026-10-29T10:00:00Z');
  const ws = 'ws_assets';
  const owner: EngineContext = { workspaceId: ws, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };
  const member: EngineContext = { workspaceId: ws, actor: { kind: 'user', id: 'u_member' }, role: 'member' };
  const other: EngineContext = { workspaceId: 'ws_other', actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };
  const keyApi = (permissions: Record<string, string[]>): EngineContext => ({
    workspaceId: ws,
    actor: { kind: 'api_key', id: 'key_1' },
    role: null,
    apiKeyPermissions: permissions,
  });
  const assets = () => engine.assets;
  const make = (ctx: EngineContext, name: string, body: Parameters<DataEngine['assets']['create']>[1]['body']) =>
    assets().create(ctx, { name, body });

  const build = (options: { fileMaxBytes?: number; fileQuotaBytes?: number } = {}) =>
    createDataEngine({
      db: testDb.db,
      logger: silentLogger,
      clock: () => now,
      fileStore: store,
      fileUrls: createFileUrlSigner({ secret: 'test-secret', clock: () => now }),
      fileSweepGraceMs: 60 * 60 * 1000,
      ...options,
    });

  beforeAll(async () => {
    testDb = await createTestDb();
    root = await mkdtemp(join(tmpdir(), 'devias-assets-test-'));
    store = createLocalFileStore(root);
    engine = build();
    await engine.workspaces.initialize(ws);
    await engine.workspaces.initialize('ws_other');
  });

  afterAll(async () => {
    await engine.close();
    await testDb.close();
    await rm(root, { recursive: true, force: true });
  });

  it('stores a file and tells the change feed', async () => {
    const before = (await readEventsAfter(testDb.db, ws, 0, 1000)).length;
    const asset = await make(member, 'logo.png', PNG);

    expect(asset).toMatchObject({
      name: 'logo.png',
      description: '',
      contentType: 'image/png',
      size: PNG.byteLength,
      checksum: await sha256(PNG),
      width: null,
      height: null,
      version: 1,
      createdBy: { kind: 'user', id: 'u_member' },
    });
    expect(asset.url).toMatch(new RegExp(`^/files/${asset.id}\\?exp=\\d+&sig=`));
    expect(await keysOf(store, `${ws}`)).toContain(keyOf(ws, asset));

    const events = await readEventsAfter(testDb.db, ws, 0, 1000);
    expect(events.slice(before)).toEqual([
      expect.objectContaining({ type: 'asset.changed', assetId: asset.id, change: 'created' }),
    ]);

    const opened = await assets().open(owner, asset.id);
    expect(opened.file).toMatchObject({
      id: asset.id,
      name: 'logo.png',
      contentType: 'image/png',
      size: PNG.byteLength,
    });
    expect(new Uint8Array(await new Response(await opened.read()).arrayBuffer())).toEqual(PNG);
  });

  it('takes the type from the bytes and cleans the name', async () => {
    const program = await make(owner, '../../tmp/setup.png', 'MZ this is not a picture');
    const text = await make(owner, 'notes.txt', 'Quarterly notes');
    const svg = await make(owner, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const pdf = await make(owner, 'invoice.pdf', '%PDF-1.4\n1 0 obj');
    const binary = await make(owner, 'data.txt', new Uint8Array([0, 1, 2, 255]));

    expect(program).toMatchObject({
      name: 'setup.png',
      contentType: 'application/octet-stream',
    });
    expect(text).toMatchObject({ contentType: 'text/plain' });
    expect(svg.contentType).toBe('image/svg+xml');
    expect(pdf).toMatchObject({ contentType: 'application/pdf' });
    expect(binary.contentType).toBe('application/octet-stream');
  });

  it('streams a file in pieces, as an upload does', async () => {
    const pieces = ['hello ', 'streamed ', 'world'];
    const asset = await make(
      owner,
      'streamed.txt',
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) {
            controller.enqueue(new TextEncoder().encode(piece));
          }

          controller.close();
        },
      }),
    );

    expect(asset.size).toBe(20);
    expect(await textOf(await (await assets().open(owner, asset.id)).read({ start: 6, end: 13 }))).toBe('streamed');
  });

  it('refuses a file over the cap while it streams, and stores nothing', async () => {
    const small = build({ fileMaxBytes: 1000 });
    const before = await keysOf(store);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(400));
      },
    });

    await expect(small.assets.create(owner, { name: 'big.bin', body: endless })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/at most/),
    });
    // It stopped reading as soon as the cap was passed instead of taking the whole body.
    expect(pulled).toBeLessThan(5);
    expect(await keysOf(store)).toEqual(before);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
    expect((await small.assets.list(owner, { search: 'big.bin' })).total).toBe(0);
    await small.close();
  });

  it('removes the bytes when the row cannot be written', async () => {
    const before = await keysOf(store);

    await expect(assets().create(owner, { name: 'x.txt', description: 'd'.repeat(5000), body: 'x' })).rejects.toThrow();
    // Even when it fails after the bytes were written: a closed database.
    const broken = createDataEngine({
      db: { ...testDb.db, transaction: () => Promise.reject(new Error('database down')) } as never,
      logger: silentLogger,
      fileStore: store,
    });
    await expect(broken.assets.create(owner, { name: 'y.txt', body: 'y' })).rejects.toThrow('database down');
    expect(await keysOf(store)).toEqual(before);
  });

  it('keeps a workspace within its quota', async () => {
    const used = (await assets().workspaceUsage(owner)).bytes;
    const limited = build({ fileQuotaBytes: used + 100 });
    expect(await limited.assets.workspaceUsage(owner)).toMatchObject({ bytes: used, quotaBytes: used + 100 });

    const fits = await limited.assets.create(owner, { name: 'fits.txt', body: 'x'.repeat(60) });
    const before = await keysOf(store);
    await expect(limited.assets.create(owner, { name: 'no.txt', body: 'x'.repeat(60) })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/does not fit/),
    });
    expect(await keysOf(store)).toEqual(before);

    // Deleting makes room.
    await limited.assets.delete(owner, fits.id);
    await limited.assets.create(owner, { name: 'now.txt', body: 'x'.repeat(60) });
    await limited.close();
  });

  it('lists newest first, searches, filters and pages', async () => {
    const names = async (query = {}) => (await assets().list(owner, query)).items.map((item) => item.name);
    now = new Date('2026-10-29T11:00:00Z');
    const report = await assets().create(owner, { name: 'Q3 report.txt', description: 'Revenue numbers', body: 'a' });
    now = new Date('2026-10-29T12:00:00Z');
    await assets().create(member, { name: 'Team photo.png', body: PNG });

    expect((await names())[0]).toBe('Team photo.png');
    expect(await names({ search: 'revenue' })).toEqual(['Q3 report.txt']);
    expect(await names({ search: 'photo' })).toEqual(['Team photo.png']);
    expect(await names({ type: 'image' })).toContain('Team photo.png');
    expect(await names({ type: 'image' })).not.toContain('Q3 report.txt');
    expect(await names({ type: 'pdf' })).toEqual(['invoice.pdf']);
    expect(await names({ type: 'text' })).toContain('Q3 report.txt');
    expect(await names({ type: 'other' })).toContain('setup.png');
    expect(await names({ createdBy: 'u_member' })).toContain('Team photo.png');
    expect(await names({ createdBy: 'user:u_member' })).not.toContain('Q3 report.txt');
    expect(await names({ ids: report.id })).toEqual(['Q3 report.txt']);
    // `%` is a character, not a pattern.
    expect(await names({ search: '%' })).toEqual([]);

    const first = await assets().list(owner, { limit: 2 });
    const second = await assets().list(owner, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(first.items).toHaveLength(2);
    expect(second.items.map((item) => item.id)).not.toContain(first.items[0]?.id);
    expect(first.total).toBeGreaterThan(4);
    expect(await codeOf(assets().list(owner, { cursor: 'garbage' }))).toBe('INVALID_CURSOR');
    expect(await codeOf(assets().list(owner, { ids: 'not-a-uuid' }))).toBe('VALIDATION');
  });

  it('renames and describes, refusing a change made from a stale copy', async () => {
    const asset = await make(owner, 'draft.txt', 'v1');
    const renamed = await assets().update(member, asset.id, { name: 'final.txt', description: 'The final one' });

    expect(renamed).toMatchObject({
      name: 'final.txt',
      description: 'The final one',
      version: 2,
      updatedBy: { id: 'u_member' },
    });
    expect(renamed.checksum).toBe(asset.checksum);
    expect(await codeOf(assets().update(owner, asset.id, { name: 'late.txt', expectedVersion: 1 }))).toBe('CONFLICT');
    expect((await assets().update(owner, asset.id, { name: 'ok.txt', expectedVersion: 2 })).version).toBe(3);
    expect(await codeOf(assets().update(owner, asset.id, {}))).toBe('VALIDATION');
    expect(await codeOf(assets().update(owner, asset.id, { name: '  ' }))).toBe('VALIDATION');

    const events = await readEventsAfter(testDb.db, ws, 0, 1000);
    expect(
      events
        .filter((e) => e.type === 'asset.changed' && e.assetId === asset.id)
        .map((e) => (e as { change: string }).change),
    ).toEqual(['created', 'updated', 'updated']);
  });

  it('gives what a record needs to draw its files, removed ones included', async () => {
    const kept = await make(owner, 'kept.png', PNG);
    const gone = await make(owner, 'gone.png', PNG);
    await assets().delete(owner, gone.id);

    const summaries = await assets().summaries(owner, [
      kept.id,
      gone.id,
      '01a173ad-5d3f-7091-8466-4dcdeb689686',
      'nope',
    ]);

    expect(Object.keys(summaries).sort()).toEqual([kept.id, gone.id].sort());
    expect(summaries[kept.id]).toMatchObject({
      name: 'kept.png',
      contentType: 'image/png',
      deleted: false,
      url: kept.url,
    });
    expect(summaries[gone.id]).toMatchObject({ name: 'gone.png', deleted: true, url: '' });
    expect(await assets().summaries(owner, [])).toEqual({});
  });

  it('removes the row first and the bytes after, keeping a tombstone', async () => {
    const asset = await make(owner, 'bye.txt', 'bye');
    const key = keyOf(ws, asset);
    expect(await store.exists(key)).toBe(true);

    await assets().delete(member, asset.id);

    expect(await store.exists(key)).toBe(false);
    expect(await codeOf(assets().get(owner, asset.id))).toBe('NOT_FOUND');
    expect(await codeOf(assets().open(owner, asset.id))).toBe('NOT_FOUND');
    expect(await codeOf(assets().delete(owner, asset.id))).toBe('NOT_FOUND');
    expect((await assets().list(owner, { search: 'bye.txt' })).total).toBe(0);
    const events = await readEventsAfter(testDb.db, ws, 0, 1000);
    expect(events.at(-1)).toMatchObject({ type: 'asset.changed', assetId: asset.id, change: 'deleted' });
  });

  it('keeps every workspace to its own files', async () => {
    const asset = await make(owner, 'mine.txt', 'mine');

    expect(await codeOf(assets().get(other, asset.id))).toBe('NOT_FOUND');
    expect(await codeOf(assets().open(other, asset.id))).toBe('NOT_FOUND');
    expect(await codeOf(assets().update(other, asset.id, { name: 'theirs.txt' }))).toBe('NOT_FOUND');
    expect(await codeOf(assets().delete(other, asset.id))).toBe('NOT_FOUND');
    expect(await codeOf(assets().link(other, asset.id))).toBe('NOT_FOUND');
    expect(await assets().summaries(other, [asset.id])).toEqual({});
    expect((await assets().list(other)).total).toBe(0);
  });

  it('follows the permissions of documents', async () => {
    const asset = await make(owner, 'perm.txt', 'perm');

    expect(await codeOf(assets().list(keyApi({ record: ['read'] })))).toBe('FORBIDDEN');
    expect(await codeOf(assets().list(keyApi({ asset: ['read'] })))).toBe('ok');
    expect(await codeOf(make(keyApi({ asset: ['read'] }), 'k.txt', 'k'))).toBe('FORBIDDEN');
    expect(await codeOf(make(keyApi({ asset: ['read', 'write'] }), 'k.txt', 'k'))).toBe('ok');
    expect(await codeOf(assets().update(keyApi({ asset: ['read'] }), asset.id, { name: 'z.txt' }))).toBe('FORBIDDEN');
    expect(await codeOf(assets().delete(keyApi({ asset: ['read'] }), asset.id))).toBe('FORBIDDEN');
    expect(await codeOf(assets().link(keyApi({ document: ['read'] }), asset.id))).toBe('FORBIDDEN');
    expect(await codeOf(assets().get({ ...owner, role: null }, asset.id))).toBe('FORBIDDEN');
  });

  it('opens a file for a signed link until it expires, and never once it is removed', async () => {
    const asset = await make(owner, 'shared.txt', 'shared text');
    const { url, expiresAt } = await assets().link(member, asset.id, { ttlSeconds: 300 });
    const query = new URL(url, 'http://x').searchParams;
    const exp = query.get('exp') ?? '';
    const sig = query.get('sig') ?? '';
    const fileId = asset.id;
    const files = () => engine.files;

    expect(expiresAt).toBe(new Date(now.getTime() + 300_000).toISOString());
    const opened = await files().openByLink(fileId, exp, sig);
    expect(opened.file).toMatchObject({ id: fileId, workspaceId: ws, name: 'shared.txt' });
    expect(await textOf(await opened.read())).toBe('shared text');
    // The download is called what the asset is called now.
    await assets().update(owner, asset.id, { name: 'renamed.txt' });
    expect((await files().openByLink(fileId, exp, sig)).file.name).toBe('renamed.txt');

    expect(await codeOf(files().openByLink(fileId, exp, `${sig.slice(0, -2)}AA`))).toBe('FORBIDDEN');
    expect(await codeOf(files().openByLink(fileId, String(Number(exp) + 1), sig))).toBe('FORBIDDEN');
    expect(await codeOf(assets().link(owner, asset.id, { ttlSeconds: 5 }))).toBe('VALIDATION');
    expect(await codeOf(assets().link(owner, asset.id, { ttlSeconds: 99_999_999 }))).toBe('VALIDATION');

    const realNow = now;
    now = new Date(realNow.getTime() + 301_000);
    expect(await codeOf(files().openByLink(fileId, exp, sig))).toBe('FORBIDDEN');
    now = realNow;

    await assets().delete(owner, asset.id);
    expect(await codeOf(files().openByLink(fileId, exp, sig))).toBe('NOT_FOUND');
    expect(await codeOf(files().openByLink('not-a-uuid', exp, sig))).toBe('VALIDATION');
  });

  it('counts what a workspace stores', async () => {
    const usage = await assets().workspaceUsage(owner);
    const rows = await assets().list(owner, { limit: 100 });

    expect(usage.count).toBe(rows.total);
    expect(usage.bytes).toBe(rows.items.reduce((sum, item) => sum + item.size, 0));
    expect(usage.quotaBytes).toBeNull();
    expect(await assets().workspaceUsage(other)).toEqual({ count: 0, bytes: 0, quotaBytes: null });
  });

  it('says where an asset is used, refuses to delete it meanwhile, and leaves the words behind when forced', async () => {
    const asset = await make(owner, 'logo.png', PNG);
    expect(await assets().usage(owner, asset.id)).toEqual({ records: [], mentions: [], total: 0 });

    const link = `asset:${asset.id}`;
    const doc = await engine.documents.create(owner, { title: 'Brand', markdown: `Our [logo](${link}) is here.` });
    const about = await engine.tasks.create(owner, { title: 'Update the logo', about: [link] });
    const mentioning = await engine.tasks.create(owner, { title: 'Send it', markdown: `Attach [the logo](${link})` });

    const usage = await assets().usage(owner, asset.id);
    expect(usage.total).toBe(3);
    expect(usage.mentions).toEqual([
      { kind: 'document', id: doc.id, role: 'mention' },
      { kind: 'task', id: about.id, role: 'about' },
      { kind: 'task', id: mentioning.id, role: 'mention' },
    ]);
    // What mentions it is found the way it is for a record, a document or a task.
    expect((await engine.documents.list(owner, { mentions: link })).items.map((item) => item.id)).toEqual([doc.id]);
    expect((await engine.tasks.list(owner, { mentions: link })).items.map((item) => item.id).sort()).toEqual(
      [about.id, mentioning.id].sort(),
    );
    expect(await codeOf(assets().usage(other, asset.id))).toBe('NOT_FOUND');

    // In use: refused, with where.
    await expect(assets().delete(owner, asset.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { usage: { total: 3 } },
    });
    expect((await assets().get(owner, asset.id)).id).toBe(asset.id);

    // A document that goes takes its mention with it.
    await engine.documents.delete(owner, doc.id);
    expect((await assets().usage(owner, asset.id)).total).toBe(2);

    // Forced, it goes and the tasks keep their words, which now read as a file that was removed.
    await assets().delete(owner, asset.id, { force: true });
    expect(await codeOf(assets().get(owner, asset.id))).toBe('NOT_FOUND');
    expect((await assets().summaries(owner, [asset.id]))[asset.id]).toMatchObject({ deleted: true, name: 'logo.png' });
    expect((await engine.tasks.get(owner, mentioning.id)).markdown).toContain(link);
  });

  it('deletes an asset nothing uses', async () => {
    const asset = await make(owner, 'unused.txt', 'unused');

    await assets().delete(owner, asset.id);

    expect(await codeOf(assets().get(owner, asset.id))).toBe('NOT_FOUND');
  });

  it('removes a workspace with its files', async () => {
    const asset = await assets().create(other, { name: 'gone.txt', body: 'gone' });
    const key = keyOf('ws_other', asset);
    expect(await store.exists(key)).toBe(true);

    await engine.workspaces.purge('ws_other');

    expect(await store.exists(key)).toBe(false);
    expect(await keysOf(store, 'ws_other')).toEqual([]);
    expect(await keysOf(store, ws)).not.toEqual([]);
    const rows = await assets().summaries(other, [asset.id]);
    expect(rows).toEqual({});
  });
});
