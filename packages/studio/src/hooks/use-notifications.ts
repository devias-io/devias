import {
  type MarkAllReadResult,
  NOTIFICATION_DEFAULT_LIMIT,
  type Notification,
  type NotificationPage,
  type UnreadCount,
} from '@devias/core';
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** The person's notifications, newest first, a page at a time; `unread` keeps the unread ones. */
export const useNotifications = ({ unread = false }: { unread?: boolean } = {}) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.notificationList(client.workspaceId, unread),
    queryFn: ({ pageParam }) =>
      client.notifications.list({
        limit: NOTIFICATION_DEFAULT_LIMIT,
        ...(unread ? { unread: true } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** How many are unread (`data`), for the bell; live updates and the mutations here keep it fresh. */
export const useUnreadNotificationCount = () => {
  const client = useClient();

  return useQuery({
    queryKey: keys.unreadNotifications(client.workspaceId),
    queryFn: () => client.notifications.unreadCount(),
    staleTime: 30_000,
    select: (data) => data.count,
  });
};

type Pages = InfiniteData<NotificationPage>;
type Snapshot = [readonly unknown[], unknown][];
/** What a mutation does to each cached notification: a replacement, or null to drop it. */
type Change = (notification: Notification) => Notification | null;

const isPages = (data: unknown): data is Pages =>
  typeof data === 'object' && data !== null && Array.isArray((data as Pages).pages);

const applyChange = (data: Pages, change: Change): Pages => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    items: page.items.flatMap((item) => {
      const next = change(item);

      return next ? [next] : [];
    }),
  })),
});

const unreadIn = (data: Pages): number =>
  data.pages.reduce((total, page) => total + page.items.filter((item) => !item.readAt).length, 0);

/**
 * The shared shape of the inbox mutations: the cached lists show the change at once and the unread count moves with
 * it (`count` says how, from the change seen in the lists), everything rolls back on error, and whatever sits under
 * the notifications key refetches once the server has answered.
 */
const useInboxMutation = <TVariables, TResult>(
  run: (variables: TVariables) => Promise<TResult>,
  change: (variables: TVariables) => Change,
  count: (current: number, delta: number) => number = (current, delta) => Math.max(0, current + delta),
) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const ws = client.workspaceId;

  return useMutation({
    mutationFn: run,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: keys.notifications(ws) });
      const snapshot: Snapshot = queryClient.getQueriesData({ queryKey: keys.notifications(ws) });
      const apply = change(variables);
      let delta: number | undefined;

      for (const unread of [false, true]) {
        const key = keys.notificationList(ws, unread);
        const before = queryClient.getQueryData(key);

        if (!isPages(before)) {
          continue;
        }

        const after = applyChange(before, apply);
        queryClient.setQueryData(key, after);
        delta ??= unreadIn(after) - unreadIn(before);
      }

      queryClient.setQueryData(keys.unreadNotifications(ws), (current: UnreadCount | undefined) =>
        current ? { count: count(current.count, delta ?? 0) } : current,
      );

      return { snapshot };
    },
    onError: (error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }

      toast.error(errorMessage(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications(ws) });
    },
  });
};

export const useMarkNotificationRead = () => {
  const client = useClient();

  return useInboxMutation(
    (id: string) => client.notifications.markRead(id),
    (id) => (notification) =>
      notification.id === id && !notification.readAt
        ? { ...notification, readAt: new Date().toISOString() }
        : notification,
  );
};

export const useMarkNotificationUnread = () => {
  const client = useClient();

  return useInboxMutation(
    (id: string) => client.notifications.markUnread(id),
    (id) => (notification) =>
      notification.id === id && notification.readAt ? { ...notification, readAt: null } : notification,
  );
};

export const useMarkAllNotificationsRead = () => {
  const client = useClient();

  return useInboxMutation<void, MarkAllReadResult>(
    () => client.notifications.markAllRead(),
    () => (notification) =>
      notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() },
    () => 0,
  );
};

export const useDeleteNotification = () => {
  const client = useClient();

  return useInboxMutation(
    (id: string) => client.notifications.delete(id),
    (id) => (notification) => (notification.id === id ? null : notification),
  );
};
