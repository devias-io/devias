import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  type MarkAllReadResult,
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_RETENTION_PER_RECIPIENT,
  type Notification,
  type NotificationEvent,
  type NotificationInput,
  NotificationInputSchema,
  type NotificationPage,
  type NotificationQuery,
  NotificationQuerySchema,
  NotificationSchema,
  type NotificationSendResult,
  newId,
  personOf,
  type UnreadCount,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, type EventRow, lockWorkspace, writeEvents } from '../events/feed';
import { authorize } from '../permissions/policy';

/**
 * Notifications: one row per recipient, in the `notification` table. The inbox methods are for people (a signed-in
 * user, or the one an agent acts for) and only ever touch that person's rows; `send` is for anyone with
 * `notification.send`, with the audience already resolved to user ids by the server.
 */
export interface NotificationService {
  /** The person's notifications, newest first; `unread` keeps the unread ones. Page with `nextCursor`. */
  list(ctx: EngineContext, query?: NotificationQuery): Promise<NotificationPage>;
  unreadCount(ctx: EngineContext): Promise<UnreadCount>;
  /**
   * Notify members: one row per recipient, or the recipient's unread row with the same `key` replaced. Each one is
   * announced on the feed as `notification.changed`, which only its recipient sees.
   */
  send(ctx: EngineContext, input: NotificationSendInput): Promise<NotificationSendResult>;
  markRead(ctx: EngineContext, id: string): Promise<Notification>;
  markUnread(ctx: EngineContext, id: string): Promise<Notification>;
  /** Marks every unread notification of the person read; `updated` says how many there were. */
  markAllRead(ctx: EngineContext): Promise<MarkAllReadResult>;
  delete(ctx: EngineContext, id: string): Promise<void>;
}

/** What reaches the engine: the content of a notification, and the members (user ids) it goes to. */
export type NotificationSendInput = Omit<NotificationInput, 'to'> & { recipients: string[] };

export interface NotificationServiceDeps {
  db: Db;
  bus: EventBus;
  clock: () => Date;
  /** Read notifications kept per recipient (default `NOTIFICATION_RETENTION_PER_RECIPIENT`). */
  retention?: number;
}

/** The core input without `to`, which the server has turned into recipients. */
const SendInputSchema = NotificationInputSchema.omit({ to: true }).extend({
  recipients: z.array(z.string().min(1)),
});

interface NotificationRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  recipient_id: string;
  kind: string;
  level: string;
  title: string;
  body: string | null;
  target: unknown;
  key: string | null;
  data: unknown;
  actor: unknown;
  read_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** One `notification.changed` event to write; `notificationId` is null for a mark-all. */
