import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentContext,
  createNotificationService,
  type EngineContext,
  EngineError,
  functionContext,
  readEventsAfter,
} from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

describe('notifications on PGlite', () => {
  let t: TestEngine;
  let other: EngineContext;
  const titles = async (ctx: EngineContext, query: { unread?: boolean; limit?: number; cursor?: string } = {}) =>
    (await t.engine.notifications.list(ctx, query)).items.map((item) => item.title);

  beforeAll(async () => {
    t = await createTestEngine();
    other = { workspaceId: t.workspaceId, actor: { kind: 'user', id: 'u_other' }, role: 'member' };
  });
  afterAll(() => t.close());

  it('sends one row per recipient, which only that person lists, and announces each on the feed to them alone', async () => {
    const since = await t.engine.events.currentSequence(t.workspaceId);
    const sent = await t.engine.notifications.send(t.owner, {
      recipients: ['u_member', 'u_other', 'u_member'],
      title: '  Deal closed  ',
      body: 'Globex signed',
      level: 'success',
      kind: 'fixture.deal_closed',
      target: { kind: 'record', object: 'opportunity', id: 'opp_1' },
      data: { amount: 100 },
    });
    expect(sent).toEqual({ recipients: 2, created: 2, updated: 0 });

    const mine = await t.engine.notifications.list(t.member);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      workspaceId: t.workspaceId,
      recipientId: 'u_member',
      title: 'Deal closed',
      body: 'Globex signed',
      level: 'success',
      kind: 'fixture.deal_closed',
      target: { kind: 'record', object: 'opportunity', id: 'opp_1' },
      key: null,
      data: { amount: 100 },
      actor: { kind: 'user', id: 'u_owner' },
      readAt: null,
    });
    expect(mine.items[0]?.createdAt).toBe(mine.items[0]?.updatedAt);
    expect(mine.nextCursor).toBeNull();
    expect((await t.engine.notifications.list(other)).items.map((item) => item.recipientId)).toEqual(['u_other']);
    expect((await t.engine.notifications.list(t.owner)).items).toEqual([]);

    const events = await readEventsAfter(t.db, t.workspaceId, since, 100);
    expect(events.map((event) => event.type)).toEqual(['notification.changed', 'notification.changed']);
    expect(events[0]).toMatchObject({
      type: 'notification.changed',
      recipientId: 'u_member',
      notificationId: mine.items[0]?.id,
      action: 'created',
      actor: { kind: 'user', id: 'u_owner' },
    });
    // The feed shows a person their own notification events only; keys and automations see none.
    const seen = (ctx: EngineContext) => t.engine.events.list(ctx, { after: since });
    expect((await seen(t.member)).map((event) => event.type === 'notification.changed' && event.recipientId)).toEqual([
      'u_member',
    ]);
    expect((await seen(other)).map((event) => event.type === 'notification.changed' && event.recipientId)).toEqual([
      'u_other',
    ]);
    expect(await seen(t.owner)).toEqual([]);
    expect(await seen(functionContext(t.workspaceId, 'fixture.x'))).toEqual([]);
    expect(await t.engine.events.readAfter(t.workspaceId, since)).toHaveLength(2);
  });

  it('counts unread, marks read and unread again, marks all read and deletes, each only for the person', async () => {
    await t.engine.notifications.send(t.owner, { recipients: ['u_member'], title: 'Second' });
    await t.engine.notifications.send(t.owner, { recipients: ['u_member'], title: 'Third' });
    expect(await t.engine.notifications.unreadCount(t.member)).toEqual({ count: 3 });
    expect(await titles(t.member)).toEqual(['Third', 'Second', 'Deal closed']);
    const [third] = (await t.engine.notifications.list(t.member)).items;

    if (!third) {
      throw new Error('missing');
    }

    const since = await t.engine.events.currentSequence(t.workspaceId);
    const read = await t.engine.notifications.markRead(t.member, third.id);
    expect(read.readAt).not.toBeNull();
    expect(await t.engine.notifications.unreadCount(t.member)).toEqual({ count: 2 });
    expect(await titles(t.member, { unread: true })).toEqual(['Second', 'Deal closed']);
    // Marking it read again changes nothing and announces nothing.
    expect((await t.engine.notifications.markRead(t.member, third.id)).readAt).toBe(read.readAt);
    expect(await readEventsAfter(t.db, t.workspaceId, since, 100)).toMatchObject([
      { type: 'notification.changed', recipientId: 'u_member', notificationId: third.id, action: 'read' },
    ]);
    const unread = await t.engine.notifications.markUnread(t.member, third.id);
    expect(unread.readAt).toBeNull();
    expect(await t.engine.notifications.unreadCount(t.member)).toEqual({ count: 3 });

    // Someone else's row is as good as missing.
    expect(await codeOf(t.engine.notifications.markRead(other, third.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.notifications.markUnread(t.owner, third.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.notifications.delete(other, third.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.notifications.markRead(t.member, 'not-an-id'))).toBe('VALIDATION');
    expect(await t.engine.notifications.unreadCount(other)).toEqual({ count: 1 });

    const before = await t.engine.events.currentSequence(t.workspaceId);
    expect(await t.engine.notifications.markAllRead(t.member)).toEqual({ updated: 3 });
    expect(await t.engine.notifications.unreadCount(t.member)).toEqual({ count: 0 });
    expect(await t.engine.notifications.unreadCount(other)).toEqual({ count: 1 });
    expect(await t.engine.notifications.markAllRead(t.member)).toEqual({ updated: 0 });
    expect(await readEventsAfter(t.db, t.workspaceId, before, 100)).toMatchObject([
      { type: 'notification.changed', recipientId: 'u_member', notificationId: null, action: 'read' },
    ]);

    await t.engine.notifications.delete(t.member, third.id);
    expect(await titles(t.member)).toEqual(['Second', 'Deal closed']);
    expect(await codeOf(t.engine.notifications.delete(t.member, third.id))).toBe('NOT_FOUND');
    const events = await readEventsAfter(t.db, t.workspaceId, before, 100);
    expect(events.at(-1)).toMatchObject({ type: 'notification.changed', notificationId: third.id, action: 'deleted' });
  });

  it('replaces the unread notification with the same key instead of adding another', async () => {
    const content = { recipients: ['u_other'], key: 'sync', kind: 'sync.status' };
    expect(await t.engine.notifications.send(t.owner, { ...content, title: 'Sync running' })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    const again = await t.engine.notifications.send(t.member, {
      ...content,
      title: 'Sync finished',
      level: 'success',
      body: 'Done',
    });
    expect(again).toEqual({ recipients: 1, created: 0, updated: 1 });
    const synced = (await t.engine.notifications.list(other)).items.filter((item) => item.key === 'sync');
    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({
      title: 'Sync finished',
      level: 'success',
      body: 'Done',
      kind: 'sync.status',
      actor: { kind: 'user', id: 'u_member' },
      readAt: null,
    });
    expect(await titles(other)).toEqual(['Sync finished', 'Deal closed']);

    // Once read, the key no longer matches: the next send adds a new one.
    await t.engine.notifications.markRead(other, synced[0]?.id ?? '');
    expect(await t.engine.notifications.send(t.owner, { ...content, title: 'Sync running again' })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect(await titles(other)).toEqual(['Sync running again', 'Sync finished', 'Deal closed']);
  });

  it('keeps the inbox to people, lets anyone with notification.send notify, and validates the content', async () => {
    const fn = functionContext(t.workspaceId, 'fixture.close_deal');
    const key: EngineContext = {
      workspaceId: t.workspaceId,
      actor: { kind: 'api_key', id: 'k' },
      role: null,
      apiKeyPermissions: { notification: ['send'] },
    };
    expect(await codeOf(t.engine.notifications.list(fn))).toBe('FORBIDDEN');
    expect(await codeOf(t.engine.notifications.unreadCount(key))).toBe('FORBIDDEN');
    expect(await codeOf(t.engine.notifications.markAllRead(key))).toBe('FORBIDDEN');
    await expect(t.engine.notifications.list(fn)).rejects.toThrow(/belong to people/);

    expect(await t.engine.notifications.send(fn, { recipients: ['u_member'], title: 'From a module' })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect(await t.engine.notifications.send(key, { recipients: ['u_member'], title: 'From a key' })).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    const [fromKey, fromModule] = (await t.engine.notifications.list(t.member)).items;
    expect(fromKey).toMatchObject({ title: 'From a key', actor: { kind: 'api_key', id: 'k' }, kind: 'general' });
    expect(fromModule).toMatchObject({ actor: { kind: 'function', id: 'fixture.close_deal' }, level: 'info' });

    const stranger: EngineContext = { workspaceId: t.workspaceId, actor: { kind: 'user', id: 'u_x' }, role: null };
    expect(await codeOf(t.engine.notifications.send(stranger, { recipients: ['u_member'], title: 'Hi' }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(t.engine.notifications.send(t.owner, { recipients: ['u_member'], title: '   ' }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(t.engine.notifications.send(t.owner, { recipients: ['u_member'], title: 'Hi', kind: 'Not Dotted' })),
    ).toBe('VALIDATION');
    expect(await codeOf(t.engine.notifications.send(t.owner, { recipients: [''], title: 'Hi' }))).toBe('VALIDATION');
    expect(await t.engine.notifications.send(t.owner, { recipients: [], title: 'Nobody' })).toEqual({
      recipients: 0,
      created: 0,
      updated: 0,
    });

    // An agent acting for a person reads that person's inbox.
    const agent = agentContext(t.member, 'agent-1');
    expect(await titles(agent)).toEqual(await titles(t.member));
    expect(await t.engine.notifications.unreadCount(agent)).toEqual(await t.engine.notifications.unreadCount(t.member));
  });

  it('pages newest first with a cursor, also through the unread filter', async () => {
    const pager: EngineContext = { workspaceId: t.workspaceId, actor: { kind: 'user', id: 'u_pager' }, role: 'member' };

    for (const n of [1, 2, 3, 4, 5]) {
      await t.engine.notifications.send(t.owner, { recipients: ['u_pager'], title: `N${n}` });
    }

    const first = await t.engine.notifications.list(pager, { limit: 2 });
    expect(first.items.map((item) => item.title)).toEqual(['N5', 'N4']);
    expect(first.nextCursor).not.toBeNull();
    const second = await t.engine.notifications.list(pager, { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((item) => item.title)).toEqual(['N3', 'N2']);
    const third = await t.engine.notifications.list(pager, { limit: 2, cursor: second.nextCursor ?? undefined });
    expect(third.items.map((item) => item.title)).toEqual(['N1']);
    expect(third.nextCursor).toBeNull();

    await t.engine.notifications.markRead(pager, first.items[1]?.id ?? '');
    const unread = await t.engine.notifications.list(pager, { limit: 2, unread: true });
    expect(unread.items.map((item) => item.title)).toEqual(['N5', 'N3']);
    // Over HTTP `unread` arrives as a string; the service accepts what the route's schema accepts.
    const asQuery = { unread: 'true', cursor: unread.nextCursor ?? undefined } as unknown as Parameters<
      typeof t.engine.notifications.list
    >[1];
    const rest = await t.engine.notifications.list(pager, asQuery);
    expect(rest.items.map((item) => item.title)).toEqual(['N2', 'N1']);

    expect(await codeOf(t.engine.notifications.list(pager, { cursor: 'nope' }))).toBe('INVALID_CURSOR');
    expect(await codeOf(t.engine.notifications.list(pager, { cursor: '2026-01-01T00:00:00.000Z~x' }))).toBe(
      'INVALID_CURSOR',
    );
    expect(await codeOf(t.engine.notifications.list(pager, { limit: 1000 }))).toBe('VALIDATION');
  });

  it('prunes read notifications beyond the retention when new ones arrive, never unread ones', async () => {
    const keeper: EngineContext = {
      workspaceId: t.workspaceId,
      actor: { kind: 'user', id: 'u_keeper' },
      role: 'member',
    };
    const service = createNotificationService({ db: t.db, bus: t.engine.bus, clock: () => new Date(), retention: 2 });
    const send = (title: string) => service.send(t.owner, { recipients: ['u_keeper'], title });
    await send('K1');
    await send('K2');
    await send('K3');
    expect(await titles(keeper)).toEqual(['K3', 'K2', 'K1']);
    // Unread rows are never pruned, however many there are.
    await send('Unread one');
    expect(await titles(keeper)).toEqual(['Unread one', 'K3', 'K2', 'K1']);
    await t.engine.notifications.markRead(keeper, (await t.engine.notifications.list(keeper)).items[1]?.id ?? '');
    await t.engine.notifications.markRead(keeper, (await t.engine.notifications.list(keeper)).items[2]?.id ?? '');
    await t.engine.notifications.markRead(keeper, (await t.engine.notifications.list(keeper)).items[3]?.id ?? '');
    // Three read, two kept: the oldest goes when the next one arrives.
    await send('K4');
    expect(await titles(keeper)).toEqual(['K4', 'Unread one', 'K3', 'K2']);
    await send('K5');
    expect(await titles(keeper)).toEqual(['K5', 'K4', 'Unread one', 'K3', 'K2']);
  });
});
