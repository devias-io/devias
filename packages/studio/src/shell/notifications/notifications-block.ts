import { coreIds, defineBlockComponent } from '@devias/core';
import { useUnreadNotificationCount } from '../../hooks/use-notifications';
import { NotificationsPanel } from './notifications-panel';

/** The count on the bell: unread notifications, nothing before it loads or at 0. */
export const useNotificationBadge = (): number | undefined => useUnreadNotificationCount().data;

/** The person's notifications, docked beside the content behind the bell in the top bar (⌘I). */
export const notificationsBlock = defineBlockComponent({
  id: coreIds.blocks.notifications,
  label: 'Notifications',
  icon: 'bell',
  surfaces: { panel: { shortcut: 'mod+i', defaultSize: 26, minSize: 18, useBadge: useNotificationBadge } },
  component: NotificationsPanel,
});
