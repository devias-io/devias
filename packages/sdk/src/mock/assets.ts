import {
  ASSET_IDS_MAX,
  ASSETS_DEFAULT_LIMIT,
  type Asset,
  type AssetLink,
  type AssetLinkInput,
  AssetLinkInputSchema,
  type AssetPage,
  type AssetPatch,
  AssetPatchSchema,
  type AssetQuery,
  AssetQuerySchema,
  type AssetsUsage,
  type AssetUploadInput,
  AssetUploadQuerySchema,
  type AssetUsage,
  assetIdsOf,
  assetNameOf,
  DeviasApiError,
  decodeAssetCursor,
  detectFileType,
  encodeAssetCursor,
  FILE_MAX_BYTES_DEFAULT,
  isTextFile,
  linkOfMention,
  mentionsOf,
} from '@devias/core';
import type { MockAsset, MockStore } from './store';

/** Files over the store's asset list, with the server's validation, paging, search and errors. Bytes stay in memory. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

const assertUuid = (id: string) => {
  if (!UUID.test(id)) {
    throw validation(`Invalid asset id "${id}"`, { id });
  }
};

const find = (store: MockStore, id: string): MockAsset => {
  assertUuid(id);
  const asset = store.assets.find((candidate) => candidate.id === id && !candidate.deleted);

  if (!asset) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Asset "${id}" not found`);
  }

  return asset;
};

const urls = new WeakMap<MockAsset, string>();

/** An address that opens the bytes: an object URL in a browser, a data URL anywhere else. */
const urlOf = (asset: MockAsset): string => {
  const known = urls.get(asset);

  if (known !== undefined) {
    return known;
  }

  let url: string | undefined;

  if (typeof window !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      url = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.contentType }));
    } catch {
      // an environment that has the function but not the Blob it takes (jsdom): a data URL does as well
    }
  }

  url ??= `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString('base64')}`;
  urls.set(asset, url);

  return url;
};

const publicAsset = (asset: MockAsset): Asset => {
  const { bytes: _bytes, deleted: _deleted, ...rest } = asset;

  return { ...structuredClone(rest), url: urlOf(asset) };
};

const bytesOf = async (body: AssetUploadInput['body']): Promise<Uint8Array> =>
  typeof body === 'string'
    ? new TextEncoder().encode(body)
    : body instanceof Uint8Array
      ? new Uint8Array(body)
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new Uint8Array(await body.arrayBuffer());

export const uploadAsset = async (store: MockStore, input: AssetUploadInput): Promise<Asset> => {
  const parsed = AssetUploadQuerySchema.safeParse({ name: input.name, description: input.description });

  if (!parsed.success) {
    throw validation('Invalid file', parsed.error.issues);
  }

  const bytes = await bytesOf(input.body);

  if (bytes.byteLength > FILE_MAX_BYTES_DEFAULT) {
    throw validation(`A file may be at most ${Math.round(FILE_MAX_BYTES_DEFAULT / 1024 / 1024)} MB`, {
      maxBytes: FILE_MAX_BYTES_DEFAULT,
    });
  }

  const name = assetNameOf(parsed.data.name);
  const contentType = detectFileType(bytes.subarray(0, 8192), name);
  const now = store.now();
  const asset: MockAsset = {
    id: store.newId(),
    name,
    description: parsed.data.description ?? '',
    contentType,
    size: bytes.byteLength,
    checksum: await sha256(bytes),
    width: null,
    height: null,
    version: 1,
    createdBy: structuredClone(store.actor),
    updatedBy: structuredClone(store.actor),
    createdAt: now,
    updatedAt: now,
    bytes,
  };
  store.assets.push(asset);
  store.emit({ type: 'asset.changed', assetId: asset.id, change: 'created' });

  return publicAsset(asset);
};

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const typeMatches = (asset: MockAsset, type: NonNullable<AssetQuery['type']>): boolean => {
  const image = asset.contentType.startsWith('image/');
  const pdf = asset.contentType === 'application/pdf';
  const text = !image && isTextFile(asset.contentType);

  return type === 'image' ? image : type === 'pdf' ? pdf : type === 'text' ? text : !image && !pdf && !text;
};

