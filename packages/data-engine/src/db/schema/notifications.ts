import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** People's notifications. */

/**
 * Notifications for the people of a workspace, one row per recipient (a member's user id). Sending writes a
 * `notification.changed` event per recipient; a repeated send with the same `key` replaces the recipient's unread
 * row instead of adding one, and read rows beyond the retention are pruned as new ones arrive.
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    recipientId: text().notNull(),
    /** Dotted, `<module>.<name>`; `general` by default. */
    kind: text().notNull(),
    /** info | success | warning | error. */
    level: text().notNull(),
    title: text().notNull(),
    /** Markdown. */
    body: text(),
    /** Where it leads (a `NotificationTarget`), if anywhere. */
    target: jsonb().$type<Record<string, unknown>>(),
    key: text(),
    /** Whatever the sender attached, for its own code. */
    data: jsonb().$type<Record<string, unknown>>(),
    actor: jsonb().$type<{ kind: string; id: string }>().notNull(),
    readAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('notification_ws_recipient_created_idx').on(t.workspaceId, t.recipientId, t.createdAt.desc(), t.id),
    index('notification_ws_recipient_unread_idx').on(t.workspaceId, t.recipientId).where(sql`${t.readAt} is null`),
    index('notification_ws_recipient_key_idx').on(t.workspaceId, t.recipientId, t.key).where(sql`${t.key} is not null`),
  ],
);
