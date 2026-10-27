import type {
  AuthAdapter,
  BlockDefinition,
  DeviasClient,
  Notification,
  NotificationPage,
  NotificationQuery,
  WorkspaceEvent,
} from '@devias/core';
import { coreIds, indexSchema } from '@devias/core';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/providers/auth';
import { LiveUpdatesProvider } from '../src/providers/live-updates';
import { keys } from '../src/query/keys';
import { createStaticNavigation } from '../src/router/navigation';
import { useDock } from '../src/shell/dock';
import { useNotificationInbox } from '../src/shell/notifications/inbox-store';
import { NotificationToasts } from '../src/shell/notifications/notification-toasts';
import { useNotificationBadge } from '../src/shell/notifications/notifications-block';
import { NotificationsPanel } from '../src/shell/notifications/notifications-panel';
import { senderOf } from '../src/shell/notifications/sender';
import { firstLine, notificationTargetHref } from '../src/shell/notifications/target';
import { StudioTopbar } from '../src/shell/topbar';
import {
  agentFixture,
  createFakeClient,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../src/testing';

// Toasts are observed through the module, not the DOM: sonner renders nothing without its host.
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  const mocked = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() });

  return { ...actual, toast: mocked };
});

beforeEach(() => {
  useDock.setState({ openId: null });
  useNotificationInbox.setState({ arrived: [] });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

const now = new Date().toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const notification = (over: Partial<Notification> & Pick<Notification, 'id' | 'title'>): Notification => ({
  workspaceId: 'ws1',
  recipientId: 'u1',
  kind: 'general',
  level: 'info',
  body: null,
  target: null,
  key: null,
  data: null,
  actor: { kind: 'user', id: 'u2' },
  readAt: null,
  createdAt: minutesAgo(5),
  updatedAt: minutesAgo(5),
  ...over,
});

/** Three notifications, newest first: a module's, a workflow's and a read one from the agent. */
const seed = (): Notification[] => [
  notification({
    id: 'n3',
    title: 'Payment received',
    level: 'success',
    kind: 'billing.payment_received',
    body: 'Acme paid **invoice #12**.',
    target: { kind: 'record', object: 'person', id: 'p1' },
    actor: { kind: 'function', id: 'billing.record_payment' },
    createdAt: minutesAgo(1),
  }),
  notification({
    id: 'n2',
    title: 'Sync failed',
    level: 'error',
    actor: { kind: 'workflow', id: 'wf1' },
    createdAt: minutesAgo(30),
  }),
  notification({
    id: 'n1',
    title: 'Welcome aboard',
    actor: { kind: 'agent', id: 'a0', onBehalfOf: { kind: 'user', id: 'u2' } },
    readAt: minutesAgo(60),
    createdAt: minutesAgo(120),
  }),
];

/** An in-memory `client.notifications` over the seed, with spies. */
const fakeNotifications = () => {
  let rows = seed();
  const find = (id: string) => {
    const row = rows.find((n) => n.id === id);

    if (!row) {
      throw new Error(`notification ${id} not found`);
    }

    return row;
  };

  return {
    list: vi.fn(async (query?: NotificationQuery) => ({
      items: rows.filter((n) => !query?.unread || !n.readAt),
      nextCursor: null,
    })),
    unreadCount: vi.fn(async () => ({ count: rows.filter((n) => !n.readAt).length })),
    send: vi.fn(async () => ({ recipients: 0, created: 0, updated: 0 })),
    markRead: vi.fn(async (id: string) => {
      rows = rows.map((n) => (n.id === id ? { ...n, readAt: now } : n));

      return find(id);
    }),
    markUnread: vi.fn(async (id: string) => {
      rows = rows.map((n) => (n.id === id ? { ...n, readAt: null } : n));

      return find(id);
    }),
    markAllRead: vi.fn(async () => {
      const updated = rows.filter((n) => !n.readAt).length;
      rows = rows.map((n) => ({ ...n, readAt: n.readAt ?? now }));

      return { updated };
    }),
    delete: vi.fn(async (id: string) => {
      rows = rows.filter((n) => n.id !== id);
    }),
  } satisfies DeviasClient['notifications'];
};

const renderPanel = (navigation = createStaticNavigation('/workspaces/acme')) => {
  const notifications = fakeNotifications();
  const ai = { agents: { list: async () => [agentFixture({ id: 'a0', label: 'Assistant' })] } } as never;
  const client = createFakeClient(schemaFixture(), recordsFixture(), { notifications, ai });
  render(
    <TestProviders client={client} navigation={navigation}>
      <NotificationsPanel />
    </TestProviders>,
  );

  return { notifications };
};

const rows = () => [...document.querySelectorAll('[data-notification]')];

describe('NotificationsPanel', () => {
  it('lists notifications newest first with their level, sender, body and unread state', async () => {
    renderPanel();
    expect(await screen.findByText('Payment received')).toBeTruthy();
    expect(rows().map((el) => el.getAttribute('data-notification'))).toEqual(['n3', 'n2', 'n1']);
    expect(rows().map((el) => el.getAttribute('data-level'))).toEqual(['success', 'error', 'info']);
    expect(rows().map((el) => el.hasAttribute('data-unread'))).toEqual([true, true, false]);
    // Unread titles are emphasised; read ones are not.
    expect(screen.getByText('Payment received').className).toContain('font-medium');
    expect(screen.getByText('Welcome aboard').className).not.toContain('font-medium');
    // Bodies are Markdown; senders are named like the activity timeline.
    expect(screen.getByText('invoice #12').tagName).toBe('STRONG');
    expect(screen.getByText('Module billing')).toBeTruthy();
    expect(screen.getByText('Workflow')).toBeTruthy();
    expect(screen.getByText('Assistant for Grace Hopper')).toBeTruthy();
    // The Unread tab carries the count.
    expect(screen.getByRole('tab', { name: /Unread/ }).textContent).toBe('Unread2');
  });

  it('filters to the unread ones and marks them all read', async () => {
    const { notifications } = renderPanel();
    await screen.findByText('Payment received');
    fireEvent.click(screen.getByRole('tab', { name: /Unread/ }));
    await waitFor(() => expect(rows().map((el) => el.getAttribute('data-notification'))).toEqual(['n3', 'n2']));
    const markAll = screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement;
    expect(markAll.disabled).toBe(false);
    fireEvent.click(markAll);
    await waitFor(() => expect(notifications.markAllRead).toHaveBeenCalledTimes(1));
    // The unread list refetches and empties; nothing is left to mark.
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
    await waitFor(() => expect(markAll.disabled).toBe(true));
    expect(notifications.list.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('opens a notification: marks it read and goes to its record', async () => {
    const navigation = { ...createStaticNavigation('/workspaces/acme'), navigate: vi.fn() };
    const { notifications } = renderPanel(navigation);
    // Unread rows announce their state in the button's name.
    fireEvent.click(await screen.findByRole('button', { name: /Payment received/ }));
    await waitFor(() => expect(notifications.markRead).toHaveBeenCalledWith('n3'));
    expect(navigation.navigate).toHaveBeenCalledWith('/workspaces/acme/records/person/p1');
    // A read one opens without another round trip, and without a target it stays put.
    fireEvent.click(screen.getByRole('button', { name: /Welcome aboard/ }));
    expect(notifications.markRead).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
  });

  it('toggles read state and deletes from the row actions', async () => {
    const { notifications } = renderPanel();
    await screen.findByText('Payment received');
    const [, failed, welcome] = rows() as HTMLElement[];
    fireEvent.click(within(welcome as HTMLElement).getByRole('button', { name: 'Mark unread' }));
    await waitFor(() => expect(notifications.markUnread).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Unread/ }).textContent).toBe('Unread3'));
    fireEvent.click(within(failed as HTMLElement).getByRole('button', { name: 'Delete notification' }));
    await waitFor(() => expect(notifications.delete).toHaveBeenCalledWith('n2'));
    await waitFor(() => expect(rows().map((el) => el.getAttribute('data-notification'))).toEqual(['n3', 'n1']));
  });

  it('shows an empty state when there is nothing', async () => {
    const client = createFakeClient(schemaFixture(), recordsFixture());
    render(
      <TestProviders client={client}>
        <NotificationsPanel />
      </TestProviders>,
    );
    expect(await screen.findByText('No notifications yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads the next page with the cursor the previous one gave', async () => {
    const all = seed();
    const list = vi.fn(async (query?: NotificationQuery): Promise<NotificationPage> => {
      const start = query?.cursor ? Number(query.cursor) : 0;

      return { items: all.slice(start, start + 2), nextCursor: start + 2 < all.length ? String(start + 2) : null };
    });
    const client = createFakeClient(schemaFixture(), recordsFixture(), {
      notifications: { ...fakeNotifications(), list },
    });
    render(
      <TestProviders client={client}>
        <NotificationsPanel />
      </TestProviders>,
    );
    await screen.findByText('Payment received');
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '2' }));
    expect(rows().map((el) => el.getAttribute('data-notification'))).toEqual(['n3', 'n2', 'n1']);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a skeleton until the first page arrives', async () => {
    let deliver: (page: NotificationPage) => void = () => {};
    const list = vi.fn(
      () =>
        new Promise<NotificationPage>((resolve) => {
          deliver = resolve;
        }),
    );
    const client = createFakeClient(schemaFixture(), recordsFixture(), {
      notifications: { ...fakeNotifications(), list },
    });
    render(
      <TestProviders client={client}>
        <NotificationsPanel />
      </TestProviders>,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    deliver({ items: seed(), nextCursor: null });
    expect(await screen.findByText('Payment received')).toBeTruthy();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});

describe('live notifications', () => {
  const event = (over: Partial<WorkspaceEvent> & { sequence: number }): WorkspaceEvent =>
    ({
      workspaceId: 'ws1',
      actor: { kind: 'system', id: 'test' },
      occurredAt: now,
      type: 'notification.changed',
      recipientId: 'u1',
      notificationId: null,
      action: 'created',
      ...over,
    }) as WorkspaceEvent;

  it('refreshes the notification queries and queues my new ones for toasts, nobody else’s', async () => {
    vi.useFakeTimers();

    try {
      let deliver: ((event: WorkspaceEvent) => void) | undefined;
      const client = createFakeClient(schemaFixture(), recordsFixture());
      client.events.subscribe = (handler) => {
        deliver = handler;

        return () => {};
      };
      let queryClient: QueryClient | undefined;
      function Probe() {
        queryClient = useQueryClient();

        return null;
      }
      render(
        <TestProviders client={client}>
          <LiveUpdatesProvider>
            <Probe />
          </LiveUpdatesProvider>
        </TestProviders>,
      );

      if (!deliver || !queryClient) {
        throw new Error('the provider did not subscribe');
      }

      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      deliver(event({ sequence: 1, notificationId: 'n9' }));
      deliver(event({ sequence: 2, notificationId: 'n8', recipientId: 'u2' }));
      deliver(event({ sequence: 3, notificationId: 'n7', action: 'read' }));
      deliver(event({ sequence: 4, action: 'read' }));
      // Events are batched for 150 ms before anything happens.
      expect(useNotificationInbox.getState().arrived).toEqual([]);
      await vi.advanceTimersByTimeAsync(150);
      expect(useNotificationInbox.getState().arrived).toEqual(['n9']);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.notifications('ws1') });
    } finally {
      vi.useRealTimers();
    }
  });

  it('toasts a notification that arrived for me, with its first line and an Open action, unless the panel is open', async () => {
    const notifications = fakeNotifications();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { notifications });
    render(
      <TestProviders client={client}>
        <NotificationToasts />
      </TestProviders>,
    );
    act(() => useNotificationInbox.getState().arrive(['n3']));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Payment received',
        expect.objectContaining({
          id: 'notification:n3',
          description: 'Acme paid invoice #12.',
          action: expect.objectContaining({ label: 'Open' }),
        }),
      ),
    );
    expect(notifications.list).toHaveBeenCalledWith(expect.objectContaining({ unread: true }));
    // With the panel open the queue is drained without a toast: the panel shows the notification itself.
    act(() => useDock.setState({ openId: coreIds.blocks.notifications }));
    act(() => useNotificationInbox.getState().arrive(['n2']));
    await waitFor(() => expect(useNotificationInbox.getState().arrived).toEqual([]));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('notification badge', () => {
  it('counts the unread notifications', async () => {
    function Probe() {
      const count = useNotificationBadge();

      return <output>{count ?? 'loading'}</output>;
    }
    const client = createFakeClient(schemaFixture(), recordsFixture(), { notifications: fakeNotifications() });
    render(
      <TestProviders client={client}>
        <Probe />
      </TestProviders>,
    );
    expect(await screen.findByText('2')).toBeTruthy();
  });

  it('shows on the panel toggle in the top bar, capped at 99+', () => {
    const panel = (id: string, title: string, badge: number): BlockDefinition => ({
      id: `test.${id}`,
      label: title,
      icon: 'bell',
      surfaces: { panel: { useBadge: () => badge } },
      component: () => null,
    });
    const config = resolvedFixture({ blocks: [panel('pings', 'Pings', 3), panel('alerts', 'Alerts', 120)] });
    const client = createFakeClient(schemaFixture(), recordsFixture());
    render(
      <TestProviders client={client} config={config}>
        <AuthProvider value={{} as AuthAdapter}>
          <StudioTopbar />
        </AuthProvider>
      </TestProviders>,
    );
    const pings = screen.getByRole('button', { name: 'Pings, 3 unread' });
    expect(pings.getAttribute('aria-pressed')).toBe('false');
    expect(pings.getAttribute('data-panel-toggle')).toBe('test.pings');
    expect(pings.querySelector('[data-panel-badge]')?.textContent).toBe('3');
    const alerts = screen.getByRole('button', { name: 'Alerts, 120 unread' });
    expect(alerts.querySelector('[data-panel-badge]')?.textContent).toBe('99+');
    // The studio's own notifications toggle is there too, without a count while nothing is unread.
    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell.querySelector('[data-panel-badge]')).toBeNull();
    fireEvent.click(pings);
    expect(useDock.getState().openId).toBe('test.pings');
    expect(pings.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('notification helpers', () => {
  it('resolves targets to hrefs', () => {
    const index = indexSchema(schemaFixture());
    expect(notificationTargetHref({ kind: 'record', object: 'person', id: 'p1' }, 'acme', index)).toEqual({
      href: '/workspaces/acme/records/person/p1',
      external: false,
    });
    expect(
      notificationTargetHref(
        { kind: 'record', object: '01a1751f-5f09-7114-9d75-c6298b7cb4b3', id: 'c1' },
        'acme',
        index,
      ).href,
    ).toBe('/workspaces/acme/records/company/c1');
    expect(notificationTargetHref({ kind: 'settings', section: 'modules' }, 'acme', index).href).toBe(
      '/workspaces/acme/settings/modules',
    );
    expect(notificationTargetHref({ kind: 'workflow', id: 'wf1' }, 'acme', index).href).toBe(
      '/workspaces/acme/workflows/wf1',
    );
    expect(notificationTargetHref({ kind: 'page', pagePath: 'billing' }, 'acme', index).href).toBe(
      '/workspaces/acme/billing',
    );
    expect(notificationTargetHref({ kind: 'url', url: 'https://example.com' }, 'acme', index)).toEqual({
      href: 'https://example.com',
      external: true,
    });
  });

  it('takes a toast description from the body and names senders', () => {
    expect(firstLine('## Paid\n\nAcme paid **invoice #12** ([open](record:invoice/1)).')).toBe('Paid');
    expect(firstLine('\n- Acme paid **invoice #12** ([open](record:invoice/1)).')).toBe(
      'Acme paid invoice #12 (open).',
    );
    expect(firstLine(null)).toBeUndefined();
    const members = new Map([
      ['u2', { id: 'm2', userId: 'u2', role: 'member', user: { id: 'u2', name: 'Grace', email: 'g@x' } }],
    ]);
    const ctx = { members, agents: new Map([['a1', 'Closer']]), selfId: 'u1' };
    // The reader's own agent is just its name; one the workspace no longer lists is still an agent.
    expect(senderOf({ kind: 'agent', id: 'a1', onBehalfOf: { kind: 'user', id: 'u1' } }, ctx)).toBe('Closer');
    expect(senderOf({ kind: 'agent', id: 'gone', onBehalfOf: { kind: 'user', id: 'u1' } }, ctx)).toBe('An agent');
    expect(senderOf({ kind: 'agent', id: 'a1', onBehalfOf: { kind: 'user', id: 'u2' } }, ctx)).toBe('Closer for Grace');
    expect(senderOf({ kind: 'function', id: 'payments.create_customer' }, ctx)).toBe('Module payments');
    expect(senderOf({ kind: 'user', id: 'u9' }, ctx)).toBe('Someone');
    // A module's code, by the module's name, and for whom it ran unless that is the reader.
    const named = { ...ctx, modules: new Map([['invoicing', 'Invoicing']]) };
    expect(senderOf({ kind: 'module', id: 'invoicing', onBehalfOf: { kind: 'user', id: 'u2' } }, named)).toBe(
      'Invoicing for Grace',
    );
    expect(senderOf({ kind: 'module', id: 'invoicing', onBehalfOf: { kind: 'user', id: 'u1' } }, named)).toBe(
      'Invoicing',
    );
    expect(senderOf({ kind: 'module', id: 'google' }, ctx)).toBe('Module google');
  });

  it('queues arrivals once and hands them over', () => {
    const inbox = useNotificationInbox.getState();
    inbox.arrive(['a', 'b']);
    inbox.arrive(['b', 'c']);
    expect(useNotificationInbox.getState().arrived).toEqual(['a', 'b', 'c']);
    expect(useNotificationInbox.getState().take()).toEqual(['a', 'b', 'c']);
    expect(useNotificationInbox.getState().arrived).toEqual([]);
  });
});
