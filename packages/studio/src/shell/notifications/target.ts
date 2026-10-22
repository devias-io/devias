import { type Notification, type NotificationTarget, objectByKey, type SchemaIndex } from '@devias/core';
import { useCallback } from 'react';
import { useMarkNotificationRead } from '../../hooks/use-notifications';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { resolveViewParam } from '../nav-targets';

/** Where a notification leads, as an href. A record's object may be named by API name or id. */
export const notificationTargetHref = (
  target: NotificationTarget,
  slug: string,
  index: SchemaIndex,
): { href: string; external: boolean } => {
  switch (target.kind) {
    case 'record': {
      const object = index.objectsById.get(target.object)?.nameSingular ?? target.object;

      return { href: links.record(slug, object, target.id), external: false };
    }
    case 'settings':
      return { href: links.settings(slug, target.section), external: false };
    case 'workflow':
      return { href: links.workflowEditor(slug, target.id), external: false };
    case 'document':
      return { href: links.document(slug, target.id), external: false };
    case 'task':
      return { href: links.task(slug, target.id), external: false };
    case 'object': {
      const object = objectByKey(index, target.object)?.nameSingular ?? target.object;

      return { href: links.object(slug, object, resolveViewParam(index, target.view)), external: false };
    }
    case 'page':
      return { href: links.page(slug, target.pagePath), external: false };
    case 'url':
      return { href: target.url, external: target.external ?? !target.url.startsWith('/') };
  }
};

/** The body's first line without its Markdown markers, for a toast. */
export const firstLine = (body: string | null | undefined): string | undefined => {
  const line = body
    ?.split('\n')
    .map((part) => part.trim())
    .find(Boolean);

  if (!line) {
    return undefined;
  }

  return (
    line
      .replace(/^(?:[#>*\-+]+|\d+\.)\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .trim() || undefined
  );
};

/** Opening a notification: it is marked read, and its target (if any) opens; external urls in a new tab. */
export const useOpenNotification = () => {
  const { slug } = useWorkspace();
  const { index } = useSchema();
  const navigation = useNavigation();
  const { mutate: markRead } = useMarkNotificationRead();

  return useCallback(
    (notification: Notification) => {
      if (!notification.readAt) {
        markRead(notification.id);
      }

      if (!notification.target) {
        return;
      }

      const { href, external } = notificationTargetHref(notification.target, slug, index);

      if (external) {
        window.open(href, '_blank', 'noopener,noreferrer');
      } else {
        navigation.navigate(href);
      }
    },
    [markRead, slug, index, navigation],
  );
};
