import {
  type Actor,
  decodeRecordCommentCursor,
  encodeRecordCommentCursor,
  newId,
  RECORD_COMMENTS_DEFAULT_LIMIT,
  type RecordComment,
  type RecordCommentInput,
  RecordCommentInputSchema,
  type RecordCommentPage,
  type RecordCommentPatch,
  RecordCommentPatchSchema,
  type RecordCommentQuery,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import { isAdmin, sameActor } from '../authorship';
import type { EngineContext } from '../context';
import type { DataSource } from '../datasource/interface';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, lockWorkspace, writeEvents } from '../events/feed';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import { resolveObject } from '../query/validate';

export interface RecordCommentService {
  list(ctx: EngineContext, object: string, id: string, query?: RecordCommentQuery): Promise<RecordCommentPage>;
  create(ctx: EngineContext, object: string, id: string, input: RecordCommentInput): Promise<RecordComment>;
  update(
    ctx: EngineContext,
    object: string,
    id: string,
    commentId: string,
    patch: RecordCommentPatch,
  ): Promise<RecordComment>;
  delete(ctx: EngineContext, object: string, id: string, commentId: string): Promise<void>;
}

export interface RecordCommentServiceDeps {
  db: Db;
  metadata: MetadataService;
  dataSource: DataSource;
  bus: EventBus;
  clock: () => Date;
}

interface RecordCommentRow extends Record<string, unknown> {
  id: string;
  record_id: string;
  author: unknown;
  title: string;
  body: string;
  created_at: unknown;
  updated_at: unknown;
}