export const listAssets = (store: MockStore, query: AssetQuery = {}): AssetPage => {
  const parsed = AssetQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid files query', parsed.error.issues);
  }

  const ids = assetIdsOf(parsed.data.ids);

  if (ids.length > ASSET_IDS_MAX) {
    throw validation(`Name at most ${ASSET_IDS_MAX} ids`, { path: 'ids' });
  }

  for (const id of ids) {
    assertUuid(id);
  }

  const after = parsed.data.cursor === undefined ? undefined : decodeAssetCursor(parsed.data.cursor);

  if (parsed.data.cursor !== undefined && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The files cursor is malformed');
  }

  const needle = parsed.data.search?.toLowerCase();
  const createdBy = parsed.data.createdBy;
  const who = createdBy === undefined ? undefined : createdBy.includes(':') ? createdBy : `user:${createdBy}`;
  const matching = store.assets
    .filter((asset) => !asset.deleted)
    .filter((asset) => ids.length === 0 || ids.includes(asset.id))
    .filter((asset) => !parsed.data.type || typeMatches(asset, parsed.data.type))
    .filter((asset) => who === undefined || `${asset.createdBy.kind}:${asset.createdBy.id}` === who)
    .filter(
      (asset) =>
        needle === undefined ||
        asset.name.toLowerCase().includes(needle) ||
        asset.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1));
  const limit = parsed.data.limit ?? ASSETS_DEFAULT_LIMIT;
  const rest = after
    ? matching.filter(
        (asset) => asset.updatedAt < after.updatedAt || (asset.updatedAt === after.updatedAt && asset.id < after.id),
      )
    : matching;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(publicAsset),
    nextCursor: rest.length > limit && last ? encodeAssetCursor(last.updatedAt, last.id) : null,
    total: matching.length,
  };
};

export const getAsset = (store: MockStore, id: string): Asset => publicAsset(find(store, id));

export const updateAsset = (store: MockStore, id: string, patch: AssetPatch): Asset => {
  assertUuid(id);
  const parsed = AssetPatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw validation('Invalid file change', parsed.error.issues);
  }

  const asset = find(store, id);

  if (parsed.data.expectedVersion !== undefined && asset.version !== parsed.data.expectedVersion) {
    throw new DeviasApiError(409, 'CONFLICT', 'This file was changed by someone else since it was read', {
      currentVersion: asset.version,
    });
  }

  if (parsed.data.name !== undefined) {
    asset.name = assetNameOf(parsed.data.name);
  }

  if (parsed.data.description !== undefined) {
    asset.description = parsed.data.description;
  }

  asset.version += 1;
  asset.updatedBy = structuredClone(store.actor);
  asset.updatedAt = store.now();
  store.emit({ type: 'asset.changed', assetId: asset.id, change: 'updated' });

  return publicAsset(asset);
};

/** The documents and tasks that mention an asset or are about it, as the server's index finds them. */
const usageOf = (store: MockStore, id: string): AssetUsage => {
  const mentions: AssetUsage['mentions'] = [];

  for (const document of store.documents) {
    if (
      !document.deleted &&
      mentionsOf(document.body).some((mention) => {
        const target = linkOfMention(mention.object, mention.id);

        return target.kind === 'asset' && target.id === id;
      })
    ) {
      mentions.push({ kind: 'document', id: document.id, role: 'mention' });
    }
  }

  for (const task of store.tasks) {
    if (task.deleted) {
      continue;
    }

    for (const link of task.links) {
      if (link.link === `asset:${id}`) {
        mentions.push({ kind: 'task', id: task.id, role: link.role });
      }
    }
  }

  return { records: [], mentions, total: mentions.length };
};

export const deleteAsset = (store: MockStore, id: string, options: { force?: boolean } = {}): void => {
  const asset = find(store, id);
  const usage = usageOf(store, id);

  if (usage.total > 0 && !options.force) {
    throw new DeviasApiError(
      409,
      'CONFLICT',
      'This asset is in use; remove it from where it is used, or delete it anyway',
      { usage },
    );
  }

  asset.deleted = true;
  asset.updatedAt = store.now();
  store.emit({ type: 'asset.changed', assetId: asset.id, change: 'deleted' });
};

export const linkAsset = (store: MockStore, id: string, input: AssetLinkInput = {}): AssetLink => {
  assertUuid(id);
  const parsed = AssetLinkInputSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid link', parsed.error.issues);
  }

  const asset = find(store, id);

  return {
    url: urlOf(asset),
    expiresAt: new Date(Date.parse(store.now()) + (parsed.data.ttlSeconds ?? 600) * 1000).toISOString(),
  };
};

export const assetUsage = (store: MockStore, id: string): AssetUsage => {
  find(store, id);

  return usageOf(store, id);
};

export const workspaceAssetUsage = (store: MockStore): AssetsUsage => {
  const live = store.assets.filter((asset) => !asset.deleted);

  return { count: live.length, bytes: live.reduce((sum, asset) => sum + asset.size, 0), quotaBytes: null };
};
