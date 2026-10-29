import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type ByteRange, type FileStore, keyParts, STAGING_PREFIX, type StoredObject } from './store';

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/**
 * Stores objects as files under one folder. Bytes are written to a staging file and renamed into place, so a reader
 * never sees half a file; every path is checked to stay inside the folder (no `..`, no symlink that leads out).
 */
export const createLocalFileStore = (rootDir: string): FileStore => {
  const root = join(rootDir);
  let realRoot: string | undefined;

  const rootReal = async (): Promise<string> => {
    await mkdir(root, { recursive: true });
    realRoot ??= await realpath(root);

    return realRoot;
  };

  /** The path of `key`, once its folder is known to be inside the root (a symlinked folder is refused). */
  const pathOf = async (key: string): Promise<string> => {
    const base = await rootReal();
    const target = join(base, ...keyParts(key));
    let ancestor = dirname(target);

    // The deepest folder that exists must resolve inside the root: nothing above it can redirect the write.
    for (;;) {
      try {
        const real = await realpath(ancestor);

        if (real !== base && !real.startsWith(base + sep)) {
          throw new Error(`File store key "${key}" leaves the store`);
        }

        break;
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }

        ancestor = dirname(ancestor);
      }
    }

    return target;
  };

  /** Removes the folders a deletion left empty, up to the root. */
  const pruneEmptyParents = async (path: string) => {
    const base = await rootReal();

    for (let dir = dirname(path); dir.startsWith(base + sep); dir = dirname(dir)) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
    }
  };

  const put: FileStore['put'] = async (key, body) => {
    const target = await pathOf(key);
    const base = await rootReal();
    const staging = join(base, STAGING_PREFIX, randomUUID());

    await mkdir(dirname(staging), { recursive: true });

    try {
      await pipeline(
        Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(staging, { flags: 'wx' }),
      );
      await mkdir(dirname(target), { recursive: true });
      // A folder made between the check and now could be a symlink; check again before moving in.
      await pathOf(key);
      const { size } = await stat(staging);
      await rename(staging, target);

      return { size };
    } catch (error) {
      await rm(staging, { force: true });
      throw error;
    }
  };

  const get: FileStore['get'] = async (key, range?: ByteRange) => {
    const path = await pathOf(key);

    try {
      const info = await lstat(path);

      if (info.isSymbolicLink()) {
        throw new Error(`File store key "${key}" is a symbolic link`);
      }

      if (!info.isFile()) {
        return null;
      }

      const stream = createReadStream(path, range ? { start: range.start, end: range.end } : {});

      return { stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size };
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }

      throw error;
    }
  };

  const exists: FileStore['exists'] = async (key) => {
    try {
      return (await lstat(await pathOf(key))).isFile();
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }

      throw error;
    }
  };

  const statObject: FileStore['stat'] = async (key) => {
    try {
      const info = await lstat(await pathOf(key));

      return info.isFile() ? { size: info.size } : null;
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }

      throw error;
    }
  };

  const remove: FileStore['delete'] = async (key) => {
    const path = await pathOf(key);
    await rm(path, { force: true });
    await pruneEmptyParents(path);
  };

  const deletePrefix: FileStore['deletePrefix'] = async (prefix) => {
    const path = await pathOf(`${prefix}/x`).then(dirname);
    await rm(path, { recursive: true, force: true });
    await pruneEmptyParents(path);
  };

  async function* walk(dir: string, keyPrefix: string): AsyncGenerator<StoredObject> {
    let entries: Dirent[];

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return;
      }

      throw error;
    }

    for (const entry of entries) {
      const key = keyPrefix === '' ? entry.name : `${keyPrefix}/${entry.name}`;

      if (entry.isDirectory()) {
        yield* walk(join(dir, entry.name), key);
      } else if (entry.isFile()) {
        const info = await stat(join(dir, entry.name));
        yield { key, size: info.size, modifiedAt: info.mtime };
      }
    }
  }

  const list: FileStore['list'] = (prefix) => ({
    async *[Symbol.asyncIterator]() {
      const base = await rootReal();
      const parts = prefix === '' ? [] : keyParts(prefix);
      yield* walk(join(base, ...parts), parts.join('/'));
    },
  });

  return { put, get, exists, stat: statObject, delete: remove, deletePrefix, list };
};
