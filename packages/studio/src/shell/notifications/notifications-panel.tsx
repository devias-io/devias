import type { Notification, NotificationLevel } from '@devias/core';
import { Button, cn, EmptyState, Icon, type IconName, Skeleton, UnderlineTabs } from '@devias/ui';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { RichMarkdown } from '../../components/markdown';
import { useAgentNames } from '../../hooks/use-agents';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotifications,
  useUnreadNotificationCount,
} from '../../hooks/use-notifications';
import { ago } from '../../lib/time';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { senderOf } from './sender';
import { useOpenNotification } from './target';

type Filter = 'all' | 'unread';

const LEVELS: Record<NotificationLevel, { icon: IconName; className: string }> = {
  info: { icon: 'info', className: 'text-muted-foreground' },
  success: { icon: 'circle-check', className: 'text-success' },
  warning: { icon: 'triangle-alert', className: 'text-warning' },
  error: { icon: 'circle-x', className: 'text-destructive' },
};

function RowAction({ label, icon, onClick }: { label: string; icon: IconName; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <Icon name={icon} />
    </Button>
  );
}

/**
 * One notification: the level's icon, the title (a button that stretches over the row and opens the notification),
 * the body as Markdown, and who sent it when. The row's actions show on hover and focus (always on touch screens).
 */
function NotificationRow({
  notification,
  sender,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  notification: Notification;
  sender: string;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const unread = !notification.readAt;
  const level = LEVELS[notification.level];
  const date = new Date(notification.createdAt);

  return (
    <li
      data-notification={notification.id}
      data-level={notification.level}
      data-unread={unread ? '' : undefined}
      className="group/row relative flex gap-3 px-3 py-3 transition-colors hover:bg-muted/40 has-[[data-open-notification]:focus-visible]:bg-muted/40"
    >
      <Icon name={level.icon} className={cn('mt-0.5 size-4', level.className)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            data-open-notification
            className="min-w-0 flex-1 text-left text-xs leading-snug outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
            onClick={onOpen}
          >
            {unread ? <span className="sr-only">Unread: </span> : null}
            <span className={cn('line-clamp-2 text-foreground', unread && 'font-medium')}>{notification.title}</span>
          </button>
          {/* Above the stretched button, so the actions get their own clicks. They stay in the accessibility tree and
              become visible on hover, on focus, and always where there is no hover (touch screens). */}
          <div className="relative z-10 flex h-5 shrink-0 items-center">
            {unread ? <span aria-hidden className="mx-1.5 size-1.5 rounded-full bg-brand" /> : null}
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100">
              <RowAction
                label={unread ? 'Mark read' : 'Mark unread'}
                icon={unread ? 'check' : 'mail'}
                onClick={onToggleRead}
              />
              <RowAction label="Delete notification" icon="trash-2" onClick={onDelete} />
            </span>
          </div>
        </div>
        {notification.body ? (
          <RichMarkdown
            text={notification.body}
            className="mt-1 gap-1 text-xs text-muted-foreground [&_a]:relative [&_a]:z-10"
          />
        ) : null}
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{sender}</span>
          <span aria-hidden>·</span>
          <time dateTime={notification.createdAt} title={format(date, 'PPpp')} className="shrink-0 tabular-nums">
            {ago(date)}
          </time>
        </div>
      </div>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="mt-0.5 size-4 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The docked notifications panel: the title and "Mark all read" in the header, an All/Unread filter, then the
 * notifications newest first. Opening one marks it read and goes where it points; rows can be marked read or unread
 * and deleted.
 */
export function NotificationsPanel() {
  const [filter, setFilter] = useState<Filter>('all');
  const unreadOnly = filter === 'unread';
  const notifications = useNotifications({ unread: unreadOnly });
  const unreadCount = useUnreadNotificationCount().data ?? 0;
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const remove = useDeleteNotification();
  const open = useOpenNotification();
  const { members, user } = useWorkspace();
  const agents = useAgentNames();
  const { schema } = useSchema();
  const modules = useMemo(() => new Map(schema.modules.map((module) => [module.id, module.label])), [schema.modules]);
  const people = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);
  const items = useMemo(() => notifications.data?.pages.flatMap((page) => page.items) ?? [], [notifications.data]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="notifications-panel">
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon name="bell" className="size-5 text-muted-foreground" />
        <h2 className="truncate text-xs font-medium">Notifications</h2>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </Button>
      </div>
      <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
        <UnderlineTabs
          variant="pill"
          aria-label="Filter notifications"
          value={filter}
          onValueChange={(id) => setFilter(id as Filter)}
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread', count: unreadCount > 0 ? unreadCount : undefined },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {notifications.isPending ? (
          <RowsSkeleton />
        ) : notifications.isError ? (
          <EmptyState icon="circle-alert" title="Could not load notifications" description="Try again in a moment." />
        ) : items.length === 0 ? (
          unreadOnly ? (
            <EmptyState icon="circle-check" title="You're all caught up." />
          ) : (
            <EmptyState
              icon="bell"
              title="No notifications yet."
              description="What workflows, modules and the agent send you shows up here."
            />
          )
        ) : (
          <ol className="divide-y divide-border" aria-label="Notifications">
            {items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                sender={senderOf(notification.actor, { members: people, agents, selfId: user.id, modules })}
                onOpen={() => open(notification)}
                onToggleRead={() =>
                  notification.readAt ? markUnread.mutate(notification.id) : markRead.mutate(notification.id)
                }
                onDelete={() => remove.mutate(notification.id)}
              />
            ))}
          </ol>
        )}
        {notifications.hasNextPage ? (
          <div className="p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
