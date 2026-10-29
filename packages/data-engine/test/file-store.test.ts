import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalFileStore, type FileStore } from '../src';

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }

      controller.close();
    },
  });

const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

const keysOf = async (store: FileStore, prefix = ''): Promise<string[]> => {
  const keys: string[] = [];

  for await (const object of store.list(prefix)) {
    keys.push(object.key);
  }

  return keys.sort();
};

describe('local file store', () => {
  let root: string;
  let outside: string;
  let store: FileStore;

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'devias-store-'));
    root = join(base, 'root');
    outside = join(base, 'outside');
    await mkdir(outside, { recursive: true });
    store = createLocalFileStore(root);
  });

  afterEach(() => rm(join(root, '..'), { recursive: true, force: true }));

  it('writes, reads and deletes an object', async () => {
    expect(await store.put('ws/ab/one/original', streamOf('hello ', 'world'))).toEqual({ size: 11 });
    expect(await store.exists('ws/ab/one/original')).toBe(true);

    const found = await store.get('ws/ab/one/original');
    expect(found?.size).toBe(11);
    expect(await textOf(found?.stream as ReadableStream<Uint8Array>)).toBe('hello world');

    await store.delete('ws/ab/one/original');
    expect(await store.exists('ws/ab/one/original')).toBe(false);
    expect(await store.get('ws/ab/one/original')).toBeNull();
    // Deleting what is not there is quiet, and the empty folders are gone.
    await store.delete('ws/ab/one/original');
    expect(await readdir(root)).toEqual(['.tmp']);
  });

  it('reads a range of bytes, the whole size reported', async () => {
    await store.put('ws/ab/one/original', streamOf('0123456789'));

    const found = await store.get('ws/ab/one/original', { start: 2, end: 5 });
    expect(found?.size).toBe(10);
    expect(await textOf(found?.stream as ReadableStream<Uint8Array>)).toBe('2345');
  });

  it('replaces an object atomically and leaves nothing behind when the stream fails', async () => {
    await store.put('ws/ab/one/original', streamOf('first'));

    const failing = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('par'));
        },
        pull() {
          throw new Error('connection lost');
        },
      });

    await expect(store.put('ws/ab/one/original', failing())).rejects.toThrow('connection lost');
    // The old bytes survive, and the half-written ones are gone.
    expect(
      await textOf(((await store.get('ws/ab/one/original')) as { stream: ReadableStream<Uint8Array> }).stream),
    ).toBe('first');
    expect(await readdir(join(root, '.tmp'))).toEqual([]);

    await expect(store.put('ws/ab/two/original', failing())).rejects.toThrow('connection lost');
    expect(await store.exists('ws/ab/two/original')).toBe(false);
  });

  it('refuses keys that could leave the store', async () => {
    for (const key of ['../escape', 'ws/../../escape', '/abs', 'ws//x', 'ws/./x', '', 'ws\\x']) {
      await expect(store.put(key, streamOf('x'))).rejects.toThrow(/Invalid file store key/);
    }

    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses to follow a symbolic link out of the store', async () => {
    await store.put('ws/ab/one/original', streamOf('kept'));
    await writeFile(join(outside, 'secret'), 'secret');
    await symlink(outside, join(root, 'linked'));
    await symlink(join(outside, 'secret'), join(root, 'ws', 'ab', 'one', 'link'));

    await expect(store.put('linked/x/original', streamOf('x'))).rejects.toThrow(/leaves the store/);
    await expect(store.get('ws/ab/one/link')).rejects.toThrow(/symbolic link/);
    expect(await readdir(outside)).toEqual(['secret']);
    expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('secret');
  });

  it('deletes a prefix and lists by prefix', async () => {
    await store.put('ws/ab/one/original', streamOf('1'));
    await store.put('ws/ab/one/v/w256', streamOf('2'));
    await store.put('ws/cd/two/original', streamOf('3'));
    await store.put('other/ef/three/original', streamOf('4'));

    expect(await keysOf(store, 'ws/ab/one')).toEqual(['ws/ab/one/original', 'ws/ab/one/v/w256']);
    expect(await keysOf(store, 'nothing/here')).toEqual([]);

    await store.deletePrefix('ws/ab/one');
    expect(await keysOf(store)).toEqual(['other/ef/three/original', 'ws/cd/two/original']);

    await store.deletePrefix('ws');
    expect(await keysOf(store)).toEqual(['other/ef/three/original']);
    await store.deletePrefix('ws');
    await expect(store.deletePrefix('')).rejects.toThrow(/Invalid file store key/);
    expect(await store.exists('other/ef/three/original')).toBe(true);
  });
});
