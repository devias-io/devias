import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileKind } from '@devias/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDataEngine,
  createFileUrlSigner,
  createLocalFileStore,
  type DataEngine,
  type EngineContext,
  type FileStore,
  runRaw,
  silentLogger,
} from '../src';
import { createTestDb, type TestDb } from './helpers/db';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const keysOf = async (store: FileStore, prefix = ''): Promise<string[]> => {
  const keys: string[] = [];

  for await (const object of store.list(prefix)) {
    keys.push(object.key);
  }

  return keys.sort();
};

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'error';
  }
};

describe('files on PGlite', () => {
  let testDb: TestDb;
  let root: string;
  let store: FileStore;
  let engine: DataEngine;
  let now = new Date('2026-10-29T10:00:00Z');
  const ws = 'ws_files';
  const owner: EngineContext = { workspaceId: ws, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };
  const alice = { kind: 'user', id: 'u_alice' } as const;
  const signer = () => createFileUrlSigner({ secret: 'test-secret', clock: () => now });

  /** Writes bytes and adds them as a file of a kind, as a logo or a picture would be. */
  const keep = async (
    workspaceId: string | null,
    actor: EngineContext['actor'],
    kind: FileKind,
    name: string,
    body: Uint8Array | string,
  ) => {
    const written = await engine.files.write({ workspaceId, actor }, { name, body });
    await engine.db.transaction(async (tx) => engine.files.add(tx, written, { kind }, actor, now));

    return written;
  };

  beforeAll(async () => {
    testDb = await createTestDb();
    root = await mkdtemp(join(tmpdir(), 'devias-files-test-'));
    store = createLocalFileStore(root);
    engine = createDataEngine({
      db: testDb.db,
      logger: silentLogger,
      clock: () => now,
      fileStore: store,
      fileUrls: signer(),
      fileSweepGraceMs: 60 * 60 * 1000,
    });
    await engine.workspaces.initialize(ws);
  });

  afterAll(async () => {
    await engine.close();
    await testDb.close();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a person’s picture apart from every workspace: not an asset, its own folder, a link of its own', async () => {
    const picture = await keep(null, alice, 'avatar', 'me.png', PNG);

    expect(picture).toMatchObject({
      workspaceId: null,
      name: 'me.png',
      contentType: 'image/png',
      size: PNG.byteLength,
    });
    expect(picture.prefix.startsWith('user~u_alice/')).toBe(true);
    expect(await store.exists(`${picture.prefix}/original`)).toBe(true);
    // Not something a workspace lists, counts or stores.
    expect((await engine.assets.list(owner)).items).toEqual([]);
    expect(await engine.files.usage(ws)).toEqual({ count: 0, bytes: 0, quotaBytes: null });

    // A picture is public: its link is plain and permanent, and opens it with no workspace and no signature in the way.
    expect(signer().url({ id: picture.id, workspaceId: null, public: true })).toBe(`/files/${picture.id}`);
    const opened = await engine.files.openByLink(picture.id);
    expect(opened.file).toMatchObject({ workspaceId: null, public: true, name: 'me.png', contentType: 'image/png' });
    expect(new Uint8Array(await new Response(await opened.read()).arrayBuffer())).toEqual(PNG);

    // Purging a workspace leaves it alone.
    await engine.workspaces.purge('ws_nothing');
    expect(await store.exists(`${picture.prefix}/original`)).toBe(true);
  });

  it('belongs to a person when it belongs to no workspace, and the database says so too', async () => {
    const before = await keysOf(store);

    await expect(
      engine.files.write({ workspaceId: null, actor: { kind: 'api_key', id: 'key_1' } }, { name: 'x.png', body: PNG }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await keysOf(store)).toEqual(before);

    const insert = (kind: string, by: string) =>
      runRaw(
        testDb.db,
        sql`INSERT INTO file (id, workspace_id, kind, name, content_type, size, checksum, storage_key, created_by, updated_by)
          VALUES (gen_random_uuid(), NULL, ${kind}, 'x', 'image/png', 1, 'x', 'p', ${by}::jsonb, ${by}::jsonb)`,
      );

    await expect(insert('avatar', '{"kind":"api_key","id":"k"}')).rejects.toThrow();
    await expect(insert('asset', '{"kind":"user","id":"u"}')).rejects.toThrow();
    await expect(insert('logo', '{"kind":"user","id":"u"}')).rejects.toThrow();
    await expect(insert('banner', '{"kind":"user","id":"u"}')).rejects.toThrow();
    await expect(insert('avatar', '{"kind":"user","id":"u"}')).resolves.toBeDefined();
  });

  it('opens a public file with no signature and a private one only with a valid one', async () => {
    const logo = await keep(ws, owner.actor, 'logo', 'brand.png', PNG);
    const asset = await engine.assets.create(owner, { name: 'private.txt', body: 'private' });
    const signed = new URL(asset.url, 'http://x').searchParams;
    const [row] = await runRaw<{ public: boolean }>(
      testDb.db,
      sql`SELECT public FROM file WHERE id = ${logo.id}::uuid`,
    );

    expect(row?.public).toBe(true);
    expect((await engine.files.openByLink(logo.id)).file.public).toBe(true);
    // A signature on a public file is not needed, and not looked at.
    expect((await engine.files.openByLink(logo.id, '1', 'nonsense')).file.id).toBe(logo.id);

    // A private file opens with its signed link only: no signature, a wrong one and an old one are all refused.
    expect(asset.url).toMatch(/exp=\d+&sig=/);
    expect(
      (await engine.files.openByLink(asset.id, signed.get('exp') ?? '', signed.get('sig') ?? '')).file.public,
    ).toBe(false);
    expect(await codeOf(engine.files.openByLink(asset.id))).toBe('FORBIDDEN');
    expect(await codeOf(engine.files.openByLink(asset.id, signed.get('exp') ?? '', 'nonsense'))).toBe('FORBIDDEN');
    expect(await codeOf(engine.files.openByLink(asset.id, '1', signed.get('sig') ?? ''))).toBe('FORBIDDEN');

    // A removed public file is gone at once.
    await engine.db.transaction(async (tx) => engine.files.remove(tx, logo.id, owner.actor, now));
    await engine.files.discard(logo.prefix, 'a test logo');
    expect(await codeOf(engine.files.openByLink(logo.id))).toBe('NOT_FOUND');
    await engine.assets.delete(owner, asset.id);
  });

  it('adds logos and pictures public, and refuses to make one private', async () => {
    const written = await engine.files.write({ workspaceId: ws, actor: owner.actor }, { name: 'x.png', body: PNG });

    await expect(
      engine.db.transaction(async (tx) =>
        engine.files.add(tx, written, { kind: 'logo', public: false }, owner.actor, now),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: 'A logo is always public' });
    await expect(
      engine.db.transaction(async (tx) =>
        engine.files.add(tx, written, { kind: 'avatar', public: false }, owner.actor, now),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // An asset is private unless it is said to be public.
    await engine.db.transaction(async (tx) =>
      engine.files.add(tx, written, { kind: 'asset', public: true }, owner.actor, now),
    );
    expect((await engine.files.openByLink(written.id)).file.public).toBe(true);
    await engine.assets.delete(owner, written.id);
  });

  it('never shows a logo or a picture as an asset, whatever is asked', async () => {
    const logo = await keep(ws, owner.actor, 'logo', 'logo.png', PNG);
    const mine = await engine.assets.create(owner, { name: 'doc.txt', body: 'abc' });

    // The library lists the asset only.
    expect((await engine.assets.list(owner)).items.map((item) => item.id)).toEqual([mine.id]);
    expect((await engine.assets.list(owner, { search: 'logo' })).total).toBe(0);
    expect((await engine.assets.list(owner, { ids: logo.id })).total).toBe(0);
    expect(await engine.assets.summaries(owner, [logo.id, mine.id])).toEqual({ [mine.id]: expect.anything() });
    for (const attempt of [
      engine.assets.get(owner, logo.id),
      engine.assets.open(owner, logo.id),
      engine.assets.update(owner, logo.id, { name: 'x.png' }),
      engine.assets.delete(owner, logo.id),
      engine.assets.link(owner, logo.id),
      engine.assets.usage(owner, logo.id),
    ]) {
      expect(await codeOf(attempt)).toBe('NOT_FOUND');
    }

    // It is still stored, and counts toward what the workspace stores.
    expect(await store.exists(`${logo.prefix}/original`)).toBe(true);
    expect(await engine.assets.workspaceUsage(owner)).toEqual({
      count: 1,
      bytes: PNG.byteLength + 3,
      quotaBytes: null,
    });
    expect(await engine.files.usage(ws)).toMatchObject({ count: 2, bytes: PNG.byteLength + 3 });
  });

  it('marks an asset’s file removed and takes its bytes, keeping a tombstone', async () => {
    const asset = await engine.assets.create(owner, { name: 'doomed.txt', body: 'doomed' });
    const key = `${ws}/${asset.id.slice(-2)}/${asset.id}/original`;
    expect(await store.exists(key)).toBe(true);

    await engine.assets.delete(owner, asset.id);

    expect(await store.exists(key)).toBe(false);
    const [row] = await runRaw<{ deleted_at: unknown }>(
      testDb.db,
      sql`SELECT deleted_at FROM file WHERE id = ${asset.id}::uuid`,
    );
    expect(row?.deleted_at).not.toBeNull();
    expect((await engine.assets.summaries(owner, [asset.id]))[asset.id]).toMatchObject({
      deleted: true,
      name: 'doomed.txt',
      url: '',
    });
  });

  it('cleans up the bytes when the row cannot be written', async () => {
    const before = await keysOf(store);

    // A description over its limit is refused after the bytes were written.
    await expect(
      engine.assets.create(owner, { name: 'x.txt', description: 'd'.repeat(5000), body: 'x' }),
    ).rejects.toThrow();
    expect(await keysOf(store)).toEqual(before);

    const written = await engine.files.write({ workspaceId: ws, actor: owner.actor }, { name: 'y.txt', body: 'y' });
    expect(await store.exists(`${written.prefix}/original`)).toBe(true);
    // Written but never added: the caller discards it, or the sweeper does once it is old enough.
    await engine.files.discard(written.prefix, 'a file that was not added');
    expect(await keysOf(store)).toEqual(before);
  });

  it('sweeps what a crash left: orphans after the grace period, staged uploads, removals not finished', async () => {
    const live = await engine.assets.create(owner, { name: 'live.txt', body: 'live' });
    const removed = await keep(ws, owner.actor, 'asset', 'removed.bin', 'removed');
    const liveKey = `${ws}/${live.id.slice(-2)}/${live.id}/original`;
    // A removal that stopped after the row: the bytes are still there.
    await runRaw(testDb.db, sql`UPDATE file SET deleted_at = now() WHERE id = ${removed.id}::uuid`);
    // A write that stopped before the row, and a staged upload.
    const orphanKey = `${ws}/ab/01a173ad-5d3f-7091-8466-4dcdeb689686/original`;
    await store.put(orphanKey, new Response('orphan').body as ReadableStream<Uint8Array>);
    await store.put('.tmp/stale', new Response('half').body as ReadableStream<Uint8Array>);

    // Within the grace period an object without a row might be a write in flight. (Files carry the real time.)
    const realNow = now;
    now = new Date();
    expect(await engine.files.sweep()).toEqual({ orphans: 0, finished: 1, staged: 0 });
    expect(await store.exists(orphanKey)).toBe(true);
    expect(await store.exists(`${removed.prefix}/original`)).toBe(false);

    now = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(await engine.files.sweep()).toEqual({ orphans: 1, finished: 0, staged: 1 });
    now = realNow;

    expect(await store.exists(orphanKey)).toBe(false);
    expect(await store.exists('.tmp/stale')).toBe(false);
    expect(await store.exists(liveKey)).toBe(true);
    expect(await engine.files.sweep()).toEqual({ orphans: 0, finished: 0, staged: 0 });
  });

  it('keeps a workspace within its quota, counting every file it stores', async () => {
    const used = (await engine.files.usage(ws)).bytes;
    const limited = createDataEngine({
      db: testDb.db,
      logger: silentLogger,
      clock: () => now,
      fileStore: store,
      fileQuotaBytes: used + 100,
    });

    expect(await limited.files.usage(ws)).toMatchObject({ bytes: used, quotaBytes: used + 100 });
    // A file that is not an asset counts too.
    const written = await limited.files.write(
      { workspaceId: ws, actor: owner.actor },
      { name: 'a.bin', body: 'x'.repeat(60) },
    );
    await limited.db.transaction(async (tx) => limited.files.add(tx, written, { kind: 'logo' }, owner.actor, now));
    await expect(
      limited.files.write({ workspaceId: ws, actor: owner.actor }, { name: 'b.bin', body: 'x'.repeat(60) }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/does not fit/) });
    // A person's own file is not the workspace's to count.
    const personal = await limited.files.write(
      { workspaceId: null, actor: alice },
      { name: 'c.bin', body: 'x'.repeat(500) },
    );
    expect(personal.size).toBe(500);
    await limited.files.discard(personal.prefix, 'a test file');
    await limited.close();
  });
});
