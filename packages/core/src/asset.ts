import { z } from 'zod';
import { ActorSchema } from './events';
import { isTextFile } from './file';

/**
 * An asset: a workspace's library entry for a file (see `file.ts`). The file's bytes never change; the asset's name and
 * description do. Assets are what a workspace manages, like documents: they are listed in the Assets page, referenced from
 * records, actions and text, and what an agent lists. An account picture or a workspace logo is a file with no asset.
 * An asset shows its file's type, size, checksum and dimensions as its own.
 */

export const ASSET_NAME_MAX = 255;
export const ASSET_DESCRIPTION_MAX = 2000;
export const ASSETS_DEFAULT_LIMIT = 50;
export const ASSETS_MAX_LIMIT = 100;
export const ASSET_IDS_MAX = 100;
/** How long a link a person asks for lasts unless they say, and the longest it may last. */
export const ASSET_LINK_DEFAULT_TTL_SECONDS = 600;
export const ASSET_LINK_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** What kind of file it is, for filtering the library. */
export const ASSET_TYPE_GROUPS = ['image', 'pdf', 'text', 'other'] as const;
export type AssetTypeGroup = (typeof ASSET_TYPE_GROUPS)[number];

export const assetGroupOf = (contentType: string): AssetTypeGroup =>
  contentType.startsWith('image/')
    ? 'image'
    : contentType === 'application/pdf'
      ? 'pdf'
      : isTextFile(contentType)
        ? 'text'
        : 'other';

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/**
 * A file name that is safe to store and to put in a header: the last part of a path, without control characters,
 * shortened to `ASSET_NAME_MAX` characters (the extension kept), `file` when nothing is left.
 */
export const assetNameOf = (raw: string): string => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  const base = cleaned.slice(Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\')) + 1).trim();

  if (base === '' || base === '.' || base === '..') {
    return 'file';
  }

  if (base.length <= ASSET_NAME_MAX) {
    return base;
  }

  const dot = base.lastIndexOf('.');
  const extension = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : '';

  return `${base.slice(0, ASSET_NAME_MAX - extension.length)}${extension}`;
};

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const VersionSchema = z.number().int().min(1);

export const AssetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    /** Detected from the bytes when it was stored. */
    contentType: z.string(),
    size: z.number().int(),
    /** SHA-256 of the bytes, hex. */
    checksum: z.string(),
    /** Pixels, for pictures the image library could read. */
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** Counts every write to the name and description; `expectedVersion` on a change names the one it was made from. */
    version: VersionSchema,
    createdBy: ActorSchema,
    updatedBy: ActorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    /** A link to the bytes that works in an `<img>` or a viewer without credentials until it expires; the same link all day, so browsers keep the file. */
    url: z.string(),
  })
  .meta({ id: 'Asset' });
export type Asset = z.infer<typeof AssetSchema>;

/** What a record that holds an asset needs to draw it, without one request per file. */
export const AssetSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** True for a file that was removed: the reference stays and reads as "file removed". */
    deleted: z.boolean(),
    /** Empty for a removed file. */
    url: z.string(),
  })
  .meta({ id: 'AssetSummary' });
export type AssetSummary = z.infer<typeof AssetSummarySchema>;

export const AssetQuerySchema = z
  .object({
    /** Words of the name or the description. */
    search: z.string().trim().min(1).max(200).optional(),
    /** Only these assets: ids separated by commas, at most 100. */
    ids: z.string().min(1).optional(),
    /** Only one kind of file. */
    type: z.enum(ASSET_TYPE_GROUPS).optional(),
    /** Only what this person (`user:<id>`, or a bare user id) uploaded. */
    createdBy: z.string().min(1).max(200).optional(),
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(ASSETS_MAX_LIMIT).optional(),
  })
  .meta({ id: 'AssetQuery' });
export type AssetQuery = z.infer<typeof AssetQuerySchema>;

export const AssetPageSchema = z
  .object({
    items: z.array(AssetSchema),
    nextCursor: z.string().nullable(),
    /** How many assets match in all. */
    total: z.number().int(),
  })
  .meta({ id: 'AssetPage' });
export type AssetPage = z.infer<typeof AssetPageSchema>;

export const AssetPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the file a name').max(ASSET_NAME_MAX).optional(),
    description: z.string().max(ASSET_DESCRIPTION_MAX).optional(),
    /** The version this change was made from; a newer one makes it a `CONFLICT`. Leave it out to overwrite. */
    expectedVersion: VersionSchema.optional(),
  })
  .refine(
    (patch) => Object.entries(patch).some(([key, value]) => key !== 'expectedVersion' && value !== undefined),
    'Nothing to change',
  )
  .meta({ id: 'AssetPatch' });
export type AssetPatch = z.infer<typeof AssetPatchSchema>;

/** What an upload names; the bytes are the body. */
export const AssetUploadQuerySchema = z
  .object({
    /** The file's name; the content type is detected from the bytes. */
    name: z.string().trim().min(1).max(1000),
    description: z.string().max(ASSET_DESCRIPTION_MAX).optional(),
  })
  .meta({ id: 'AssetUploadQuery' });
export type AssetUploadQuery = z.infer<typeof AssetUploadQuerySchema>;

export const AssetLinkInputSchema = z
  .object({
    /** How long the link works, in seconds: 10 minutes unless said, at most 7 days. */
    ttlSeconds: z.number().int().min(60).max(ASSET_LINK_MAX_TTL_SECONDS).optional(),
  })
  .meta({ id: 'AssetLinkInput' });
export type AssetLinkInput = z.infer<typeof AssetLinkInputSchema>;

export const AssetLinkSchema = z
  .object({
    /** Opens the file without credentials until `expiresAt`. */
    url: z.string(),
    expiresAt: z.string(),
  })
  .meta({ id: 'AssetLink' });
export type AssetLink = z.infer<typeof AssetLinkSchema>;

/** Where an asset is used: the records that hold it and the text that links to it. */
export const AssetUsageSchema = z
  .object({
    records: z.array(z.object({ object: z.string(), field: z.string(), recordId: z.string() })),
    mentions: z.array(
      z.object({ kind: z.enum(['document', 'task', 'comment']), id: z.string(), role: z.enum(['mention', 'about']) }),
    ),
    total: z.number().int(),
  })
  .meta({ id: 'AssetUsage' });
export type AssetUsage = z.infer<typeof AssetUsageSchema>;

/** What a workspace stores. */
export const AssetsUsageSchema = z
  .object({
    count: z.number().int(),
    bytes: z.number().int(),
    /** The most it may store; null while unlimited. */
    quotaBytes: z.number().int().nullable(),
  })
  .meta({ id: 'AssetsUsage' });
export type AssetsUsage = z.infer<typeof AssetsUsageSchema>;

/** Asset cursors continue after one asset: when it changed, then its id as the tie-break. */
export const encodeAssetCursor = (updatedAt: string, id: string): string => `${updatedAt}|${id}`;
export const decodeAssetCursor = (cursor: string): { updatedAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('|');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const updatedAt = cursor.slice(0, at);

  return Number.isNaN(Date.parse(updatedAt)) ? undefined : { updatedAt, id: cursor.slice(at + 1) };
};

/** The ids of an `AssetQuery.ids`. */
export const assetIdsOf = (ids: string | undefined): string[] =>
  ids === undefined
    ? []
    : [
        ...new Set(
          ids
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
