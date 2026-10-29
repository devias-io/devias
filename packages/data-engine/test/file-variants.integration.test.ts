import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileVariantSpec } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDataEngine,
  createLocalFileStore,
  type DataEngine,
  type EngineContext,
  type FileStore,
  type ImageProcessor,
  silentLogger,
} from '../src';
import { createTestDb, type TestDb } from './helpers/db';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const owner: EngineContext = { workspaceId: 'ws_images', actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };

/** An image library that counts what it is asked, so tests can tell how often the real one would have worked. */
const fakeImages = () => {
  const calls = { info: 0, variant: 0, running: 0, mostAtOnce: 0 };
  const behaviour = {
    info: (): Promise<{ width: number; height: number; animated: boolean } | null> =>
      Promise.resolve({ width: 640, height: 480, animated: false }),
    variant: async (_bytes: Uint8Array, spec: FileVariantSpec): Promise<Uint8Array | null> => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      return new TextEncoder().encode(`webp:${spec.width}:${spec.fit}`);
    },
  };
  const images: ImageProcessor = {
    info: () => {
      calls.info += 1;

      return behaviour.info();
    },
    variant: async (bytes, spec) => {
      calls.variant += 1;
      calls.running += 1;
      calls.mostAtOnce = Math.max(calls.mostAtOnce, calls.running);

      try {
        return await behaviour.variant(bytes, spec);
      } finally {
        calls.running -= 1;
      }
    },
  };

  return { images, calls, behaviour };
};

const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

