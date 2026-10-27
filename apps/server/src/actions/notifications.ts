import { notificationActions as notifications } from '@devias/core';
import { type Action, type ActionDeps, implement } from './types';

/** The caller's inbox (the engine keeps each person to their own rows) and sending, which resolves `to` first. */
export const notificationActions = ({ engine, notifier }: ActionDeps): Action[] => [
  implement(notifications.list, (query, ctx) => engine.notifications.list(ctx, query)),
  implement(notifications.unreadCount, (_input, ctx) => engine.notifications.unreadCount(ctx)),
  implement(notifications.send, (input, ctx) => notifier.send(ctx, input)),
  implement(notifications.markRead, ({ id }, ctx) => engine.notifications.markRead(ctx, id)),
  implement(notifications.markUnread, ({ id }, ctx) => engine.notifications.markUnread(ctx, id)),
  implement(notifications.markAllRead, (_input, ctx) => engine.notifications.markAllRead(ctx)),
  implement(notifications.delete, ({ id }, ctx) => engine.notifications.delete(ctx, id)),
];
