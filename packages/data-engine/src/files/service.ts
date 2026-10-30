import { createHash } from 'node:crypto';
import {
  type Actor,
  detectFileType,
  FILE_SNIFF_BYTES,
  type FileKind,
  type FileVariantSpec,
  fileVariantKeyOf,
  isRasterImage,
  newId,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import { type Db, runRaw, toNumber } from '../db/exec';
import { EngineError, notFound, validationError } from '../errors';
import { UUID } from '../links';
import type { Logger } from '../logger';
import type { ImageProcessor } from './images';
import {
  type ByteRange,
  type FileStore,
  fileIdOfKey,
  filePrefixOf,
  originalKeyOf,
  STAGING_PREFIX,
  scopeOf,
} from './store';
import type { FileUrlSigner } from './urls';

/** Whom a file belongs to: a workspace, or (with no workspace) the person acting, as an account picture does. */
export interface FileOwner {
  workspaceId: string | null;
  actor: Actor;
}

/** Bytes that are in the store but not yet in the database: what `write` returns and `add` takes. */
export interface WrittenFile {
  id: string;
  workspaceId: string | null;
  /** What it is called: the name it was given, cleaned by the caller. */
  name: string;
  prefix: string;
  contentType: string;
  size: number;
  checksum: string;
  /** Pixels, for a picture the image library could read. */
  width: number | null;
  height: number | null;
}

/** What it takes to read a file's bytes. */
export interface FileFacts {
  id: string;
  workspaceId: string | null;
  public: boolean;
  contentType: string;
  size: number;
  checksum: string;
  storageKey: string;
}

/** A file opened for reading: what it is called and a way to get its bytes, whole or in part. */
export interface OpenedFile {
  file: {
    id: string;
    workspaceId: string | null;
    /** Anyone with its link may open it, and its link never changes. */
    public: boolean;
    /** What the download is called. */
    name: string;
    contentType: string;
    size: number;
    checksum: string;
  };
  /** The whole file, or only `range` (inclusive byte offsets inside it). */
  read(range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  /**
   * A smaller WebP of a picture, made on the first request and kept beside the original; null when there is none to make
   * (no image library, not a picture it can resize, an animated one): then the original is what to serve.
   */
  variant?(spec: FileVariantSpec): Promise<OpenedFile | null>;
}

export interface FileSweepResult {
  /** Objects with no file row that were older than the grace period. */
  orphans: number;
  /** Objects of files that were removed whose bytes were still there. */
  finished: number;
  /** Staged uploads a crash left behind. */
  staged: number;
}

export interface FileUsage {
  count: number;
  bytes: number;
  /** The most the workspace may store; null while unlimited. */
  quotaBytes: number | null;
}

/**
 * Files: stored bytes and the row that says what they are, whatever the file is for. This layer decides nothing about who
 * may do what: whoever calls it (the assets service, an account picture) has already checked that, and says whom the file
 * belongs to and what it is for.
 * The bytes are written first and the row second; a removal takes the row first and the bytes second; whatever a crash
 * leaves between the two is what `sweep` reconciles.
 */
export interface FileService {
  /**
   * Streams the body into the store, counting, hashing and sampling it on the way: over the size limit, or out of room in
   * the workspace, is a `VALIDATION` that leaves nothing behind. The caller adds the file's row in its transaction (`add`)
   * and, if anything after that fails, calls `discard`.
   */
  write(
    owner: FileOwner,
    input: {
      name: string;
      body: ReadableStream<Uint8Array> | Uint8Array | string;
      /** A limit lower than the server's, for what is small by nature (a picture of a person). */
      maxBytes?: number;
    },
  ): Promise<WrittenFile>;
  /** Adds the row of a written file (the bytes are already in the store), in the caller's transaction. */
  add(
    tx: Db,
    written: WrittenFile,
    meta: { kind: FileKind; description?: string; public?: boolean },
    actor: Actor,
    now: Date,
  ): Promise<void>;
  /** Marks the file removed, in the caller's transaction, and says where its bytes are; the caller then `discard`s them. */
  remove(tx: Db, id: string, actor: Actor, now: Date): Promise<string>;
  /**
   * Marks a person's own picture removed, and says where its bytes are (to `discard`), or null when the file is not a picture
   * of theirs: someone else's, a workspace's, an asset, or already gone. Nobody can remove another person's file this way
   * by naming it.
   */
  removePersonal(userId: string, fileId: string, now: Date): Promise<string | null>;
  /** The link a file is opened at: plain and permanent for a public one, signed for a private one. */
  url(file: { id: string; workspaceId: string | null; public: boolean }): string;
  /** Removes bytes from the store, quietly: the sweeper finishes what this cannot. */
  discard(prefix: string, what: string): Promise<void>;
  /** A way to read `facts`, for a caller that found the file and checked the right to read it. */
  opened(facts: FileFacts, name: string): OpenedFile;
  /**
   * Opens the file for whoever holds its link: no caller, the link is the permission. A public file opens with no
   * signature; a private one needs a valid, unexpired one.
   */
  openByLink(id: string, exp?: string, sig?: string): Promise<OpenedFile>;
  /** What a workspace stores. */
  usage(workspaceId: string): Promise<FileUsage>;
  /** Removes the bytes of a workspace; its rows go with the rest of the workspace (`workspaces.purge`). */
  purgeWorkspace(workspaceId: string): Promise<void>;
  /** Reconciles the store with the rows after a crash or a failed removal. Safe to run at any time. */
  sweep(): Promise<FileSweepResult>;
}

export interface FileServiceDeps {
  db: Db;
  clock: () => Date;
  logger: Logger;
  store: FileStore;
  urls: FileUrlSigner;
  /** The largest file; default 25 MB. */
  maxBytes: number;
  /** The most a workspace may store; null while unlimited. */
  quotaBytes: number | null;
  /** How old an object without a row must be before the sweeper removes it. */
  sweepGraceMs: number;
  /** The image library, when there is one: sizes at upload, variants on demand. */
  images?: ImageProcessor;
  /** How many variants are made at once; default 2. */
  maxConversions?: number;
}

/** How much of a picture is read to learn its size. */
const INFO_BYTES = 1024 * 1024;
/** Variants that cannot be made are remembered this long as a set of at most this many. */
const UNSUPPORTED_MAX = 1000;

/** What a download of a variant is called: the name, as a WebP. */
const variantName = (name: string): string => `${name.replace(/\.[^./\\]+$/, '') || 'image'}.webp`;

const megabytes = (bytes: number): string => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

const streamOf = (body: ReadableStream<Uint8Array> | Uint8Array | string): ReadableStream<Uint8Array> => {
  if (body instanceof ReadableStream) {
    return body;
  }

  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }

      controller.close();
    },
  });
};

