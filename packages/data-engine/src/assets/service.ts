import {
  type Actor,
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
  type AssetSummary,
  type AssetsUsage,
  type AssetUploadQuery,
  AssetUploadQuerySchema,
  type AssetUsage,
  assetIdsOf,
  assetNameOf,
  decodeAssetCursor,
  encodeAssetCursor,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { inEventTransaction } from '../events/transaction';
import type { FileService, OpenedFile } from '../files/service';
import type { FileUrlSigner } from '../files/urls';
import { UUID } from '../links';
import { authorize } from '../permissions/policy';

/** What an upload or a creation from code names; the bytes are `body`. */
export interface AssetCreateInput extends AssetUploadQuery {
  /** A stream (an upload), bytes, or text (saved as UTF-8). */
  body: ReadableStream<Uint8Array> | Uint8Array | string;
}

export interface AssetService {
  /** Stores a file (counting and hashing it while it streams, detecting its type) and adds it to the workspace's assets. */
  create(ctx: EngineContext, input: AssetCreateInput): Promise<Asset>;
  get(ctx: EngineContext, id: string): Promise<Asset>;
  /** Newest change first. */
  list(ctx: EngineContext, query?: AssetQuery): Promise<AssetPage>;
  /** What a record needs to draw the assets it holds, by id; removed ones are marked `deleted`, unknown ids are left out. */
  summaries(ctx: EngineContext, ids: readonly string[]): Promise<Record<string, AssetSummary>>;
  update(ctx: EngineContext, id: string, patch: AssetPatch): Promise<Asset>;
  /** Refused with `CONFLICT` while something uses it, unless `force`. The asset stays, as a tombstone; the bytes go. */
  delete(ctx: EngineContext, id: string, options?: { force?: boolean }): Promise<void>;
  /** Checks the caller may read it and gives its bytes. */
  open(ctx: EngineContext, id: string): Promise<OpenedFile>;
  /** A link a person can share, valid for `ttlSeconds` (default 10 minutes). */
  link(ctx: EngineContext, id: string, input?: AssetLinkInput): Promise<AssetLink>;
  usage(ctx: EngineContext, id: string): Promise<AssetUsage>;
  /** What the workspace stores, and its quota. */
  workspaceUsage(ctx: EngineContext): Promise<AssetsUsage>;
}

export interface AssetServiceDeps {
  db: Db;
  bus: EventBus;
  clock: () => Date;
  files: FileService;
  urls: FileUrlSigner;
}

/** A file of the kind `asset`. */
interface AssetRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  version: unknown;
  created_by: unknown;
  updated_by: unknown;
  created_at: unknown;
  updated_at: unknown;
  deleted_at?: unknown;
  public: boolean;
  content_type: string;
  size: unknown;
  checksum: string;
  storage_key: string;
  width: number | null;
  height: number | null;
}

const COLUMNS = sql.raw(
  'f.id, f.workspace_id, f.name, f.description, f.version, f.created_by, f.updated_by, f.created_at, f.updated_at, f.deleted_at, f.public, f.content_type, f.size, f.checksum, f.storage_key, f.width, f.height',
);
const FROM = sql.raw('file f');

/** The most places an asset's usage lists; the total counts them all. */
const USAGE_LIST_MAX = 100;

