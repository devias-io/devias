import {
  type Actor,
  NOTIFICATION_RETENTION_PER_RECIPIENT,
  type NotificationEvent,
  type WorkspaceEvent,
} from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import {
  createMockClient,
  type MockMember,
  type MockSnapshot,
  resolveNotificationAudience,
  type StorageLike,
  sendNotification,
} from '../src/mock';

const MEMBERS: MockMember[] = [
  { id: 'user_dev', role: 'owner' },
  { id: 'user_ada', role: 'admin' },
  { id: 'user_grace', role: 'member' },
  { id: 'user_linus', role: 'member' },
];

/** A clock that moves a second per reading, so rows get distinct timestamps. */
const ticking = (start = '2026-06-15T09:00:00.000Z') => {
  let at = Date.parse(start);

  return () => {
    at += 1_000;

    return new Date(at).toISOString();
  };
};

const team = (actor?: Actor) =>
  createMockClient({ workspaceId: 'ws_test', manifests: [fixture], members: MEMBERS, now: ticking(), actor });

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const notificationEvents = (events: WorkspaceEvent[]): NotificationEvent[] =>
  events.filter((event): event is NotificationEvent => event.type === 'notification.changed');

describe('mock notifications', () => {
  it('sends to me, everyone, roles and users, one row per member', async () => {
    const client = team();
    expect(await client.notifications.send({ title: '  Welcome  ', to: { me: true } })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect(
      await client.notifications.send({
        title: 'All hands',
        body: 'At **ten**',
        level: 'warning',
        kind: 'fixture.all_hands',
        target: { kind: 'object', object: 'opportunity' },
        data: { room: 'A' },
        to: { all: true },
      }),
    ).toEqual({ recipients: 4, created: 4, updated: 0 });
    expect(await client.notifications.send({ title: 'Admins', to: { roles: ['owner', 'admin'] } })).toMatchObject({
      recipients: 2,
    });
    expect(
      await client.notifications.send({ title: 'Grace', to: { users: ['user_grace', 'user_grace'], me: true } }),
    ).toEqual({ recipients: 2, created: 2, updated: 0 });

    const mine = (await client.notifications.list()).items;
    expect(mine.map((n) => n.title)).toEqual(['Grace', 'Admins', 'All hands', 'Welcome']);
    expect(mine[2]).toMatchObject({
      workspaceId: 'ws_test',
      recipientId: 'user_dev',
      kind: 'fixture.all_hands',
      level: 'warning',
      title: 'All hands',
      body: 'At **ten**',
      target: { kind: 'object', object: 'opportunity' },
      key: null,
      data: { room: 'A' },
      actor: { kind: 'user', id: 'user_dev' },
      readAt: null,
    });
    expect(mine[3]).toMatchObject({ kind: 'general', level: 'info', body: null, target: null, data: null });
    const recipients = (title: string) =>
      client.store.notifications
        .filter((n) => n.title === title)
        .map((n) => n.recipientId)
        .sort();
    expect(recipients('All hands')).toEqual(['user_ada', 'user_dev', 'user_grace', 'user_linus']);
    expect(recipients('Admins')).toEqual(['user_ada', 'user_dev']);
    expect(recipients('Grace')).toEqual(['user_dev', 'user_grace']);
    expect(resolveNotificationAudience(client.store, { roles: ['member'] })).toEqual(['user_grace', 'user_linus']);

    const unknown = await failure(client.notifications.send({ title: 'x', to: { users: ['user_nobody'] } }));
    expect(unknown.code).toBe('VALIDATION');
    expect(unknown.message).toMatch(/user_nobody/);
    expect((await failure(client.notifications.send({ title: 'x', to: {} }))).code).toBe('VALIDATION');
    const untitled = await failure(client.notifications.send({ title: ' ', to: { me: true } }));
    expect(untitled.code).toBe('VALIDATION');
    expect(untitled.details).toMatchObject({ issues: [{ path: 'title' }] });
    expect((await failure(client.notifications.send({ title: 'x', kind: 'Not Dotted', to: { me: true } }))).code).toBe(
      'VALIDATION',
    );
    expect(
      (await failure(client.notifications.send({ title: 'x', level: 'loud' as 'info', to: { me: true } }))).code,
    ).toBe('VALIDATION');
  });

  it('defaults the members to the actor as owner', async () => {
    const alone = createMockClient({ workspaceId: 'ws_solo' });
    expect(alone.store.members).toEqual([{ id: 'user_dev', role: 'owner' }]);
    expect(resolveNotificationAudience(alone.store, { all: true })).toEqual(['user_dev']);
    expect(resolveNotificationAudience(alone.store, { roles: ['member'] })).toEqual([]);
    expect(await alone.notifications.send({ title: 'Nobody', to: { roles: ['member'] } })).toEqual({
      recipients: 0,
      created: 0,
      updated: 0,
    });
    expect(alone.store.events).toHaveLength(0);
    const key = createMockClient({ workspaceId: 'ws_key', actor: { kind: 'api_key', id: 'key_1' } });
    expect(key.store.members).toEqual([]);
  });

  it('lists newest first, pages with a keyset cursor and filters unread', async () => {
    const client = team();

    for (const n of [1, 2, 3, 4, 5]) {
      await client.notifications.send({ title: `n${n}`, to: { me: true } });
    }

    const all = await client.notifications.list();
    expect(all.items.map((n) => n.title)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
    expect(all.nextCursor).toBeNull();
    const first = await client.notifications.list({ limit: 2 });
    expect(first.items.map((n) => n.title)).toEqual(['n5', 'n4']);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.notifications.list({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((n) => n.title)).toEqual(['n3', 'n2']);
    const third = await client.notifications.list({ limit: 2, cursor: second.nextCursor ?? '' });
    expect(third.items.map((n) => n.title)).toEqual(['n1']);
    expect(third.nextCursor).toBeNull();
    expect((await failure(client.notifications.list({ cursor: 'nope' }))).code).toBe('INVALID_CURSOR');
    expect((await failure(client.notifications.list({ limit: 0 }))).code).toBe('VALIDATION');

    const n3 = all.items[2];

    if (!n3) {
      throw new Error('expected five notifications');
    }

    await client.notifications.markRead(n3.id);
    expect((await client.notifications.list({ unread: true })).items.map((n) => n.title)).toEqual([
      'n5',
      'n4',
      'n2',
      'n1',
    ]);
    // Over HTTP `unread` arrives as a string; the mock accepts what the route's schema accepts.
    const asQuery = { unread: 'true' } as unknown as Parameters<typeof client.notifications.list>[0];
    expect((await client.notifications.list(asQuery)).items).toHaveLength(4);
    expect(await client.notifications.unreadCount()).toEqual({ count: 4 });

    // Rows created in the same instant still page without gaps or repeats: the id breaks the tie.
    const frozen = createMockClient({ workspaceId: 'ws_frozen', now: () => '2026-06-15T09:00:00.000Z' });

    for (const n of [1, 2, 3]) {
      await frozen.notifications.send({ title: `same ${n}`, to: { me: true } });
    }

    const page1 = await frozen.notifications.list({ limit: 2 });
    const page2 = await frozen.notifications.list({ limit: 2, cursor: page1.nextCursor ?? '' });
    expect(page2.nextCursor).toBeNull();
    expect([...page1.items, ...page2.items].map((n) => n.title).sort()).toEqual(['same 1', 'same 2', 'same 3']);
  });

  it('marks read, unread and all read, deletes, and tells only the recipient', async () => {
    const client = team();
    const received: WorkspaceEvent[] = [];
    client.events.subscribe((event) => received.push(event));
    await client.notifications.send({ title: 'Hello', to: { all: true } });
    await client.notifications.send({ title: 'Again', to: { all: true } });
    const [again, hello] = (await client.notifications.list()).items;

    if (!again || !hello) {
      throw new Error('expected two notifications');
    }

    const read = await client.notifications.markRead(hello.id);
    expect(read.readAt).not.toBeNull();
    expect(read.updatedAt).toBe(read.readAt);
    expect(await client.notifications.markRead(hello.id)).toEqual(read);
    expect(await client.notifications.unreadCount()).toEqual({ count: 1 });
    expect((await client.notifications.markUnread(hello.id)).readAt).toBeNull();
    expect(await client.notifications.markAllRead()).toEqual({ updated: 2 });
    expect(await client.notifications.markAllRead()).toEqual({ updated: 0 });
    expect(await client.notifications.unreadCount()).toEqual({ count: 0 });
    await client.notifications.delete(again.id);
    expect((await client.notifications.list()).items.map((n) => n.id)).toEqual([hello.id]);
    expect((await failure(client.notifications.delete(again.id))).code).toBe('NOT_FOUND');
    // The other members keep theirs.
    expect(client.store.notifications.filter((n) => n.recipientId === 'user_ada')).toHaveLength(2);

    await flush();
    const feed = notificationEvents(client.store.events);
    expect(feed.filter((e) => e.action === 'created')).toHaveLength(8);
    expect(feed.filter((e) => e.action === 'created' && e.recipientId === 'user_ada')).toHaveLength(2);
    const mine = notificationEvents(received);
    expect(received).toHaveLength(mine.length);
    expect(mine.every((e) => e.recipientId === 'user_dev')).toBe(true);
    expect(mine.map((e) => [e.action, e.notificationId])).toEqual([
      ['created', hello.id],
      ['created', again.id],
      ['read', hello.id],
      ['read', hello.id],
      ['read', null],
      ['deleted', again.id],
    ]);
    expect(received[0]).toMatchObject({ workspaceId: 'ws_test', actor: { kind: 'user', id: 'user_dev' } });
  });

  it('refuses another member’s notifications and callers who are not people', async () => {
    const client = team();
    await client.notifications.send({ title: 'For all', to: { all: true } });
    const ada = client.store.notifications.find((n) => n.recipientId === 'user_ada');

    if (!ada) {
      throw new Error('expected a row for Ada');
    }

    expect((await failure(client.notifications.markRead(ada.id))).code).toBe('NOT_FOUND');
    expect((await failure(client.notifications.markUnread(ada.id))).code).toBe('NOT_FOUND');
    expect((await failure(client.notifications.delete(ada.id))).code).toBe('NOT_FOUND');
    // A malformed id is the caller's mistake, as on the server; an unknown one looks like another person's.
    expect((await failure(client.notifications.markRead('missing'))).code).toBe('VALIDATION');

    const key = team({ kind: 'api_key', id: 'key_1' });
    expect((await failure(key.notifications.list())).code).toBe('FORBIDDEN');
    expect((await failure(key.notifications.unreadCount())).code).toBe('FORBIDDEN');
    expect((await failure(key.notifications.markAllRead())).code).toBe('FORBIDDEN');
    expect((await failure(key.notifications.markRead('x'))).code).toBe('FORBIDDEN');
    expect((await failure(key.notifications.delete('x'))).code).toBe('FORBIDDEN');
    expect(await key.notifications.send({ title: 'From a key', to: { roles: ['owner'] } })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect(key.store.notifications[0]).toMatchObject({
      recipientId: 'user_dev',
      actor: { kind: 'api_key', id: 'key_1' },
    });
    const me = await failure(key.notifications.send({ title: 'x', to: { me: true } }));
    expect(me.code).toBe('VALIDATION');
    expect(me.details).toMatchObject({ path: 'to.me' });

    const agent = team({ kind: 'agent', id: 'agent_1', onBehalfOf: { kind: 'user', id: 'user_ada' } });
    await agent.notifications.send({ title: 'For Ada', to: { me: true } });
    expect((await agent.notifications.list()).items).toMatchObject([
      { recipientId: 'user_ada', title: 'For Ada', actor: { kind: 'agent', id: 'agent_1' } },
    ]);
  });

  it('replaces the unread notification with the same key and prunes read ones past the limit', async () => {
    const client = team();
    await client.notifications.send({ title: 'Deal at 10k', key: 'deal:1', to: { me: true } });
    await client.notifications.send({ title: 'Other', to: { me: true } });
    const before = (await client.notifications.list()).items.find((n) => n.key === 'deal:1');

    if (!before) {
      throw new Error('expected the keyed notification');
    }

    expect(
      await client.notifications.send({
        title: 'Deal at 12k',
        key: 'deal:1',
        level: 'success',
        body: 'Up',
        to: { me: true },
      }),
    ).toEqual({ recipients: 1, created: 0, updated: 1 });
    const page = await client.notifications.list();
    expect(page.items.map((n) => n.title)).toEqual(['Deal at 12k', 'Other']);
    const after = page.items[0];
    expect(after).toMatchObject({ id: before.id, level: 'success', body: 'Up', readAt: null });
    expect(Date.parse(after?.createdAt ?? '')).toBeGreaterThan(Date.parse(before.createdAt));
    // A read one is left alone: the next send with the key adds a new notification.
    await client.notifications.markRead(before.id);
    expect(await client.notifications.send({ title: 'Deal at 15k', key: 'deal:1', to: { me: true } })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect((await client.notifications.list()).items.filter((n) => n.key === 'deal:1')).toHaveLength(2);
    // Keys are per recipient.
    await client.notifications.send({ title: 'Shared', key: 'shared', to: { all: true } });
    expect(await client.notifications.send({ title: 'Shared again', key: 'shared', to: { all: true } })).toEqual({
      recipients: 4,
      created: 0,
      updated: 4,
    });

    // Retention: only read notifications are pruned, only past the limit, and only when one arrives.
    const bulk = team();

    for (let i = 0; i < NOTIFICATION_RETENTION_PER_RECIPIENT + 2; i += 1) {
      sendNotification(bulk.store, { title: `bulk ${i}`, to: { me: true } });
    }

    expect(await bulk.notifications.unreadCount()).toEqual({ count: NOTIFICATION_RETENTION_PER_RECIPIENT + 2 });
    await bulk.notifications.markAllRead();
    expect(bulk.store.notifications).toHaveLength(NOTIFICATION_RETENTION_PER_RECIPIENT + 2);
    await bulk.notifications.send({ title: 'one more', to: { me: true } });
    const mine = bulk.store.notifications.filter((n) => n.recipientId === 'user_dev');
    expect(mine).toHaveLength(NOTIFICATION_RETENTION_PER_RECIPIENT + 1);
    expect(mine.filter((n) => n.readAt !== null)).toHaveLength(NOTIFICATION_RETENTION_PER_RECIPIENT);
    const titles = new Set(mine.map((n) => n.title));
    expect(titles.has('bulk 0')).toBe(false);
    expect(titles.has('bulk 1')).toBe(false);
    expect(titles.has('bulk 2')).toBe(true);
    expect(titles.has('one more')).toBe(true);
  });

  it('keeps notifications across a snapshot round trip and in the persisted copy', async () => {
    const client = team();
    await client.notifications.send({ title: 'Keep me', to: { all: true } });
    const snapshot = client.store.snapshot();
    expect(snapshot.notifications).toHaveLength(4);
    const other = createMockClient({ workspaceId: 'ws_test', manifests: [fixture], members: MEMBERS });
    other.store.restore(snapshot);
    expect((await other.notifications.list()).items.map((n) => n.title)).toEqual(['Keep me']);
    expect(await other.notifications.unreadCount()).toEqual({ count: 1 });
    // Snapshots from before notifications existed restore to an empty inbox.
    const { notifications: _dropped, ...legacy } = snapshot;
    other.store.restore(legacy as MockSnapshot);
    expect((await other.notifications.list()).items).toEqual([]);
    other.store.restore(snapshot);
    other.store.clear();
    expect(other.store.notifications).toEqual([]);

    const saved = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => {
        saved.set(key, value);
      },
      removeItem: (key) => {
        saved.delete(key);
      },
    };
    const persisted = createMockClient({
      workspaceId: 'ws_p',
      manifests: [fixture],
      members: MEMBERS,
      persist: { key: 'mock', storage },
    });
    await persisted.notifications.send({ title: 'Saved', to: { me: true } });
    await flush();
    const reloaded = createMockClient({
      workspaceId: 'ws_p',
      manifests: [fixture],
      members: MEMBERS,
      persist: { key: 'mock', storage },
    });
    expect((await reloaded.notifications.list()).items.map((n) => n.title)).toEqual(['Saved']);
  });

  it('sends notifications from a workflow step, as the workflow', async () => {
    const client = team();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const workflow = await client.workflows.create({
      title: 'Flag the person',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          id: 'notify',
          kind: 'action',
          actionId: 'core.send_notification',
          input: {
            title: 'Look at {{record.first_name}}',
            level: 'success',
            kind: 'fixture.person_flagged',
            key: 'person:{{record.id}}',
            target: { kind: 'record', object: 'person', id: '{{record.id}}' },
            to: { all: true },
          },
        },
      ],
    });
    const person = await client.records.create('person', { first_name: 'Nora' });
    const run = await client.workflows.run(workflow.id, { recordId: person.id });
    expect(run.status).toBe('succeeded');
    expect(run.steps[0]).toMatchObject({
      id: 'notify',
      status: 'succeeded',
      output: { recipients: 4, created: 4, updated: 0 },
    });
    expect((await client.notifications.list()).items).toMatchObject([
      {
        title: 'Look at Nora',
        level: 'success',
        kind: 'fixture.person_flagged',
        key: `person:${person.id}`,
        target: { kind: 'record', object: 'person', id: person.id },
        actor: { kind: 'workflow', id: workflow.id },
      },
    ]);
    // Running again replaces the unread notification instead of adding one.
    const again = await client.workflows.run(workflow.id, { recordId: person.id });
    expect(again.steps[0]?.output).toEqual({ recipients: 4, created: 0, updated: 4 });
    await flush();
    const created = notificationEvents(events).filter((e) => e.action === 'created');
    expect(created.map((e) => e.actor)).toEqual([
      { kind: 'workflow', id: workflow.id },
      { kind: 'workflow', id: workflow.id },
    ]);

    // An automation has no person behind it, so `to.me` fails the step.
    await client.workflows.update(workflow.id, {
      steps: [{ kind: 'action', actionId: 'core.send_notification', input: { title: 'Me', to: { me: true } } }],
    });
    const failed = await client.workflows.run(workflow.id, { recordId: person.id });
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/to\.me/);

    // Saving checks the step like the server: the required input, and only actions a workflow may run.
    const missing = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'manual', objectId: 'person' },
        steps: [{ kind: 'action', actionId: 'core.send_notification', input: { title: 'No audience' } }],
      }),
    );
    expect(missing.message).toMatch(/"to" is required/);
    const inbox = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'manual', objectId: 'person' },
        steps: [{ kind: 'action', actionId: 'core.list_notifications', input: {} }],
      }),
    );
    expect(inbox.message).toMatch(/cannot run/);
  });
});