export const createFileService = (deps: FileServiceDeps): FileService => {
  const { db, clock, logger, store, urls, maxBytes, quotaBytes, sweepGraceMs, images } = deps;
  const maxConversions = deps.maxConversions ?? 2;

  const usage = async (workspaceId: string): Promise<{ count: number; bytes: number }> => {
    const rows = await runRaw<{ count: unknown; bytes: unknown }>(
      db,
      sql`SELECT count(*) AS count, COALESCE(sum(size), 0) AS bytes FROM file WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL`,
    );

    return { count: toNumber(rows[0]?.count), bytes: toNumber(rows[0]?.bytes) };
  };

  const discard: FileService['discard'] = async (prefix, what) => {
    try {
      await store.deletePrefix(prefix);
    } catch (error) {
      // The sweeper finishes it; the caller's outcome does not depend on it.
      logger.warn(`could not remove the bytes of ${what}; the sweeper will retry`, error);
    }
  };

  // Making a variant: at most `maxConversions` at a time, and requests for one variant share one conversion.
  let running = 0;
  const waiting: (() => void)[] = [];
  const inflight = new Map<string, Promise<boolean>>();
  const unsupported = new Set<string>();

  const withSlot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running < maxConversions) {
      running += 1;
    } else {
      // The slot is handed over by whoever finishes, so the count never dips for a newcomer to take.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    try {
      return await work();
    } finally {
      const next = waiting.shift();

      if (next) {
        next();
      } else {
        running -= 1;
      }
    }
  };

  /** Whether the variant is in the store afterwards: made now, made before, or not to be made. */
  const ensureVariant = async (facts: FileFacts, key: string, spec: FileVariantSpec): Promise<boolean> => {
    if (!images || unsupported.has(key)) {
      return false;
    }

    // Registered in the same turn it is looked for, before anything is awaited: requests that arrive together share it.
    const shared = inflight.get(key);

    if (shared) {
      return shared;
    }

    const work = (async () => {
      if (await store.stat(key)) {
        return true;
      }

      return withSlot(async () => {
        // Another server may have made it while this one waited its turn.
        if (await store.stat(key)) {
          return true;
        }

        const original = await store.get(originalKeyOf(facts.storageKey));

        if (!original) {
          return false;
        }

        const bytes = new Uint8Array(await new Response(original.stream).arrayBuffer());
        const made = await images.variant(bytes, spec).catch((error: unknown) => {
          logger.warn(`could not make a variant of file "${facts.id}"; serving the original`, error);

          return null;
        });

        if (!made) {
          if (unsupported.size >= UNSUPPORTED_MAX) {
            unsupported.clear();
          }

          unsupported.add(key);

          return false;
        }

        await store.put(key, streamOf(made));

        return true;
      });
    })().finally(() => inflight.delete(key));
    inflight.set(key, work);

    return work;
  };

  const opened: FileService['opened'] = (facts, name) => ({
    file: {
      id: facts.id,
      workspaceId: facts.workspaceId,
      public: facts.public,
      name,
      contentType: facts.contentType,
      size: facts.size,
      checksum: facts.checksum,
    },
    read: async (range) => {
      const found = await store.get(originalKeyOf(facts.storageKey), range);

      if (!found) {
        throw new EngineError('NOT_FOUND', `The bytes of file "${facts.id}" are missing from the store`);
      }

      return found.stream;
    },
    variant: async (spec) => {
      if (!images || !isRasterImage(facts.contentType)) {
        return null;
      }

      const variantKey = fileVariantKeyOf(spec);
      const key = `${facts.storageKey}/v/${variantKey}`;

      if (!(await ensureVariant(facts, key, spec))) {
        return null;
      }

      const info = await store.stat(key);

      if (!info) {
        return null;
      }

      return {
        file: {
          id: facts.id,
          workspaceId: facts.workspaceId,
          public: facts.public,
          name: variantName(name),
          contentType: 'image/webp',
          size: info.size,
          // The original's checksum and the variant's name: what identifies these exact bytes.
          checksum: `${facts.checksum}-${variantKey}`,
        },
        read: async (range) => {
          const found = await store.get(key, range);

          if (!found) {
            throw new EngineError('NOT_FOUND', `The variant of file "${facts.id}" is missing from the store`);
          }

          return found.stream;
        },
      };
    },
  });

  const write: FileService['write'] = async (owner, input) => {
    if (owner.workspaceId === null && owner.actor.kind !== 'user') {
      throw validationError('A file that belongs to no workspace belongs to a person');
    }

    if (owner.workspaceId !== null && quotaBytes !== null && (await usage(owner.workspaceId)).bytes >= quotaBytes) {
      throw validationError(`This workspace has used its ${megabytes(quotaBytes)} of file storage`, { quotaBytes });
    }

    const id = newId();
    const scope = scopeOf({
      workspaceId: owner.workspaceId,
      ...(owner.actor.kind === 'user' ? { userId: owner.actor.id } : {}),
    });
    const prefix = filePrefixOf(scope, id);
    const limit = Math.min(maxBytes, input.maxBytes ?? maxBytes);
    const reader = streamOf(input.body).getReader();
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let headBytes = 0;
    let size = 0;

    // Counts, hashes and samples the bytes on their way to the store; stops the upload the moment it is too big.
    const measured = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();

          return;
        }

        size += value.byteLength;

        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          throw validationError(`A file may be at most ${megabytes(limit)}`, { maxBytes: limit });
        }

        hash.update(value);

        if (headBytes < FILE_SNIFF_BYTES) {
          const part = Buffer.from(value.subarray(0, FILE_SNIFF_BYTES - headBytes));
          head.push(part);
          headBytes += part.byteLength;
        }

        controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });

    try {
      await store.put(originalKeyOf(prefix), measured);

      if (
        owner.workspaceId !== null &&
        quotaBytes !== null &&
        (await usage(owner.workspaceId)).bytes + size > quotaBytes
      ) {
        throw validationError(
          `This file does not fit in the ${megabytes(quotaBytes)} of file storage of this workspace`,
          { quotaBytes },
        );
      }

      const contentType = detectFileType(Buffer.concat(head), input.name);
      let width: number | null = null;
      let height: number | null = null;

      // The size of a picture is learned from its first bytes; no image library, or one that cannot read it, is no reason to refuse it.
      if (images && size > 0 && isRasterImage(contentType)) {
        try {
          const found = await store.get(originalKeyOf(prefix), { start: 0, end: Math.min(size, INFO_BYTES) - 1 });
          const info = found ? await images.info(new Uint8Array(await new Response(found.stream).arrayBuffer())) : null;

          if (info) {
            width = info.width;
            height = info.height;
          }
        } catch (error) {
          logger.warn(`could not read the size of file "${id}"`, error);
        }
      }

      return {
        id,
        workspaceId: owner.workspaceId,
        name: input.name,
        prefix,
        contentType,
        size,
        checksum: hash.digest('hex'),
        width,
        height,
      };
    } catch (error) {
      await discard(prefix, `file "${id}" that was not stored`);
      throw error;
    }
  };

  return {
    write,
    discard,
    opened,

    add: async (tx, written, meta, actor, now) => {
      const isPublic = meta.public ?? meta.kind !== 'asset';

      // What an account picture or a logo is for is to be shown wherever its link is put; only a library asset may be private.
      if (!isPublic && meta.kind !== 'asset') {
        throw validationError(`A ${meta.kind} is always public`);
      }

      const by = JSON.stringify(actor);
      const at = now.toISOString();

      await runRaw(
        tx,
        sql`INSERT INTO file (id, workspace_id, kind, public, name, description, content_type, size, checksum, storage_key, width, height, version, created_by, updated_by, created_at, updated_at)
          VALUES (${written.id}::uuid, ${written.workspaceId}, ${meta.kind}, ${isPublic}, ${written.name}, ${meta.description ?? ''}, ${written.contentType},
            ${written.size}, ${written.checksum}, ${written.prefix}, ${written.width}, ${written.height}, 1,
            ${by}::jsonb, ${by}::jsonb, ${at}::timestamptz, ${at}::timestamptz)`,
      );
    },

    url: (file) => urls.url({ id: file.id, workspaceId: file.workspaceId, public: file.public }),

    removePersonal: async (userId, fileId, now) => {
      if (!UUID.test(fileId)) {
        return null;
      }

      const at = now.toISOString();
      const rows = await runRaw<{ storage_key: string }>(
        db,
        sql`UPDATE file SET deleted_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
          WHERE id = ${fileId}::uuid AND kind = 'avatar' AND workspace_id IS NULL AND deleted_at IS NULL
            AND created_by->>'kind' = 'user' AND created_by->>'id' = ${userId}
          RETURNING storage_key`,
      );

      return rows[0]?.storage_key ?? null;
    },

    remove: async (tx, id, actor, now) => {
      const at = now.toISOString();
      const rows = await runRaw<{ storage_key: string }>(
        tx,
        sql`UPDATE file SET deleted_at = ${at}::timestamptz, updated_at = ${at}::timestamptz, updated_by = ${JSON.stringify(actor)}::jsonb
          WHERE id = ${id}::uuid AND deleted_at IS NULL RETURNING storage_key`,
      );
      const row = rows[0];

      if (!row) {
        throw notFound('File', id);
      }

      return row.storage_key;
    },

    openByLink: async (id, exp, sig) => {
      if (!UUID.test(id)) {
        throw new EngineError('VALIDATION', `Invalid file id "${id}"`, { id });
      }

      const rows = await runRaw<{
        id: string;
        workspace_id: string | null;
        public: boolean;
        name: string;
        content_type: string;
        size: unknown;
        checksum: string;
        storage_key: string;
      }>(
        db,
        sql`SELECT id, workspace_id, public, name, content_type, size, checksum, storage_key
          FROM file WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
      const row = rows[0];

      if (!row) {
        throw notFound('File', id);
      }

      if (!row.public && !urls.verify({ id, workspaceId: row.workspace_id }, exp ?? '', sig ?? '')) {
        throw new EngineError('FORBIDDEN', 'This link is not valid or has expired');
      }

      return opened(
        {
          id: row.id,
          workspaceId: row.workspace_id,
          public: row.public,
          contentType: row.content_type,
          size: toNumber(row.size),
          checksum: row.checksum,
          storageKey: row.storage_key,
        },
        row.name,
      );
    },

    usage: async (workspaceId) => ({ ...(await usage(workspaceId)), quotaBytes }),

    purgeWorkspace: async (workspaceId) => {
      await store.deletePrefix(workspaceId);
    },

    sweep: async () => {
      const cutoff = clock().getTime() - sweepGraceMs;
      const result: FileSweepResult = { orphans: 0, finished: 0, staged: 0 };
      let batch: { key: string; modifiedAt: Date }[] = [];

      const settle = async () => {
        const objects = batch;
        batch = [];
        const ids = [
          ...new Set(
            objects.map((object) => fileIdOfKey(object.key)).filter((id): id is string => id !== null && UUID.test(id)),
          ),
        ];
        const rows =
          ids.length === 0
            ? []
            : await runRaw<{ id: string; deleted_at: unknown }>(
                db,
                sql`SELECT id, deleted_at FROM file WHERE id IN (${sql.join(
                  ids.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`,
              );
        const known = new Map(rows.map((row) => [row.id, row.deleted_at !== null]));

        for (const object of objects) {
          const id = fileIdOfKey(object.key);

          if (object.key.startsWith(`${STAGING_PREFIX}/`)) {
            if (object.modifiedAt.getTime() < cutoff) {
              await store.delete(object.key);
              result.staged += 1;
            }
          } else if (id !== null && UUID.test(id)) {
            const removed = known.get(id);

            if (removed === undefined && object.modifiedAt.getTime() < cutoff) {
              await store.delete(object.key);
              result.orphans += 1;
            } else if (removed === true) {
              await store.delete(object.key);
              result.finished += 1;
            }
          }
        }
      };

      for await (const object of store.list('')) {
        batch.push(object);

        if (batch.length >= 200) {
          await settle();
        }
      }

      await settle();

      return result;
    },
  };
};