const assertUuid = (id: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid asset id "${id}"`, { id });
  }
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Assets: what a workspace keeps in its library: the files of kind `asset`, which people and agents manage, link to and
 * list. The bytes and the row are the file layer's (see `FileService`); this is who may do what with them, and the queries
 * over the library. Logos and pictures are files too, and nothing here reaches them: every query says `kind = 'asset'`.
 */
export const createAssetService = (deps: AssetServiceDeps): AssetService => {
  const { db, bus, clock, files, urls } = deps;

  const toAsset = (row: AssetRow): Asset => ({
    id: row.id,
    name: row.name,
    description: row.description,
    contentType: row.content_type,
    size: toNumber(row.size),
    checksum: row.checksum,
    width: row.width,
    height: row.height,
    version: toNumber(row.version),
    createdBy: parseJson<Actor>(row.created_by),
    updatedBy: parseJson<Actor>(row.updated_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    url: urls.url({ id: row.id, workspaceId: row.workspace_id, public: row.public }),
  });

  const load = async (tx: Db, ctx: EngineContext, id: string): Promise<AssetRow> => {
    const rows = await runRaw<AssetRow>(
      tx,
      sql`SELECT ${COLUMNS} FROM ${FROM} WHERE f.id = ${id}::uuid AND f.workspace_id = ${ctx.workspaceId} AND f.kind = 'asset' AND f.deleted_at IS NULL`,
    );
    const row = rows[0];

    if (!row) {
      throw notFound('Asset', id);
    }

    return row;
  };

  const withEvent = <T>(
    ctx: EngineContext,
    change: 'created' | 'updated' | 'deleted',
    assetId: string,
    write: (tx: Db, now: Date) => Promise<T>,
  ): Promise<T> =>
    inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => ({
      value: await write(tx, now),
      events: [{ type: 'asset.changed', entity: 'asset', entityId: assetId, payload: { change } }],
    }));

  const assertVersion = (row: AssetRow, expected: number | undefined) => {
    if (expected !== undefined && toNumber(row.version) !== expected) {
      throw new EngineError('CONFLICT', 'This asset was changed by someone else since it was read', {
        currentVersion: toNumber(row.version),
      });
    }
  };

  /** Where an asset is used: the documents and tasks whose text mentions it, or that are about it. */
  const usageOf = async (ctx: EngineContext, id: string, exec: Db = db): Promise<AssetUsage> => {
    const where = sql`workspace_id = ${ctx.workspaceId} AND kind = 'asset' AND target_id = ${id}::uuid`;
    const rows = await runRaw<{ entity_kind: 'document' | 'task'; entity_id: string; role: 'mention' | 'about' }>(
      exec,
      sql`SELECT entity_kind, entity_id, role FROM mention WHERE ${where} ORDER BY entity_kind, entity_id, role LIMIT ${USAGE_LIST_MAX}`,
    );
    const totals = await runRaw<{ total: unknown }>(exec, sql`SELECT count(*) AS total FROM mention WHERE ${where}`);

    return {
      records: [],
      mentions: rows.map((row) => ({ kind: row.entity_kind, id: row.entity_id, role: row.role })),
      total: toNumber(totals[0]?.total),
    };
  };

  const typeFilter = (type: NonNullable<AssetQuery['type']>): SQL => {
    const image = sql`f.content_type LIKE 'image/%'`;
    const pdf = sql`f.content_type = 'application/pdf'`;
    const text = sql`(f.content_type NOT LIKE 'image/%' AND (f.content_type LIKE 'text/%' OR f.content_type IN ('application/json', 'application/xml')))`;

    return type === 'image'
      ? image
      : type === 'pdf'
        ? pdf
        : type === 'text'
          ? text
          : sql`NOT (${image}) AND NOT (${pdf}) AND NOT (${text})`;
  };

  return {
    create: async (ctx, input) => {
      authorize(ctx, 'asset.write');
      const parsed = AssetUploadQuerySchema.safeParse({ name: input.name, description: input.description });

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid asset');
      }

      const name = assetNameOf(parsed.data.name);
      const written = await files.write({ workspaceId: ctx.workspaceId, actor: ctx.actor }, { name, body: input.body });

      try {
        return await withEvent(ctx, 'created', written.id, async (tx, now) => {
          await files.add(tx, written, { kind: 'asset', description: parsed.data.description ?? '' }, ctx.actor, now);

          return toAsset(await load(tx, ctx, written.id));
        });
      } catch (error) {
        await files.discard(written.prefix, `file "${written.id}" that was not stored`);
        throw error;
      }
    },

    get: async (ctx, id) => {
      authorize(ctx, 'asset.read');
      assertUuid(id);

      return toAsset(await load(db, ctx, id));
    },

    list: async (ctx, query = {}) => {
      authorize(ctx, 'asset.read');
      const parsed = AssetQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid assets query');
      }

      const { search, type, createdBy } = parsed.data;
      const ids = assetIdsOf(parsed.data.ids);

      if (ids.length > ASSET_IDS_MAX) {
        throw validationError(`Name at most ${ASSET_IDS_MAX} ids`, { path: 'ids' });
      }

      for (const id of ids) {
        assertUuid(id);
      }

      const after = parsed.data.cursor === undefined ? undefined : decodeAssetCursor(parsed.data.cursor);

      if (parsed.data.cursor !== undefined && after === undefined) {
        throw new EngineError('INVALID_CURSOR', 'The assets cursor is malformed');
      }

      const filters: SQL[] = [
        sql`f.workspace_id = ${ctx.workspaceId}`,
        sql`f.kind = 'asset'`,
        sql`f.deleted_at IS NULL`,
      ];

      if (search) {
        const needle = `%${escapeLike(search)}%`;
        filters.push(sql`(f.name ILIKE ${needle} ESCAPE '\\' OR f.description ILIKE ${needle} ESCAPE '\\')`);
      }

      if (type) {
        filters.push(typeFilter(type));
      }

      if (createdBy) {
        const colon = createdBy.indexOf(':');
        const kind = colon < 0 ? 'user' : createdBy.slice(0, colon);
        const who = colon < 0 ? createdBy : createdBy.slice(colon + 1);
        filters.push(sql`f.created_by->>'kind' = ${kind} AND f.created_by->>'id' = ${who}`);
      }

      if (ids.length > 0) {
        filters.push(
          sql`f.id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
      }

      const where = sql.join(filters, sql` AND `);
      const limit = parsed.data.limit ?? ASSETS_DEFAULT_LIMIT;
      const rows = await runRaw<AssetRow>(
        db,
        sql`SELECT ${COLUMNS} FROM ${FROM}
          WHERE ${where}
            ${after === undefined ? sql`` : sql`AND (f.updated_at, f.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`}
          ORDER BY f.updated_at DESC, f.id DESC
          LIMIT ${limit + 1}`,
      );
      const totals = await runRaw<{ total: unknown }>(db, sql`SELECT count(*) AS total FROM ${FROM} WHERE ${where}`);
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map(toAsset),
        nextCursor: rows.length > limit && last ? encodeAssetCursor(toIso(last.updated_at), last.id) : null,
        total: toNumber(totals[0]?.total ?? 0),
      };
    },

    summaries: async (ctx, ids) => {
      authorize(ctx, 'asset.read');
      const wanted = [...new Set(ids)].filter((id) => UUID.test(id));

      if (wanted.length === 0) {
        return {};
      }

      const rows = await runRaw<AssetRow>(
        db,
        sql`SELECT ${COLUMNS} FROM ${FROM} WHERE f.workspace_id = ${ctx.workspaceId} AND f.kind = 'asset'
          AND f.id IN (${sql.join(
            wanted.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
      );

      return Object.fromEntries(
        rows.map((row) => {
          const deleted = row.deleted_at !== null && row.deleted_at !== undefined;

          return [
            row.id,
            {
              id: row.id,
              name: row.name,
              contentType: row.content_type,
              size: toNumber(row.size),
              width: row.width,
              height: row.height,
              deleted,
              url: deleted ? '' : urls.url({ id: row.id, workspaceId: row.workspace_id, public: row.public }),
            },
          ];
        }),
      );
    },

    update: async (ctx, id, patch) => {
      authorize(ctx, 'asset.write');
      assertUuid(id);
      const parsed = AssetPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid asset change');
      }

      return withEvent(ctx, 'updated', id, async (tx, now) => {
        const row = await load(tx, ctx, id);
        assertVersion(row, parsed.data.expectedVersion);
        const name = parsed.data.name === undefined ? row.name : assetNameOf(parsed.data.name);
        const description = parsed.data.description ?? row.description;
        await runRaw(
          tx,
          sql`UPDATE file SET name = ${name}, description = ${description}, version = version + 1,
              updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${id}::uuid`,
        );

        return toAsset(await load(tx, ctx, id));
      });
    },

    delete: async (ctx, id, options = {}) => {
      authorize(ctx, 'asset.write');
      assertUuid(id);
      const prefix = await withEvent(ctx, 'deleted', id, async (tx, now) => {
        await load(tx, ctx, id);
        const usage = await usageOf(ctx, id, tx);

        if (usage.total > 0 && !options.force) {
          throw new EngineError(
            'CONFLICT',
            'This asset is in use; remove it from where it is used, or delete it anyway',
            { usage },
          );
        }

        return files.remove(tx, id, ctx.actor, now);
      });

      await files.discard(prefix, `asset "${id}"`);
    },

    open: async (ctx, id) => {
      authorize(ctx, 'asset.read');
      assertUuid(id);
      const row = await load(db, ctx, id);

      return files.opened(
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

    link: async (ctx, id, input = {}) => {
      authorize(ctx, 'asset.read');
      assertUuid(id);
      const parsed = AssetLinkInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid link');
      }

      const row = await load(db, ctx, id);

      return urls.link({ id: row.id, workspaceId: row.workspace_id }, parsed.data.ttlSeconds);
    },

    usage: async (ctx, id) => {
      authorize(ctx, 'asset.read');
      assertUuid(id);
      await load(db, ctx, id);

      return usageOf(ctx, id);
    },

    workspaceUsage: async (ctx) => {
      authorize(ctx, 'asset.read');
      const counted = await runRaw<{ count: unknown }>(
        db,
        sql`SELECT count(*) AS count FROM file WHERE workspace_id = ${ctx.workspaceId} AND kind = 'asset' AND deleted_at IS NULL`,
      );
      const stored = await files.usage(ctx.workspaceId);

      return { count: toNumber(counted[0]?.count), bytes: stored.bytes, quotaBytes: stored.quotaBytes };
    },
  };
};
