/**
 * Where the bytes of files live. Objects are named by a key of `/`-separated parts (`<scope>/<xx>/<file>/original`);
 * a part is never empty, `.` or `..`. Writing is atomic (nothing is readable under a key until all of it is written),
 * and every operation that names nothing that exists is a quiet no-op, so a retry or a sweep is always safe.
 */

/** An inclusive range of bytes within an object. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface StoredObject {
  key: string;
  size: number;
  modifiedAt: Date;
}

export interface FileStore {
  /** Writes the whole stream under `key`, replacing what is there; on any failure nothing is left under it. Returns the bytes written. */
  put(key: string, body: ReadableStream<Uint8Array>): Promise<{ size: number }>;
  /** The bytes under `key`, or only `range` of them; `size` is that of the whole object. Null when there is no such object. */
  get(key: string, range?: ByteRange): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  exists(key: string): Promise<boolean>;
  /** The size of the object under `key`, or null when there is none. */
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  /** Deletes every object whose key starts with `prefix/`. The prefix must name at least one part. */
  deletePrefix(prefix: string): Promise<void>;
  /** Every object whose key starts with `prefix/` (all of them for an empty prefix), in no particular order. */
  list(prefix: string): AsyncIterable<StoredObject>;
}

/** Where objects being written wait until they are complete: the sweeper removes the ones a crash left. */
export const STAGING_PREFIX = '.tmp';

/** The key parts of `key`, refusing anything that could leave the store. */
export const keyParts = (key: string): string[] => {
  const parts = key.split('/');

  if (parts.length === 0 || parts.some((part) => part === '' || part === '.' || part === '..' || /[\\\0]/.test(part))) {
    throw new Error(`Invalid file store key "${key}"`);
  }

  return parts;
};

/** Where a file belongs: a workspace, or (for what belongs to no workspace, like an account picture) a person. */
export const scopeOf = (owner: { workspaceId: string | null; userId?: string }): string => {
  if (owner.workspaceId !== null) {
    return owner.workspaceId;
  }

  if (!owner.userId) {
    throw new Error('A file with no workspace needs the person it belongs to');
  }

  // `~` cannot be in a workspace id, so no person's folder is ever a workspace's.
  return `user~${owner.userId}`;
};

/** The prefix under which everything of one file lives, from its scope and its id (uuid v7 starts with a timestamp, so the fan-out uses the random end). */
export const filePrefixOf = (scope: string, fileId: string): string => `${scope}/${fileId.slice(-2)}/${fileId}`;

export const originalKeyOf = (prefix: string): string => `${prefix}/original`;

/** The file an object belongs to, from its key, or null for a key that is not one of a file's. */
export const fileIdOfKey = (key: string): string | null => {
  const parts = key.split('/');

  return parts.length >= 4 && parts[0] !== STAGING_PREFIX ? (parts[2] as string) : null;
};