describe('picture sizes and variants on PGlite', () => {
  let testDb: TestDb;
  let root: string;
  let store: FileStore;
  const engines: DataEngine[] = [];

  const build = (images?: ImageProcessor) => {
    const engine = createDataEngine({
      db: testDb.db,
      logger: silentLogger,
      fileStore: store,
      ...(images ? { imageProcessor: images } : {}),
    });
    engines.push(engine);

    return engine;
  };

  beforeAll(async () => {
    testDb = await createTestDb();
    root = await mkdtemp(join(tmpdir(), 'devias-variants-test-'));
    store = createLocalFileStore(root);
    await build().workspaces.initialize('ws_images');
  });

  afterAll(async () => {
    await Promise.all(engines.map((engine) => engine.close()));
    await testDb.close();
    await rm(root, { recursive: true, force: true });
  });

  it('learns the size of a picture when it is stored, and only then', async () => {
    const { images, calls } = fakeImages();
    const engine = build(images);

    const picture = await engine.assets.create(owner, { name: 'photo.png', body: PNG });
    expect(picture).toMatchObject({ contentType: 'image/png', width: 640, height: 480 });
    expect((await engine.assets.get(owner, picture.id)).width).toBe(640);
    expect((await engine.assets.summaries(owner, [picture.id]))[picture.id]).toMatchObject({ width: 640, height: 480 });

    // Text and PDFs are not pictures: the library is not asked.
    await engine.assets.create(owner, { name: 'notes.txt', body: 'hello' });
    await engine.assets.create(owner, { name: 'doc.pdf', body: '%PDF-1.4' });
    expect(calls.info).toBe(1);
  });

  it('stores a picture all the same when the library cannot read it or fails', async () => {
    const { images, behaviour } = fakeImages();
    const engine = build(images);

    behaviour.info = () => Promise.resolve(null);
    expect(await engine.assets.create(owner, { name: 'odd.png', body: PNG })).toMatchObject({
      width: null,
      height: null,
    });

    behaviour.info = () => Promise.reject(new Error('libvips fell over'));
    const asset = await engine.assets.create(owner, { name: 'worse.png', body: PNG });
    expect(asset).toMatchObject({ contentType: 'image/png', width: null, height: null });
    expect(await store.exists(`ws_images/${asset.id.slice(-2)}/${asset.id}/original`)).toBe(true);
  });

  it('stores pictures with no size when there is no library, and has no variants', async () => {
    const engine = build();
    const asset = await engine.assets.create(owner, { name: 'plain.png', body: PNG });
    const opened = await engine.assets.open(owner, asset.id);

    expect(asset).toMatchObject({ width: null, height: null });
    expect(await opened.variant?.({ width: 256, fit: 'inside' })).toBeNull();
  });

  it('makes a variant once, keeps it beside the original and reads it like any file', async () => {
    const { images, calls } = fakeImages();
    const engine = build(images);
    const asset = await engine.assets.create(owner, { name: 'My Photo.png', body: PNG });
    const spec: FileVariantSpec = { width: 256, fit: 'cover' };
    const opened = await engine.assets.open(owner, asset.id);

    const variant = await opened.variant?.(spec);
    expect(variant?.file).toMatchObject({
      id: asset.id,
      name: 'My Photo.webp',
      contentType: 'image/webp',
      size: 'webp:256:cover'.length,
      checksum: `${asset.checksum}-w256-cover`,
    });
    expect(await textOf((await variant?.read()) as ReadableStream<Uint8Array>)).toBe('webp:256:cover');
    expect(await textOf((await variant?.read({ start: 5, end: 7 })) as ReadableStream<Uint8Array>)).toBe('256');
    expect(await store.exists(`ws_images/${asset.id.slice(-2)}/${asset.id}/v/w256-cover`)).toBe(true);
    // A variant has no variants of its own.
    expect(variant?.variant).toBeUndefined();

    // Asked again, even by another opening of the file, it is read from the store.
    await (await engine.assets.open(owner, asset.id)).variant?.(spec);
    await opened.variant?.(spec);
    expect(calls.variant).toBe(1);

    // Another size or fit is another variant.
    expect((await opened.variant?.({ width: 256, fit: 'inside' }))?.file.checksum).toBe(
      `${asset.checksum}-w256-inside`,
    );
    expect(calls.variant).toBe(2);
  });

  it('makes one variant for requests that arrive together', async () => {
    const { images, calls } = fakeImages();
    const engine = build(images);
    const asset = await engine.assets.create(owner, { name: 'busy.png', body: PNG });
    const opened = await engine.assets.open(owner, asset.id);

    const results = await Promise.all(Array.from({ length: 6 }, () => opened.variant?.({ width: 512, fit: 'inside' })));

    expect(calls.variant).toBe(1);
    expect(results.every((result) => result?.file.size === 'webp:512:inside'.length)).toBe(true);
  });

  it('makes at most two variants at a time, and all of them in the end', async () => {
    const { images, calls } = fakeImages();
    const engine = build(images);
    const asset = await engine.assets.create(owner, { name: 'many.png', body: PNG });
    const opened = await engine.assets.open(owner, asset.id);
    const widths = [64, 128, 256, 512, 1024, 2048] as const;

    const results = await Promise.all(widths.map((width) => opened.variant?.({ width, fit: 'inside' })));

    expect(calls.variant).toBe(6);
    expect(calls.mostAtOnce).toBe(2);
    expect(results.map((result) => result?.file.size)).toEqual(widths.map((width) => `webp:${width}:inside`.length));
  });

  it('serves the original when there is no variant to make, and does not try again', async () => {
    const { images, calls, behaviour } = fakeImages();
    const engine = build(images);
    const asset = await engine.assets.create(owner, { name: 'moving.png', body: PNG });
    const opened = await engine.assets.open(owner, asset.id);

    behaviour.variant = () => Promise.resolve(null);
    expect(await opened.variant?.({ width: 128, fit: 'inside' })).toBeNull();
    expect(await opened.variant?.({ width: 128, fit: 'inside' })).toBeNull();
    expect(calls.variant).toBe(1);
    expect(await store.exists(`ws_images/${asset.id.slice(-2)}/${asset.id}/v/w128-inside`)).toBe(false);

    // A library that fails is the same: the original is served, and the request does not fail.
    behaviour.variant = () => Promise.reject(new Error('out of memory'));
    expect(await opened.variant?.({ width: 64, fit: 'cover' })).toBeNull();
  });

  it('never makes a variant of what is not a picture it knows', async () => {
    const { images, calls } = fakeImages();
    const engine = build(images);
    const text = await engine.assets.create(owner, { name: 'notes.txt', body: 'hello' });
    const svg = await engine.assets.create(owner, {
      name: 'logo.svg',
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });

    for (const asset of [text, svg]) {
      expect(await (await engine.assets.open(owner, asset.id)).variant?.({ width: 64, fit: 'inside' })).toBeNull();
    }

    expect(calls.variant).toBe(0);
  });

  it('removes the variants with the file', async () => {
    const { images } = fakeImages();
    const engine = build(images);
    const asset = await engine.assets.create(owner, { name: 'doomed.png', body: PNG });
    await (await engine.assets.open(owner, asset.id)).variant?.({ width: 64, fit: 'inside' });
    const prefix = `ws_images/${asset.id.slice(-2)}/${asset.id}`;
    expect(await store.exists(`${prefix}/v/w64-inside`)).toBe(true);

    await engine.assets.delete(owner, asset.id);

    expect(await store.exists(`${prefix}/v/w64-inside`)).toBe(false);
    expect(await store.exists(`${prefix}/original`)).toBe(false);
  });
});
