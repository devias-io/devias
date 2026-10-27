import {
  type Actor,
  anchorOf,
  collapseText,
  DOCUMENT_COMMENTS_MAX,
  DOCUMENT_EDIT_WINDOW_MINUTES,
  DOCUMENT_IDS_MAX,
  DOCUMENTS_DEFAULT_LIMIT,
  type Document,
  type DocumentActivityEntry,
  type DocumentActivityPage,
  type DocumentAppend,
  DocumentAppendSchema,
  type DocumentComment,
  type DocumentCommentInput,
  DocumentCommentInputSchema,
  type DocumentCommentPatch,
  DocumentCommentPatchSchema,
  type DocumentInput,
  DocumentInputSchema,
  type DocumentPage,
  type DocumentPatch,
  DocumentPatchSchema,
  type DocumentQuery,
  DocumentQuerySchema,
  type DocumentThread,
  type DocumentThreadPage,
  type DocumentThreadsQuery,
  DocumentThreadsQuerySchema,
  decodeDocumentCursor,
  documentIdsOf,
  encodeDocumentCursor,
  markdownToRichText,
  newId,
  parseLink,
  plainText,
  previewOf,
  type RichTextDoc,
  richTextToMarkdown,
  type SchemaIndex,
  type TimelineQuery,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import { isAdmin, sameActor } from '../authorship';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { inEventTransaction } from '../events/transaction';
import { indexedLinkOf, indexedLinksOf, replaceMentions, UUID } from '../links';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import { checkedRichText, richTextOf, richTextOrEmpty } from '../rich-text';
import { listTimeline, type TimelineRow } from '../timeline';

export interface DocumentService {
  list(ctx: EngineContext, query?: DocumentQuery): Promise<DocumentPage>;
  get(ctx: EngineContext, id: string): Promise<Document>;
  create(ctx: EngineContext, input: DocumentInput): Promise<Document>;
  update(ctx: EngineContext, id: string, patch: DocumentPatch): Promise<Document>;
  /** Adds Markdown after the last block, under the workspace lock: nothing needs reading first. */
  append(ctx: EngineContext, id: string, input: DocumentAppend): Promise<Document>;
  /** When it was made, who edited it and the comments on it, newest first. */
  activity(ctx: EngineContext, id: string, query?: TimelineQuery): Promise<DocumentActivityPage>;
  /** Comment on the document, on a selection of its text (`anchor`) or on a thread (`parent`). */
  comment(ctx: EngineContext, id: string, input: DocumentCommentInput): Promise<DocumentComment>;
  /** Threads, in the order they were started. */
  comments(ctx: EngineContext, id: string, query?: DocumentThreadsQuery): Promise<DocumentThreadPage>;
  /** Resolve or reopen a thread, or change a comment's text. */
  updateComment(
    ctx: EngineContext,
    id: string,
    commentId: string,
    patch: DocumentCommentPatch,
  ): Promise<DocumentComment>;
  deleteComment(ctx: EngineContext, id: string, commentId: string): Promise<void>;
  delete(ctx: EngineContext, id: string): Promise<void>;
}

export interface DocumentServiceDeps {
  db: Db;
  metadata: MetadataService;
  bus: EventBus;
  clock: () => Date;
}

interface DocumentRow extends Record<string, unknown> {
  id: string;
  title: string;
  body?: unknown;
  preview: string;
  version: unknown;
  created_by: unknown;
  updated_by: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface CommentRow extends Record<string, unknown> {
  id: string;
  entity_id: string;
  parent_id: string | null;
  actor: unknown;
  body: string;
  anchor: unknown;
  resolved_at: unknown;
  resolved_by: unknown;
  cause: unknown;
  created_at: unknown;
  edited_at: unknown;
}

const COMMENT_COLUMNS = sql.raw(
  'id, entity_id, parent_id, actor, body, anchor, resolved_at, resolved_by, cause, created_at, edited_at',
);

const SUMMARY_COLUMNS = sql.raw(
  'd.id, d.title, d.preview, d.version, d.created_by, d.updated_by, d.created_at, d.updated_at',
);
const FULL_COLUMNS = sql.raw(
  'd.id, d.title, d.body, d.preview, d.version, d.created_by, d.updated_by, d.created_at, d.updated_at',
);

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid ${what} id "${id}"`, { id });
  }
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (m) => `\\${m}`);

const isEmptyBlock = (node: { type: string; content?: unknown[] }): boolean =>
  node.type === 'paragraph' && (node.content?.length ?? 0) === 0;

/**
 * Documents: titled pages of rich text in their own tables. Everything that reads or writes them goes through here, so
 * who may see which document is decided in one place (`visible`; every member sees every document for now).
 */
export const createDocumentService = (deps: DocumentServiceDeps): DocumentService => {
  const { db, metadata, bus, clock } = deps;

  /** The rows `ctx` may see. Documents are workspace-wide today; per-document access narrows this and nothing else. */
  const visible = (_ctx: EngineContext): SQL => sql`TRUE`;

  const toSummary = (row: DocumentRow) => ({
    id: row.id,
    title: row.title,
    preview: row.preview,
    version: toNumber(row.version),
    createdBy: parseJson<Actor>(row.created_by),
    updatedBy: parseJson<Actor>(row.updated_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });

  const toDocument = (row: DocumentRow): Document => {
    const body = parseJson<RichTextDoc>(row.body);

    return { ...toSummary(row), body, markdown: richTextToMarkdown(body) };
  };

  const load = async (tx: Db, ctx: EngineContext, id: string): Promise<DocumentRow> => {
    const rows = await runRaw<DocumentRow>(
      tx,
      sql`SELECT ${FULL_COLUMNS} FROM document d
        WHERE d.id = ${id}::uuid AND d.workspace_id = ${ctx.workspaceId} AND d.deleted_at IS NULL AND ${visible(ctx)}`,
    );
    const row = rows[0];

    if (!row) {
      throw notFound('Document', id);
    }

    return row;
  };

  const assertVersion = (row: DocumentRow, expected: number | undefined) => {
    if (expected !== undefined && toNumber(row.version) !== expected) {
      throw new EngineError('CONFLICT', 'This document was changed by someone else since it was read', {
        currentVersion: toNumber(row.version),
      });
    }
  };

  /**
   * One transaction for a write, its link index and its `document.changed` event. The write may add to the event's
   * payload through `note` (what changed, whether it starts a stretch of editing).
   */
  const withEvent = <T>(
    ctx: EngineContext,
    action: 'created' | 'updated' | 'commented' | 'deleted',
    documentId: string,
    write: (tx: Db, now: Date, note: Record<string, unknown>) => Promise<T>,
  ): Promise<T> =>
    inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
      const note: Record<string, unknown> = {};
      const value = await write(tx, now, note);

      return {
        value,
        events: [{ type: 'document.changed', entity: 'document', entityId: documentId, payload: { action, ...note } }],
      };
    });

  /** A line of a document's timeline, from the event that made it or the comment. */
  const toEntry = (documentId: string, row: TimelineRow): DocumentActivityEntry => {
    const base = { id: row.id, documentId, actor: row.actor, cause: row.cause, createdAt: row.at };

    if (row.source === 'comment') {
      return { ...base, kind: 'comment', body: row.body, data: null };
    }

    return row.payload?.action === 'created'
      ? { ...base, kind: 'created', body: null, data: null }
      : { ...base, kind: 'edited', body: null, data: { changes: row.payload?.changes ?? [] } };
  };

  const toComment = (row: CommentRow): DocumentComment => ({
    id: row.id,
    documentId: row.entity_id,
    parentId: row.parent_id,
    actor: parseJson<Actor>(row.actor),
    body: row.body,
    anchor: row.anchor === null ? null : parseJson<NonNullable<DocumentComment['anchor']>>(row.anchor),
    resolvedAt: row.resolved_at === null ? null : toIso(row.resolved_at),
    resolvedBy: row.resolved_by === null ? null : parseJson<Actor>(row.resolved_by),
    cause: row.cause === null ? null : parseJson<Record<string, unknown>>(row.cause),
    createdAt: toIso(row.created_at),
    editedAt: row.edited_at === null ? null : toIso(row.edited_at),
  });

  const loadComment = async (
    tx: Db,
    ctx: EngineContext,
    documentId: string,
    commentId: string,
  ): Promise<CommentRow> => {
    const rows = await runRaw<CommentRow>(
      tx,
      sql`SELECT ${COMMENT_COLUMNS} FROM comment
        WHERE id = ${commentId}::uuid AND workspace_id = ${ctx.workspaceId} AND entity_kind = 'document'
          AND entity_id = ${documentId}::uuid AND deleted_at IS NULL`,
    );
    const row = rows[0];

    if (!row) {
      throw notFound('Comment', commentId);
    }

    return row;
  };

  /**
   * An edit is on the timeline once per person per stretch of writing: a document saves every few seconds while it is
   * typed, and a page of "edited" lines would say nothing. Every save is an event for the feed; the first of a stretch
   * is marked, and the timeline shows only those. A stretch starts when the person's last marked event (making the
   * document counts) is more than `DOCUMENT_EDIT_WINDOW_MINUTES` old.
   */
  const noteEdit = async (
    tx: Db,
    ctx: EngineContext,
    id: string,
    changes: string[],
    now: Date,
    note: Record<string, unknown>,
  ) => {
    note.changes = changes;

    if (changes.length === 0) {
      return;
    }

    const since = new Date(now.getTime() - DOCUMENT_EDIT_WINDOW_MINUTES * 60_000).toISOString();
    const recent = await runRaw(
      tx,
      sql`SELECT 1 FROM event
        WHERE workspace_id = ${ctx.workspaceId} AND entity = 'document' AND entity_id = ${id} AND type = 'document.changed'
          AND (payload->>'action' = 'created' OR payload->>'stretch' = 'true')
          AND actor = ${JSON.stringify(ctx.actor)}::jsonb AND occurred_at > ${since}::timestamptz
        LIMIT 1`,
    );

    if (recent.length === 0) {
      note.stretch = true;
    }
  };

  const mentionFilter = (index: SchemaIndex, mentions: string): SQL => {
    const target = parseLink(mentions);

    if (!target) {
      throw validationError('`mentions` must be a link: record:<object>/<id>, document:<id> or task:<id>', {
        path: 'mentions',
      });
    }

    const indexed = indexedLinkOf(index, target);

    if (indexed.problem !== undefined) {
      throw validationError(indexed.problem, { path: 'mentions' });
    }

    const { kind, objectId, targetId } = indexed.link;

    return sql`EXISTS (SELECT 1 FROM mention l WHERE l.entity_kind = 'document' AND l.entity_id = d.id AND l.kind = ${kind}
      AND l.object_id = ${objectId} AND l.target_id = ${targetId}::uuid)`;
  };

  return {
    list: async (ctx, query = {}) => {
      authorize(ctx, 'document.read');
      const parsed = DocumentQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid documents query');
      }

      const { search, mentions, updatedAfter } = parsed.data;
      const ids = documentIdsOf(parsed.data.ids);

      if (ids.length > DOCUMENT_IDS_MAX) {
        throw validationError(`Name at most ${DOCUMENT_IDS_MAX} ids`, { path: 'ids' });
      }

      for (const id of ids) {
        assertUuid(id, 'document');
      }

      const after = parsed.data.cursor === undefined ? undefined : decodeDocumentCursor(parsed.data.cursor);

      if (parsed.data.cursor !== undefined && after === undefined) {
        throw new EngineError('INVALID_CURSOR', 'The documents cursor is malformed');
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const filters: SQL[] = [sql`d.workspace_id = ${ctx.workspaceId}`, sql`d.deleted_at IS NULL`, visible(ctx)];

      if (search) {
        const needle = `%${escapeLike(search)}%`;
        filters.push(sql`(d.title ILIKE ${needle} ESCAPE '\\' OR d.body_text ILIKE ${needle} ESCAPE '\\')`);
      }

      if (mentions) {
        filters.push(mentionFilter(index, mentions));
      }

      if (ids.length > 0) {
        filters.push(
          sql`d.id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
      }

      if (updatedAfter) {
        filters.push(sql`d.updated_at > ${new Date(updatedAfter).toISOString()}::timestamptz`);
      }

      const where = sql.join(filters, sql` AND `);
      const limit = parsed.data.limit ?? DOCUMENTS_DEFAULT_LIMIT;
      const rows = await runRaw<DocumentRow>(
        db,
        sql`SELECT ${SUMMARY_COLUMNS} FROM document d
          WHERE ${where}
            ${after === undefined ? sql`` : sql`AND (d.updated_at, d.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`}
          ORDER BY d.updated_at DESC, d.id DESC
          LIMIT ${limit + 1}`,
      );
      const totals = await runRaw<{ total: unknown }>(db, sql`SELECT count(*) AS total FROM document d WHERE ${where}`);
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map(toSummary),
        nextCursor: rows.length > limit && last ? encodeDocumentCursor(toIso(last.updated_at), last.id) : null,
        total: toNumber(totals[0]?.total ?? 0),
      };
    },

    get: async (ctx, id) => {
      authorize(ctx, 'document.read');
      assertUuid(id, 'document');

      return toDocument(await load(db, ctx, id));
    },

    create: async (ctx, input) => {
      authorize(ctx, 'document.write');
      const parsed = DocumentInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid document');
      }

      const body = richTextOrEmpty(parsed.data);
      checkedRichText(body);
      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const id = newId();
      const text = plainText(body);
      const actor = JSON.stringify(ctx.actor);

      return withEvent(ctx, 'created', id, async (tx, now) => {
        const at = now.toISOString();
        const rows = await runRaw<DocumentRow>(
          tx,
          sql`INSERT INTO document (id, workspace_id, title, body, body_text, preview, version, created_by, updated_by, created_at, updated_at)
            VALUES (${id}::uuid, ${ctx.workspaceId}, ${parsed.data.title}, ${JSON.stringify(body)}::jsonb, ${text}, ${previewOf(text)}, 1,
              ${actor}::jsonb, ${actor}::jsonb, ${at}::timestamptz, ${at}::timestamptz)
            RETURNING id, title, body, preview, version, created_by, updated_by, created_at, updated_at`,
        );
        await replaceMentions(tx, 'document', ctx.workspaceId, id, indexedLinksOf(index, body, 'document', id));

        return toDocument(rows[0] as DocumentRow);
      });
    },

    update: async (ctx, id, patch) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');
      const parsed = DocumentPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid document');
      }

      const body = richTextOf(parsed.data);

      if (body) {
        checkedRichText(body);
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return withEvent(ctx, 'updated', id, async (tx, now, note) => {
        const row = await load(tx, ctx, id);
        assertVersion(row, parsed.data.expectedVersion);
        const title = parsed.data.title ?? row.title;
        const text = body ? plainText(body) : undefined;
        const rows = await runRaw<DocumentRow>(
          tx,
          sql`UPDATE document SET title = ${title},
              ${body && text !== undefined ? sql`body = ${JSON.stringify(body)}::jsonb, body_text = ${text}, preview = ${previewOf(text)},` : sql``}
              version = version + 1, updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${id}::uuid
            RETURNING id, title, body, preview, version, created_by, updated_by, created_at, updated_at`,
        );

        if (body) {
          await replaceMentions(tx, 'document', ctx.workspaceId, id, indexedLinksOf(index, body, 'document', id));
        }

        await noteEdit(
          tx,
          ctx,
          id,
          [
            ...(parsed.data.title !== undefined && parsed.data.title !== row.title ? ['title'] : []),
            ...(body ? ['text'] : []),
          ],
          now,
          note,
        );

        return toDocument(rows[0] as DocumentRow);
      });
    },

    append: async (ctx, id, input) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');
      const parsed = DocumentAppendSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid text to add');
      }

      const added = markdownToRichText(parsed.data.markdown).content ?? [];
      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return withEvent(ctx, 'updated', id, async (tx, now, note) => {
        const row = await load(tx, ctx, id);
        assertVersion(row, parsed.data.expectedVersion);
        const current = parseJson<RichTextDoc>(row.body);
        const kept = [...(current.content ?? [])];

        // An empty document is one empty paragraph; what is added replaces it rather than following it.
        while (kept.length > 0 && isEmptyBlock(kept[kept.length - 1] as { type: string; content?: unknown[] })) {
          kept.pop();
        }

        const body = checkedRichText({ ...current, type: 'doc', content: [...kept, ...added] });
        const text = plainText(body);
        const rows = await runRaw<DocumentRow>(
          tx,
          sql`UPDATE document SET body = ${JSON.stringify(body)}::jsonb, body_text = ${text}, preview = ${previewOf(text)},
              version = version + 1, updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${id}::uuid
            RETURNING id, title, body, preview, version, created_by, updated_by, created_at, updated_at`,
        );
        await replaceMentions(tx, 'document', ctx.workspaceId, id, indexedLinksOf(index, body, 'document', id));
        await noteEdit(tx, ctx, id, ['text'], now, note);

        return toDocument(rows[0] as DocumentRow);
      });
    },

    activity: async (ctx, id, query = {}) => {
      authorize(ctx, 'document.read');
      assertUuid(id, 'document');
      await load(db, ctx, id);
      const page = await listTimeline(
        db,
        ctx,
        'document',
        id,
        'document.changed',
        sql`e.payload->>'action' = 'created' OR e.payload->>'stretch' = 'true'`,
        query,
      );

      return { items: page.items.map((row) => toEntry(id, row)), nextCursor: page.nextCursor };
    },

    comment: async (ctx, id, input) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');
      const parsed = DocumentCommentInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comment');
      }

      const { markdown, anchor: given, parent } = parsed.data;

      // A comment is not an edit: the document, its version and its time of last edit stay as they are.
      return withEvent(ctx, 'commented', id, async (tx, now) => {
        const row = await load(tx, ctx, id);
        let anchor: ReturnType<typeof anchorOf> = null;

        if (parent !== undefined) {
          assertUuid(parent, 'comment');
          const thread = await loadComment(tx, ctx, id, parent);

          if (thread.parent_id !== null) {
            throw validationError('Reply to the first comment of a thread', { path: 'parent' });
          }
        }

        if (given) {
          anchor = anchorOf(collapseText(plainText(parseJson<RichTextDoc>(row.body))), given.quote, given);

          if (!anchor) {
            throw validationError('The quoted text is not in the document', { path: 'anchor.quote' });
          }
        }

        const commentId = newId();
        await runRaw(
          tx,
          sql`INSERT INTO comment (id, workspace_id, entity_kind, entity_id, parent_id, anchor, actor, body, cause, created_at)
            VALUES (${commentId}::uuid, ${ctx.workspaceId}, 'document', ${id}::uuid, ${parent ?? null}::uuid,
              ${anchor ? JSON.stringify(anchor) : null}::jsonb, ${JSON.stringify(ctx.actor)}::jsonb, ${markdown},
              ${ctx.run ? JSON.stringify({ runId: ctx.run.id }) : null}::jsonb, ${now.toISOString()}::timestamptz)`,
        );

        return toComment(await loadComment(tx, ctx, id, commentId));
      });
    },

    comments: async (ctx, id, query = {}) => {
      authorize(ctx, 'document.read');
      assertUuid(id, 'document');
      const parsed = DocumentThreadsQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comments query');
      }

      await load(db, ctx, id);
      const status = parsed.data.status ?? 'open';
      const rows = await runRaw<CommentRow>(
        db,
        sql`SELECT ${COMMENT_COLUMNS} FROM comment
          WHERE workspace_id = ${ctx.workspaceId} AND entity_kind = 'document' AND entity_id = ${id}::uuid AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC
          LIMIT ${DOCUMENT_COMMENTS_MAX}`,
      );
      const replies = new Map<string, DocumentComment[]>();
      const roots: DocumentComment[] = [];

      for (const row of rows) {
        const comment = toComment(row);

        if (comment.parentId === null) {
          roots.push(comment);
        } else {
          replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
        }
      }

      const threads: DocumentThread[] = roots
        .filter((root) => status === 'all' || (status === 'resolved') === (root.resolvedAt !== null))
        .map((root) => ({ comment: root, replies: replies.get(root.id) ?? [] }));

      return { items: threads };
    },

    updateComment: async (ctx, id, commentId, patch) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');
      assertUuid(commentId, 'comment');
      const parsed = DocumentCommentPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comment');
      }

      return withEvent(ctx, 'commented', id, async (tx, now) => {
        await load(tx, ctx, id);
        const row = await loadComment(tx, ctx, id, commentId);
        const at = now.toISOString();

        if (parsed.data.markdown !== undefined) {
          if (!isAdmin(ctx) && !sameActor(parseJson<Actor>(row.actor), ctx.actor)) {
            throw new EngineError('FORBIDDEN', 'Only the author or an admin can change a comment');
          }

          await runRaw(
            tx,
            sql`UPDATE comment SET body = ${parsed.data.markdown}, edited_at = ${at}::timestamptz WHERE id = ${commentId}::uuid`,
          );
        }

        if (parsed.data.resolved !== undefined) {
          if (row.parent_id !== null) {
            throw validationError('A thread is resolved on its first comment', { path: 'resolved' });
          }

          await runRaw(
            tx,
            parsed.data.resolved
              ? sql`UPDATE comment SET resolved_at = ${at}::timestamptz, resolved_by = ${JSON.stringify(ctx.actor)}::jsonb WHERE id = ${commentId}::uuid`
              : sql`UPDATE comment SET resolved_at = NULL, resolved_by = NULL WHERE id = ${commentId}::uuid`,
          );
        }

        return toComment(await loadComment(tx, ctx, id, commentId));
      });
    },

    deleteComment: async (ctx, id, commentId) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');
      assertUuid(commentId, 'comment');

      await withEvent(ctx, 'commented', id, async (tx, now) => {
        await load(tx, ctx, id);
        const row = await loadComment(tx, ctx, id, commentId);

        if (!isAdmin(ctx) && !sameActor(parseJson<Actor>(row.actor), ctx.actor)) {
          throw new EngineError('FORBIDDEN', 'Only the author or an admin can delete a comment');
        }

        // A thread goes with its first comment.
        await runRaw(
          tx,
          sql`UPDATE comment SET deleted_at = ${now.toISOString()}::timestamptz
            WHERE entity_kind = 'document' AND entity_id = ${id}::uuid AND (id = ${commentId}::uuid OR parent_id = ${commentId}::uuid)`,
        );

        return true;
      });
    },

    delete: async (ctx, id) => {
      authorize(ctx, 'document.write');
      assertUuid(id, 'document');

      await withEvent(ctx, 'deleted', id, async (tx, now) => {
        await load(tx, ctx, id);
        await runRaw(
          tx,
          sql`UPDATE document SET deleted_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${id}::uuid`,
        );
        await runRaw(tx, sql`DELETE FROM mention WHERE entity_kind = 'document' AND entity_id = ${id}::uuid`);

        return true;
      });
    },
  };
};
