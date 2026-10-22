import { coreIds, NOTIFICATION_DEFAULT_LIMIT, type Notification } from '@devias/core';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useClient } from '../../providers/client';
import { useDock } from '../dock';
import { useNotificationInbox } from './inbox-store';
import { firstLine, useOpenNotification } from './target';

const toastFor = { info: toast.info, success: toast.success, warning: toast.warning, error: toast.error } as const;

/** One toast for a notification: its title, the body's first line and "Open" when it leads somewhere. */
export const showNotificationToast = (notification: Notification, open: (notification: Notification) => void): void => {
  toastFor[notification.level](notification.title, {
    id: `notification:${notification.id}`,
    description: firstLine(notification.body),
    ...(notification.target ? { action: { label: 'Open', onClick: () => open(notification) } } : {}),
  });
};

/**
 * Toasts for notifications that arrive over the live feed while the notifications panel is closed. Renders nothing:
 * it watches the inbox the live updates fill, looks the new ones up in the unread page and toasts each.
 */
export function NotificationToasts() {
  const client = useClient();
  const arrived = useNotificationInbox((state) => state.arrived);
  const panelOpen = useDock((state) => state.openId === coreIds.blocks.notifications);
  const open = useOpenNotification();
  useEffect(() => {
    if (arrived.length === 0) {
      return;
    }

    const ids = new Set(useNotificationInbox.getState().take());

    // The open panel shows them itself.
    if (panelOpen || ids.size === 0) {
      return;
    }

    client.notifications
      .list({ unread: true, limit: NOTIFICATION_DEFAULT_LIMIT })
      .then((page) => {
        // Oldest first, so the newest toast ends up on top.
        for (const notification of page.items.filter((item) => ids.has(item.id)).reverse()) {
          showNotificationToast(notification, open);
        }
      })
      .catch(() => {
        // Nothing to toast; the bell's count still changes.
      });
  }, [arrived, panelOpen, client, open]);

  return null;
}