/** A comment as the service reads it: the comment table's columns under the comment's names. */
const RECORD_COMMENT_COLUMNS = sql.raw(
  'id, entity_id AS record_id, actor AS author, title, body, created_at, COALESCE(edited_at, created_at) AS updated_at',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid ${what} id "${id}"`, { id });
  }
};

/** A record's comments, newest first. Comments belong to the record: its permissions decide who reads and writes them. */
export const createRecordCommentService = (deps: RecordCommentServiceDeps): RecordCommentService => {
  const { db, metadata, dataSource, bus, clock } = deps;

  const resolve = async (ctx: EngineContext, objectName: string) => {
    const snapshot = await metadata.getSnapshot(ctx.workspaceId);

    return resolveObject(snapshot.index, objectName);
  };

  const toRecordComment = (objectName: string, row: RecordCommentRow): RecordComment => ({
    id: row.id,
    object: objectName,
    recordId: row.record_id,
    title: row.title,
    body: row.body,
    author: parseJson<Actor>(row.author),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });

  /** Writes one comment event in its own transaction, together with `write`. */
  const withRecordCommentEvent = async <T>(
    ctx: EngineContext,
    event: {
      type: 'comment.created' | 'comment.updated' | 'comment.deleted';
      objectId: string;
      objectName: string;
      recordId: string;
      commentId: string;
    },
    write: (tx: Db, now: Date) => Promise<T>,
  ): Promise<{ value: T; now: Date }> => {
    const now = clock();
    const { value, sequence } = await db.transaction(async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const written = await write(tx, now);
      const seq = await allocateSequences(tx, ctx.workspaceId, 1);
      await writeEvents(tx, ctx.workspaceId, [
        {
          sequence: seq,
          type: event.type,
          actor: ctx.actor,
          occurredAt: now,
          objectId: event.objectId,
          objectName: event.objectName,
          recordId: event.recordId,
          entity: 'comment',
          entityId: event.commentId,
        },
      ]);
      await bus.publish(tx, ctx.workspaceId, { seq });

      return { value: written, sequence: seq };
    });
    bus.emitLocal(ctx.workspaceId, { seq: sequence });

    return { value, now };
  };

  const loadRecordComment = async (
    tx: Db,
    ctx: EngineContext,
    recordId: string,
    commentId: string,
  ): Promise<RecordCommentRow> => {
    const rows = await runRaw<RecordCommentRow>(
      tx,
      sql`SELECT ${RECORD_COMMENT_COLUMNS} FROM comment
        WHERE id = ${commentId}::uuid AND workspace_id = ${ctx.workspaceId} AND entity_kind = 'record' AND entity_id = ${recordId}::uuid
          AND deleted_at IS NULL`,
    );
    const row = rows[0];

    if (!row) {
      throw notFound('Comment', commentId);
    }

    return row;
  };

  const assertCanEdit = (ctx: EngineContext, row: RecordCommentRow, verb: string) => {
    if (!isAdmin(ctx) && !sameActor(parseJson<Actor>(row.author), ctx.actor)) {
      throw new EngineError('FORBIDDEN', `Only the author or an admin can ${verb} a comment`);
    }
  };

  return {
    list: async (ctx, objectName, id, query = {}) => {
      const object = await resolve(ctx, objectName);
      authorize(ctx, 'record.read', { object });
      assertUuid(id, 'record');
      const after = query.cursor === undefined ? undefined : decodeRecordCommentCursor(query.cursor);

      if (query.cursor !== undefined && after === undefined) {
        throw new EngineError('INVALID_CURSOR', 'The comments cursor is malformed');
      }

      const limit = query.limit ?? RECORD_COMMENTS_DEFAULT_LIMIT;
      const rows = await runRaw<RecordCommentRow>(
        db,
        sql`SELECT ${RECORD_COMMENT_COLUMNS} FROM comment
          WHERE workspace_id = ${ctx.workspaceId} AND entity_kind = 'record' AND object_id = ${object.id} AND entity_id = ${id}::uuid
            AND deleted_at IS NULL
            ${
              after === undefined
                ? sql``
                : sql`AND (created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
            }
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit + 1}`,
      );
      const totals = await runRaw<{ total: unknown }>(
        db,
        sql`SELECT count(*) AS total FROM comment
          WHERE workspace_id = ${ctx.workspaceId} AND entity_kind = 'record' AND object_id = ${object.id} AND entity_id = ${id}::uuid
            AND deleted_at IS NULL`,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map((row) => toRecordComment(object.nameSingular, row)),
        nextCursor: rows.length > limit && last ? encodeRecordCommentCursor(toIso(last.created_at), last.id) : null,
        total: toNumber(totals[0]?.total ?? 0),
      };
    },

    create: async (ctx, objectName, id, input) => {
      const object = await resolve(ctx, objectName);
      authorize(ctx, 'record.read', { object });
      // A comment leaves the record untouched, so read-only objects take comments too.
      authorize(ctx, 'record.write');
      assertUuid(id, 'record');
      const parsed = RecordCommentInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comment');
      }

      const commentId = newId();
      const { value, now } = await withRecordCommentEvent(
        ctx,
        { type: 'comment.created', objectId: object.id, objectName: object.nameSingular, recordId: id, commentId },
        async (tx, at) => {
          const [record] = await dataSource.getMany(tx, ctx.workspaceId, object, [id]);

          if (!record) {
            throw notFound(object.labelSingular, id);
          }

          await runRaw(
            tx,
            sql`INSERT INTO comment (id, workspace_id, entity_kind, entity_id, object_id, actor, title, body, created_at)
              VALUES (${commentId}::uuid, ${ctx.workspaceId}, 'record', ${id}::uuid, ${object.id}, ${JSON.stringify(ctx.actor)}::jsonb,
                ${parsed.data.title}, ${parsed.data.body ?? ''}, ${at.toISOString()}::timestamptz)`,
          );

          return true;
        },
      );
      void value;

      return {
        id: commentId,
        object: object.nameSingular,
        recordId: id,
        title: parsed.data.title,
        body: parsed.data.body ?? '',
        author: ctx.actor,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    },

    update: async (ctx, objectName, id, commentId, patch) => {
      const object = await resolve(ctx, objectName);
      authorize(ctx, 'record.read', { object });
      authorize(ctx, 'record.write');
      assertUuid(id, 'record');
      assertUuid(commentId, 'comment');
      const parsed = RecordCommentPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comment');
      }

      const { value } = await withRecordCommentEvent(
        ctx,
        { type: 'comment.updated', objectId: object.id, objectName: object.nameSingular, recordId: id, commentId },
        async (tx, at) => {
          const row = await loadRecordComment(tx, ctx, id, commentId);
          assertCanEdit(ctx, row, 'edit');
          const title = parsed.data.title ?? row.title;
          const body = parsed.data.body ?? row.body;
          await runRaw(
            tx,
            sql`UPDATE comment SET title = ${title}, body = ${body}, edited_at = ${at.toISOString()}::timestamptz
              WHERE id = ${commentId}::uuid`,
          );

          return { ...row, title, body, updated_at: at.toISOString() };
        },
      );

      return toRecordComment(object.nameSingular, value);
    },

    delete: async (ctx, objectName, id, commentId) => {
      const object = await resolve(ctx, objectName);
      authorize(ctx, 'record.read', { object });
      authorize(ctx, 'record.write');
      assertUuid(id, 'record');
      assertUuid(commentId, 'comment');
      await withRecordCommentEvent(
        ctx,
        { type: 'comment.deleted', objectId: object.id, objectName: object.nameSingular, recordId: id, commentId },
        async (tx, at) => {
          const row = await loadRecordComment(tx, ctx, id, commentId);
          assertCanEdit(ctx, row, 'remove');
          await runRaw(
            tx,
            sql`UPDATE comment SET deleted_at = ${at.toISOString()}::timestamptz WHERE id = ${commentId}::uuid`,
          );

          return true;
        },
      );
    },
  };
};
