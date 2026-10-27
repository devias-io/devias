import { z } from 'zod';
import { ActorSchema } from './events';

/**
 * Notifications: short messages for the people of a workspace, one row per recipient, with an optional place to go.
 * Core sends them (a workflow's "Send a notification" step, the agent), and so does every module from its action
 * handlers (`ctx.notify`). The studio shows them in a docked panel behind the bell in the top bar.
 */

export const NOTIFICATION_LEVELS = ['info', 'success', 'warning', 'error'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_DEFAULT_KIND = 'general';
export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_BODY_MAX = 4_000;
export const NOTIFICATION_KEY_MAX = 200;
export const NOTIFICATION_DEFAULT_LIMIT = 30;
export const NOTIFICATION_MAX_LIMIT = 100;
/** Read notifications a recipient keeps; older ones are pruned when new ones arrive. Unread ones are never pruned. */
export const NOTIFICATION_RETENTION_PER_RECIPIENT = 500;

/** Dotted, like action ids: `general`, `billing.payment_received`, `workflow.failed`. By convention `<module>.<name>`. */
export const NOTIFICATION_KIND_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** Where a notification takes the person who opens it. */
export const NotificationTargetSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('record'), object: z.string().min(1), id: z.string().min(1) }),
    z.object({ kind: z.literal('object'), object: z.string().min(1), view: z.string().optional() }),
    z.object({ kind: z.literal('page'), pagePath: z.string().min(1) }),
    z.object({ kind: z.literal('settings'), section: z.string().optional() }),
    z.object({ kind: z.literal('workflow'), id: z.string().min(1) }),
    z.object({ kind: z.literal('document'), id: z.string().min(1) }),
    z.object({ kind: z.literal('task'), id: z.string().min(1) }),
    z.object({ kind: z.literal('url'), url: z.string().min(1), external: z.boolean().optional() }),
  ])
  .meta({ id: 'NotificationTarget' });
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;

export const NotificationSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    /** The member it is for. */
    recipientId: z.string(),
    kind: z.string(),
    level: z.enum(NOTIFICATION_LEVELS),
    title: z.string(),
    /** Markdown; `record:<object>/<id>`, `workflow:<id>` and `document:<id>` links open in the studio. */
    body: z.string().nullable(),
    target: NotificationTargetSchema.nullable(),
    /** Repeated sends with the same key replace the unread notification instead of adding another. */
    key: z.string().nullable(),
    /** Whatever the sender attached, e.g. a module's payload; shown nowhere, kept for its code. */
    data: z.record(z.string(), z.unknown()).nullable(),
    /** Who caused it: a person, the agent for a person, a workflow or a module's action. */
    actor: ActorSchema,
    readAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Notification' });
export type Notification = z.infer<typeof NotificationSchema>;

export const NOTIFICATION_ROLES = ['owner', 'admin', 'member'] as const;

/** Who receives a notification; the server resolves it against the workspace's members. At least one part. */
export const NotificationAudienceSchema = z
  .object({
    /** Members, by user id. */
    users: z.array(z.string().min(1)).max(500).optional(),
    /** Every member with one of these roles. */
    roles: z.array(z.enum(NOTIFICATION_ROLES)).optional(),
    /** Every member. */
    all: z.boolean().optional(),
    /** The person behind the caller (a signed-in user, or the one the agent acts for); not for automations. */
    me: z.boolean().optional(),
  })
  .refine((to) => (to.users?.length ?? 0) > 0 || (to.roles?.length ?? 0) > 0 || to.all === true || to.me === true, {
    message: 'Name at least one recipient: users, roles, all or me',
  })
  .meta({ id: 'NotificationAudience' });
export type NotificationAudience = z.infer<typeof NotificationAudienceSchema>;

/** What a sender provides; everything but `title` and `to` is optional. */
export const NotificationInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the notification a title').max(NOTIFICATION_TITLE_MAX),
    body: z.string().trim().max(NOTIFICATION_BODY_MAX).optional(),
    level: z.enum(NOTIFICATION_LEVELS).default('info'),
    kind: z
      .string()
      .regex(NOTIFICATION_KIND_PATTERN, 'Kinds are dotted names')
      .max(64)
      .default(NOTIFICATION_DEFAULT_KIND),
    key: z.string().trim().min(1).max(NOTIFICATION_KEY_MAX).optional(),
    target: NotificationTargetSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    to: NotificationAudienceSchema,
  })
  .meta({ id: 'NotificationInput' });
export type NotificationInput = z.input<typeof NotificationInputSchema>;
export type ParsedNotificationInput = z.output<typeof NotificationInputSchema>;

export const NotificationSendResultSchema = z
  .object({
    /** Distinct members the notification reached. */
    recipients: z.number().int(),
    created: z.number().int(),
    /** Unread notifications with the same `key` that were replaced instead. */
    updated: z.number().int(),
  })
  .meta({ id: 'NotificationSendResult' });
export type NotificationSendResult = z.infer<typeof NotificationSendResultSchema>;

/** What a list call takes. Over HTTP the values arrive as strings, so the schema coerces `limit` and `unread`. */
export const NotificationQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(NOTIFICATION_MAX_LIMIT).optional(),
    /** Only unread ones. */
    unread: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).optional(),
  })
  .meta({ id: 'NotificationQuery' });
/** The query as clients write it: typed values, which the schema accepts as they are. */
export interface NotificationQuery {
  cursor?: string;
  limit?: number;
  unread?: boolean;
}

export const NotificationPageSchema = z
  .object({ items: z.array(NotificationSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'NotificationPage' });
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const UnreadCountSchema = z.object({ count: z.number().int() }).meta({ id: 'UnreadCount' });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

export const MarkAllReadResultSchema = z.object({ updated: z.number().int() }).meta({ id: 'MarkAllReadResult' });
export type MarkAllReadResult = z.infer<typeof MarkAllReadResultSchema>;

/** Notification pages are keyed by (createdAt, id), newest first; the cursor is the last row of the previous page. */
export const encodeNotificationCursor = (row: { createdAt: string; id: string }): string =>
  `${row.createdAt}~${row.id}`;

export const decodeNotificationCursor = (cursor: string): { createdAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('~');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const createdAt = cursor.slice(0, at);
  const id = cursor.slice(at + 1);

  return Number.isNaN(Date.parse(createdAt)) ? undefined : { createdAt, id };
};
