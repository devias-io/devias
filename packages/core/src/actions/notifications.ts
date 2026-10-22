import { z } from 'zod';
import { coreIds } from '../core-ids';
import {
  MarkAllReadResultSchema,
  NotificationInputSchema,
  NotificationPageSchema,
  NotificationQuerySchema,
  NotificationSchema,
  NotificationSendResultSchema,
  UnreadCountSchema,
} from '../notifications';
import { defineActionSpec } from './define';

const tags = ['notifications'];
const IdParams = z.object({ id: z.string() });

/**
 * Notifications: a person's inbox (their own rows only, so people only) and sending to others, which workflows,
 * module actions and the agent do as well.
 */
export const notificationActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_notifications,
    ai: {
      tool: 'list_notifications',
      description:
        "The person's notifications, newest first: title, Markdown body, level, where each one points and whether it was read. Pass unread=true for the unread ones only; page with nextCursor.",
    },
    summary: 'List my notifications',
    description:
      'The caller’s notifications, newest first. `unread=true` keeps the unread ones; page with `nextCursor`.',
    tags,
    permission: 'notification.read',
    sessionOnly: true,
    query: NotificationQuerySchema,
    output: NotificationPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/notifications',
      errors: [400, 401, 403],
      outputDescription: 'A page of notifications',
    },
  }),
  unreadCount: defineActionSpec({
    id: coreIds.actions.count_unread_notifications,
    summary: 'Count my unread notifications',
    tags,
    permission: 'notification.read',
    sessionOnly: true,
    output: UnreadCountSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/notifications/unread-count',
      outputDescription: 'How many are unread',
    },
  }),
  send: defineActionSpec({
    id: coreIds.actions.send_notification,
    ai: {
      tool: 'send_notification',
      description:
        'Notify people in the workspace: a title, an optional Markdown body, a level (info, success, warning, error), where it points (a record, an object, a tool, a workflow, settings or a URL) and who gets it (to.users by user id, to.roles, to.all, or to.me for the person you act for). Repeated sends with the same key replace the unread one. Asks for approval.',
    },
    summary: 'Send a notification',
    description:
      'Notify members: everyone (`to.all`), roles (`to.roles`), people by user id (`to.users`) or the caller (`to.me`). `target` says where it leads; a repeated `key` replaces the unread notification instead of adding one.',
    tags,
    permission: 'notification.send',
    body: NotificationInputSchema,
    output: NotificationSendResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/notifications',
      status: 201,
      errors: [400, 401, 403],
      bodyDescription: 'The notification and who receives it',
      outputDescription: 'How many people it reached, and how many notifications were created or replaced',
    },
  }),
  markRead: defineActionSpec({
    id: coreIds.actions.mark_notification_read,
    summary: 'Mark a notification read',
    tags,
    permission: 'notification.read',
    readOnly: false,
    approval: 'auto',
    sessionOnly: true,
    params: IdParams,
    output: NotificationSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/notifications/{id}/read',
      errors: [401, 403, 404],
      outputDescription: 'The notification',
    },
  }),
  markUnread: defineActionSpec({
    id: coreIds.actions.mark_notification_unread,
    summary: 'Mark a notification unread',
    tags,
    permission: 'notification.read',
    readOnly: false,
    approval: 'auto',
    sessionOnly: true,
    params: IdParams,
    output: NotificationSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/notifications/{id}/unread',
      errors: [401, 403, 404],
      outputDescription: 'The notification',
    },
  }),
  markAllRead: defineActionSpec({
    id: coreIds.actions.mark_all_notifications_read,
    summary: 'Mark all my notifications read',
    tags,
    permission: 'notification.read',
    readOnly: false,
    sessionOnly: true,
    output: MarkAllReadResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/notifications/read-all',
      errors: [401, 403],
      outputDescription: 'How many were unread',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_notification,
    summary: 'Delete a notification',
    tags,
    permission: 'notification.read',
    readOnly: false,
    sessionOnly: true,
    params: IdParams,
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/notifications/{id}', outputDescription: 'Deleted' },
  }),
};
