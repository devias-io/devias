import {
  type Actor,
  decodeTimelineCursor,
  encodeTimelineCursor,
  TIMELINE_DEFAULT_LIMIT,
  type TimelineQuery,
  TimelineQuerySchema,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import type { EngineContext } from './context';
import { type Db, parseJson, runRaw, toIso } from './db/exec';
import { EngineError, fromZodError } from './errors';

/**
 * The timelines of tasks and documents: what the event log says happened to them (the entries their services mark as
 * lines) and the comments written on them, newest first, in one ordering and one cursor. This is the one place that
 * reads either for a timeline; each entity maps the rows into its own entries.
 */

export type EntityKind = 'task' | 'document';

/** A row of a timeline: a line from the event log, or a comment. */
export interface TimelineRow {
  /** `event` or `comment`. */
  source: 'event' | 'comment';
  /** `e<sequence>` for events, the comment's uuid for comments: a stable tie-break within one moment. */
  id: string;
  at: string;
  actor: Actor;
  /** The event's `payload`. */
  payload: Record<string, unknown> | null;
  /** The event's `diff`. */
  diff: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
  /** A comment's text. */
  body: string | null;
  /** The run of an agent, from a comment's `cause` or an event's `payload.runId`. */
  cause: Record<string, unknown> | null;
}

interface RawRow extends Record<string, unknown> {
  source: string;
  id: string;
  at: unknown;
  actor: unknown;
  payload: unknown;
  diff: unknown;
  body: string | null;
  cause: unknown;
}

const toRow = (row: RawRow): TimelineRow => {
  const payload = row.payload === null ? null : parseJson<Record<string, unknown>>(row.payload);
  const cause =
    row.cause !== null
      ? parseJson<Record<string, unknown>>(row.cause)
      : typeof payload?.runId === 'string'
        ? { runId: payload.runId }
        : null;

  return {
    source: row.source as TimelineRow['source'],
    id: row.id,
    at: toIso(row.at),
    actor: parseJson<Actor>(row.actor),
    payload,
    diff: row.diff === null ? null : parseJson<NonNullable<TimelineRow['diff']>>(row.diff),
    body: row.body,
    cause,
  };
};

/** Add a comment. One written inside a run names the run as its cause. */
export const insertComment = async (
  tx: Db,
  ctx: EngineContext,
  entityKind: EntityKind,
  entityId: string,
  id: string,
  now: Date,
  body: string,
): Promise<TimelineRow> => {
  const rows = await runRaw<RawRow>(
    tx,
    sql`INSERT INTO comment (id, workspace_id, entity_kind, entity_id, actor, body, cause, created_at)
      VALUES (${id}::uuid, ${ctx.workspaceId}, ${entityKind}, ${entityId}::uuid, ${JSON.stringify(ctx.actor)}::jsonb, ${body},
        ${ctx.run ? JSON.stringify({ runId: ctx.run.id }) : null}::jsonb, ${now.toISOString()}::timestamptz)
    RETURNING 'comment' AS source, id::text AS id, created_at AS at, actor, NULL::jsonb AS payload, NULL::jsonb AS diff, body, cause`,
  );

  return toRow(rows[0] as RawRow);
};

/**
 * A page of an entity's timeline, newest first. `lines` says which events of the entity are lines (a condition over
 * `payload` and `type` of the `event` table). The caller has checked that the entity exists and may be read.
 */
export const listTimeline = async (
  db: Db,
  ctx: EngineContext,
  entityKind: EntityKind,
  entityId: string,
  eventType: string,
  lines: SQL,
  query: TimelineQuery = {},
): Promise<{ items: TimelineRow[]; nextCursor: string | null }> => {
  const parsed = TimelineQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw fromZodError(parsed.error, 'Invalid timeline query');
  }

  const after = parsed.data.cursor === undefined ? undefined : decodeTimelineCursor(parsed.data.cursor);

  if (parsed.data.cursor !== undefined && after === undefined) {
    throw new EngineError('INVALID_CURSOR', 'The timeline cursor is malformed');
  }

  const limit = parsed.data.limit ?? TIMELINE_DEFAULT_LIMIT;
  const rows = await runRaw<RawRow>(
    db,
    sql`SELECT * FROM (
        SELECT 'event' AS source, 'e' || e.sequence::text AS id, e.occurred_at AS at, e.actor, e.payload, e.diff,
          NULL::text AS body, NULL::jsonb AS cause
        FROM event e
        WHERE e.workspace_id = ${ctx.workspaceId} AND e.entity = ${entityKind} AND e.entity_id = ${entityId}
          AND e.type = ${eventType} AND (${lines})
        UNION ALL
        SELECT 'comment' AS source, c.id::text AS id, c.created_at AS at, c.actor, NULL::jsonb AS payload, NULL::jsonb AS diff,
          c.body, c.cause
        FROM comment c
        WHERE c.workspace_id = ${ctx.workspaceId} AND c.entity_kind = ${entityKind} AND c.entity_id = ${entityId}::uuid
          AND c.deleted_at IS NULL
      ) t
      ${after === undefined ? sql`` : sql`WHERE (t.at, t.id) < (${after.createdAt}::timestamptz, ${after.id})`}
      ORDER BY t.at DESC, t.id DESC
      LIMIT ${limit + 1}`,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(toRow),
    nextCursor: rows.length > limit && last ? encodeTimelineCursor(toIso(last.at), last.id) : null,
  };
};
