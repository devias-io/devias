import {
  type Actor,
  DeviasApiError,
  decodeNotificationCursor,
  encodeNotificationCursor,
  type MarkAllReadResult,
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_RETENTION_PER_RECIPIENT,
  type Notification,
  type NotificationAudience,
  NotificationInputSchema,
  type NotificationPage,
  type NotificationQuery,
  NotificationQuerySchema,
  type NotificationSendResult,
  personOf,
  type UnreadCount,
} from '@devias/core';
import type { ZodError } from 'zod';
import type { MockStore } from './store';

/**
 * Notifications over the store, with the server's semantics. The caller is the store's actor: the inbox calls (list,
 * count, mark, delete) see their own rows only and need a person behind the actor, as the engine demands; sending
 * resolves the audience against the store's members. A repeated `key` replaces the unread notification, read ones
 * past the retention limit are pruned, and every change emits `notification.changed` for its recipient.
 */

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

/** Issues as the server reports them: a dotted path, the code and the message. */
const invalid = (message: string, error: ZodError): DeviasApiError =>
  validation(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });

/** Whose inbox a call is about. Keys and automations have none, whatever else they may do. */
const requirePerson = (store: MockStore): string => {
  const person = personOf(store.actor);

  if (!person) {
    throw new DeviasApiError(403, 'FORBIDDEN', 'Notifications belong to people');
  }

  return person;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One of the person's own notifications, or 404: another member's look like they do not exist. */
const ownRow = (store: MockStore, person: string, id: string): Notification => {
  if (!UUID.test(id)) {
    throw validation(`Invalid notification id "${id}"`, { id });
  }

  const row = store.notifications.find((candidate) => candidate.id === id && candidate.recipientId === person);

  if (!row) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Notification "${id}" not found`);
  }

  return row;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The list order and the cursor's keyset: `createdAt` desc, then `id` desc. */
const newestFirst = (a: Pick<Notification, 'createdAt' | 'id'>, b: Pick<Notification, 'createdAt' | 'id'>): number =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || compareIds(b.id, a.id);

const announce = (
  store: MockStore,
  recipientId: string,
  notificationId: string | null,
  action: 'created' | 'read' | 'deleted',
): void => {
  store.emit({ type: 'notification.changed', recipientId, notificationId, action });
};

/**
 * The member ids an audience names, without duplicates: `users` must be members, `roles` and `all` pick from the
 * store's members, and `me` is the person behind the actor. Automations have no person, so `me` is a VALIDATION
 * error for them, as on the server; so are unknown user ids.
 */
export const resolveNotificationAudience = (
  store: MockStore,
  to: NotificationAudience,
  actor: Actor = store.actor,
): string[] => {
  const recipients = new Set<string>();

  if (to.me) {
    const person = personOf(actor);

    if (!person) {
      throw validation('to.me needs a signed-in person', { path: 'to.me' });
    }

    recipients.add(person);
  }

  if (to.users && to.users.length > 0) {
    const known = new Set(store.members.map((member) => member.id));
    const unknown = [...new Set(to.users.filter((id) => !known.has(id)))];

    if (unknown.length > 0) {
      throw validation(`Not members of this workspace: ${unknown.join(', ')}`, { path: 'to.users', unknown });
    }

    for (const id of to.users) {
      recipients.add(id);
    }
  }

  for (const member of store.members) {
    if (to.all || to.roles?.includes(member.role)) {
      recipients.add(member.id);
    }
  }

  return [...recipients];
};

/** After an insert a recipient keeps at most NOTIFICATION_RETENTION_PER_RECIPIENT read ones; unread ones stay. */
const prune = (store: MockStore, recipientId: string): void => {
  const read = store.notifications
    .filter((row) => row.recipientId === recipientId && row.readAt !== null)
    .sort(newestFirst);

  if (read.length <= NOTIFICATION_RETENTION_PER_RECIPIENT) {
    return;
  }

  const dropped = new Set(read.slice(NOTIFICATION_RETENTION_PER_RECIPIENT).map((row) => row.id));
  store.notifications = store.notifications.filter((row) => !dropped.has(row.id));
};

/**
 * Validate, resolve the audience and write one notification per recipient as the store's actor. With a `key`, a
 * recipient's unread notification with the same key takes the new content and moves to the top instead.
 */
export const sendNotification = (store: MockStore, rawInput: unknown): NotificationSendResult => {
  const parsed = NotificationInputSchema.safeParse(rawInput);

  if (!parsed.success) {
    throw invalid('Invalid notification', parsed.error);
  }

  const input = parsed.data;
  const recipients = resolveNotificationAudience(store, input.to);
  const now = store.now();
  const content = {
    level: input.level,
    title: input.title,
    body: input.body ? input.body : null,
    target: input.target ?? null,
    data: input.data ?? null,
    actor: store.actor,
  };
  let created = 0;
  let updated = 0;

  for (const recipientId of recipients) {
    // The newest unread one with that key, as the server picks it.
    const unread = input.key
      ? store.notifications
          .filter((row) => row.recipientId === recipientId && row.key === input.key && row.readAt === null)
          .sort(newestFirst)[0]
      : undefined;
    let row: Notification;

    if (unread) {
      Object.assign(unread, structuredClone(content), { createdAt: now, updatedAt: now });
      store.notifications.splice(store.notifications.indexOf(unread), 1);
      store.notifications.push(unread);
      row = unread;
      updated += 1;
    } else {
      row = {
        id: store.newId(),
        workspaceId: store.workspaceId,
        recipientId,
        kind: input.kind,
        key: input.key ?? null,
        ...structuredClone(content),
        readAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.notifications.push(row);
      created += 1;
      prune(store, recipientId);
    }

    announce(store, recipientId, row.id, 'created');
  }

  store.changed();

  return { recipients: recipients.length, created, updated };
};

/** The person's notifications, newest first, with the server's keyset cursor; `unread` keeps the unread ones. */
export const listNotifications = (store: MockStore, query: NotificationQuery = {}): NotificationPage => {
  const person = requirePerson(store);
  const parsed = NotificationQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw invalid('Invalid notification query', parsed.error);
  }

  const { cursor, unread } = parsed.data;
  const limit = parsed.data.limit ?? NOTIFICATION_DEFAULT_LIMIT;
  let rows = store.notifications
    .filter((row) => row.recipientId === person && (!unread || row.readAt === null))
    .sort(newestFirst);

  if (cursor !== undefined) {
    const after = decodeNotificationCursor(cursor);

    if (!after) {
      throw new DeviasApiError(400, 'INVALID_CURSOR', 'The notifications cursor is malformed');
    }

    rows = rows.filter((row) => newestFirst(row, after) > 0);
  }

  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items: structuredClone(items),
    nextCursor: rows.length > limit && last ? encodeNotificationCursor(last) : null,
  };
};

export const countUnreadNotifications = (store: MockStore): UnreadCount => {
  const person = requirePerson(store);

  return { count: store.notifications.filter((row) => row.recipientId === person && row.readAt === null).length };
};

/** Flip one notification's read state; a flip to where it already is changes nothing and emits nothing. */
const setRead = (store: MockStore, id: string, read: boolean): Notification => {
  const person = requirePerson(store);
  const row = ownRow(store, person, id);

  if ((row.readAt !== null) !== read) {
    const now = store.now();
    row.readAt = read ? now : null;
    row.updatedAt = now;
    announce(store, person, id, 'read');
    store.changed();
  }

  return structuredClone(row);
};

export const markNotificationRead = (store: MockStore, id: string): Notification => setRead(store, id, true);

export const markNotificationUnread = (store: MockStore, id: string): Notification => setRead(store, id, false);

/** Mark every unread notification of the person read; one event, with no notification id, when any was. */
export const markAllNotificationsRead = (store: MockStore): MarkAllReadResult => {
  const person = requirePerson(store);
  const now = store.now();
  let updated = 0;

  for (const row of store.notifications) {
    if (row.recipientId !== person || row.readAt !== null) {
      continue;
    }

    row.readAt = now;
    row.updatedAt = now;
    updated += 1;
  }

  if (updated > 0) {
    announce(store, person, null, 'read');
    store.changed();
  }

  return { updated };
};

export const deleteNotification = (store: MockStore, id: string): void => {
  const person = requirePerson(store);
  const row = ownRow(store, person, id);
  store.notifications.splice(store.notifications.indexOf(row), 1);
  announce(store, person, id, 'deleted');
  store.changed();
};