interface Change {
  recipientId: string;
  notificationId: string | null;
  action: NotificationEvent['action'];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = sql.raw(
  'id, workspace_id, recipient_id, kind, level, title, body, target, key, data, actor, read_at, created_at, updated_at',
);

const assertUuid = (id: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid notification id "${id}"`, { id });
  }
};

const nullableIso = (value: unknown): string | null => (value === null || value === undefined ? null : toIso(value));

const toNotification = (row: NotificationRow): Notification =>
  NotificationSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    level: row.level,
    title: row.title,
    body: row.body,
    target: parseJson(row.target) ?? null,
    key: row.key,
    data: parseJson(row.data) ?? null,
    actor: parseJson(row.actor),
    readAt: nullableIso(row.read_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });

export const createNotificationService = (deps: NotificationServiceDeps): NotificationService => {
  const { db, bus, clock } = deps;
  const retention = deps.retention ?? NOTIFICATION_RETENTION_PER_RECIPIENT;

  /** Whose inbox: the person behind the caller, who needs `notification.read`. Keys and automations have none. */
  const inboxOf = (ctx: EngineContext): string => {
    const person = personOf(ctx.actor);

    if (person === null) {
      throw new EngineError('FORBIDDEN', 'Notifications belong to people');
    }

    authorize(ctx, 'notification.read');

    return person;
  };

  /**
   * One write transaction under the workspace lock: mutate, then announce one `notification.changed` per change on
   * the feed, as notes do. Nothing is announced when nothing changed.
   */
  const commit = async <T>(
    ctx: EngineContext,
    mutate: (tx: Db, now: Date) => Promise<{ result: T; changes: Change[] }>,
  ): Promise<T> => {
    const now = clock();
    const outcome = await db.transaction(async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const { result, changes } = await mutate(tx, now);

      if (changes.length === 0) {
        return { result, last: null };
      }

      const first = await allocateSequences(tx, ctx.workspaceId, changes.length);
      const events: EventRow[] = changes.map((change, i) => ({
        sequence: first + i,
        type: 'notification.changed',
        actor: ctx.actor,
        occurredAt: now,
        ...(change.notificationId === null ? {} : { entity: 'notification', entityId: change.notificationId }),
        payload: { recipientId: change.recipientId, action: change.action },
      }));
      await writeEvents(tx, ctx.workspaceId, events);
      const last = first + changes.length - 1;
      await bus.publish(tx, ctx.workspaceId, { seq: last });

      return { result, last };
    });

    if (outcome.last !== null) {
      bus.emitLocal(ctx.workspaceId, { seq: outcome.last });
    }

    return outcome.result;
  };

  /** Keep the recipient's newest `retention` read notifications; unread ones are never pruned. */
  const prune = (tx: Db, workspaceId: string, recipient: string) =>
    runRaw(
      tx,
      sql`DELETE FROM notification
          WHERE workspace_id = ${workspaceId} AND recipient_id = ${recipient} AND read_at IS NOT NULL
            AND id NOT IN (
              SELECT id FROM notification
              WHERE workspace_id = ${workspaceId} AND recipient_id = ${recipient} AND read_at IS NOT NULL
              ORDER BY created_at DESC, id DESC LIMIT ${retention})`,
    );

  /** Flip one of the person's notifications; a second call in the same direction changes (and announces) nothing. */
  const setRead = async (ctx: EngineContext, id: string, read: boolean): Promise<Notification> => {
    const person = inboxOf(ctx);
    assertUuid(id);

    return commit(ctx, async (tx, now) => {
      const at = now.toISOString();
      const rows = await runRaw<NotificationRow>(
        tx,
        sql`UPDATE notification SET read_at = ${read ? at : null}::timestamptz, updated_at = ${at}::timestamptz
            WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person} AND id = ${id}::uuid
              ${read ? sql`AND read_at IS NULL` : sql`AND read_at IS NOT NULL`}
            RETURNING ${COLUMNS}`,
      );
      const row = rows[0];

      if (row) {
        return { result: toNotification(row), changes: [{ recipientId: person, notificationId: id, action: 'read' }] };
      }

      const current = await runRaw<NotificationRow>(
        tx,
        sql`SELECT ${COLUMNS} FROM notification
            WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person} AND id = ${id}::uuid`,
      );

      if (!current[0]) {
        throw notFound('Notification', id);
      }

      return { result: toNotification(current[0]), changes: [] };
    });
  };

  return {
    list: async (ctx, query = {}) => {
      const person = inboxOf(ctx);
      const parsed = NotificationQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid notification query');
      }

      const { cursor, unread } = parsed.data;
      const limit = parsed.data.limit ?? NOTIFICATION_DEFAULT_LIMIT;
      const before = cursor === undefined ? undefined : decodeNotificationCursor(cursor);

      if (cursor !== undefined && (before === undefined || !UUID.test(before.id))) {
        throw new EngineError('INVALID_CURSOR', 'The notifications cursor is malformed');
      }

      const rows = await runRaw<NotificationRow>(
        db,
        sql`SELECT ${COLUMNS} FROM notification
            WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person}
              ${unread ? sql`AND read_at IS NULL` : sql``}
              ${before === undefined ? sql`` : sql`AND (created_at, id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)`}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit + 1}`,
      );
      const items = rows.slice(0, limit).map(toNotification);
      const last = items.at(-1);

      return { items, nextCursor: rows.length > limit && last ? encodeNotificationCursor(last) : null };
    },

    unreadCount: async (ctx) => {
      const person = inboxOf(ctx);
      const rows = await runRaw<{ count: unknown }>(
        db,
        sql`SELECT count(*) AS count FROM notification
            WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person} AND read_at IS NULL`,
      );

      return { count: toNumber(rows[0]?.count) };
    },

    send: async (ctx, input) => {
      authorize(ctx, 'notification.send');
      const parsed = SendInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid notification');
      }

      const { recipients: named, ...content } = parsed.data;
      const recipients = [...new Set(named)];

      if (recipients.length === 0) {
        return { recipients: 0, created: 0, updated: 0 };
      }

      const body = content.body ? content.body : null;
      const target = content.target === undefined ? null : JSON.stringify(content.target);
      const data = content.data === undefined ? null : JSON.stringify(content.data);
      const actor = JSON.stringify(ctx.actor);

      return commit(ctx, async (tx, now) => {
        const at = now.toISOString();
        let created = 0;
        let updated = 0;
        const changes: Change[] = [];

        for (const recipient of recipients) {
          let id: string | undefined;

          if (content.key !== undefined) {
            // The recipient's unread notification with this key takes the new content and moves to the top.
            const replaced = await runRaw<{ id: string }>(
              tx,
              sql`UPDATE notification
                  SET title = ${content.title}, body = ${body}, level = ${content.level}, target = ${target}::jsonb,
                    data = ${data}::jsonb, actor = ${actor}::jsonb, created_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
                  WHERE id = (
                    SELECT id FROM notification
                    WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${recipient} AND key = ${content.key} AND read_at IS NULL
                    ORDER BY created_at DESC, id DESC LIMIT 1)
                  RETURNING id`,
            );
            id = replaced[0]?.id;

            if (id !== undefined) {
              updated += 1;
            }
          }

          if (id === undefined) {
            id = newId();
            await runRaw(
              tx,
              sql`INSERT INTO notification (id, workspace_id, recipient_id, kind, level, title, body, target, key, data, actor, read_at, created_at, updated_at)
                  VALUES (${id}::uuid, ${ctx.workspaceId}, ${recipient}, ${content.kind}, ${content.level}, ${content.title}, ${body},
                    ${target}::jsonb, ${content.key ?? null}, ${data}::jsonb, ${actor}::jsonb, NULL, ${at}::timestamptz, ${at}::timestamptz)`,
            );
            created += 1;
            await prune(tx, ctx.workspaceId, recipient);
          }

          changes.push({ recipientId: recipient, notificationId: id, action: 'created' });
        }

        return { result: { recipients: recipients.length, created, updated }, changes };
      });
    },

    markRead: (ctx, id) => setRead(ctx, id, true),

    markUnread: (ctx, id) => setRead(ctx, id, false),

    markAllRead: async (ctx) => {
      const person = inboxOf(ctx);

      return commit(ctx, async (tx, now) => {
        const at = now.toISOString();
        const rows = await runRaw<{ id: string }>(
          tx,
          sql`UPDATE notification SET read_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
              WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person} AND read_at IS NULL
              RETURNING id`,
        );

        return {
          result: { updated: rows.length },
          changes: rows.length === 0 ? [] : [{ recipientId: person, notificationId: null, action: 'read' }],
        };
      });
    },

    delete: async (ctx, id) => {
      const person = inboxOf(ctx);
      assertUuid(id);
      await commit(ctx, async (tx) => {
        const rows = await runRaw<{ id: string }>(
          tx,
          sql`DELETE FROM notification
              WHERE workspace_id = ${ctx.workspaceId} AND recipient_id = ${person} AND id = ${id}::uuid
              RETURNING id`,
        );

        if (rows.length === 0) {
          throw notFound('Notification', id);
        }

        return { result: undefined, changes: [{ recipientId: person, notificationId: id, action: 'deleted' }] };
      });
    },
  };
};
