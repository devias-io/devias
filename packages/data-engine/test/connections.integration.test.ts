import { defineModule } from '@devias/core';
import { manifest as fixtureManifest } from '@devias/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDataEngine,
  createSecretBox,
  type DataEngine,
  type EngineContext,
  EngineError,
  readEventsAfter,
  runRaw,
  silentLogger,
} from '../src';
import { createTestDb, type TestDb } from './helpers/db';

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

const mailer = defineModule({
  id: 'mailer',
  version: '0.1.0',
  name: 'Mailer',
  connections: [
    {
      id: 'mailer.default',
      kind: 'api_key',
      fields: [
        { name: 'api_key', label: 'API key' },
        { name: 'webhook_secret', label: 'Webhook secret', required: false },
      ],
    },
  ],
  variables: [
    { key: 'REGION', label: 'Region', default: 'eu' },
    { key: 'PARTNER_ID', label: 'Partner id', server: true },
  ],
  actions: [
    {
      id: 'mailer.send',
      label: 'Send',
      input: [
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'body', label: 'Body', type: 'long_text' },
      ],
    },
  ],
  events: [{ id: 'mailer.delivered' }],
});
const calendar = defineModule({
  id: 'calendar-sync',
  version: '0.1.0',
  name: 'Calendar sync',
  variables: [
    { key: 'CLIENT_ID', label: 'Client id', server: true },
    { key: 'CLIENT_SECRET', label: 'Client secret', server: true, secret: true },
  ],
  connections: [
    {
      id: 'calendar-sync.account',
      kind: 'oauth2',
      visibility: 'both',
      oauth: {
        authorizeUrl: 'https://accounts.example/authorize',
        tokenUrl: 'https://accounts.example/token',
        scopes: ['calendar'],
        clientId: { variable: 'CLIENT_ID' },
        clientSecret: { variable: 'CLIENT_SECRET' },
      },
    },
  ],
});

describe('secret box', () => {
  it('round-trips and refuses tampering or another key', () => {
    const box = createSecretBox('one-key');
    const sealed = box.seal('{"api_key":"re_123"}');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('re_123');
    expect(box.open(sealed)).toBe('{"api_key":"re_123"}');
    expect(() => createSecretBox('other-key').open(sealed)).toThrow();
    expect(() => box.open(`${sealed.slice(0, -2)}xx`)).toThrow();
  });
});

describe('module connections on PGlite', () => {
  let db: TestDb;
  let engine: DataEngine;
  let now = new Date('2026-10-11T10:00:00.000Z');
  const workspaceId = 'ws_connections';
  const owner: EngineContext = { workspaceId, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };
  const member: EngineContext = { workspaceId, actor: { kind: 'user', id: 'u_member' }, role: 'member' };
  const agent: EngineContext = {
    workspaceId,
    actor: { kind: 'agent', id: 'agent-1', onBehalfOf: { kind: 'user', id: 'u_member' } },
    role: 'member',
  };
  let workspaceConnection = '';

  beforeAll(async () => {
    db = await createTestDb();
    engine = createDataEngine({
      db: db.db,
      logger: silentLogger,
      seedManifests: [fixtureManifest],
      encryptionKey: 'test-encryption-key',
      clock: () => now,
    });
    await engine.workspaces.initialize(workspaceId);
  });
  afterAll(async () => {
    await engine.close();
    await db.close();
  });

  it('stores an API key connection encrypted, with masked hints, a webhook token and a feed event', async () => {
    expect(await codeOf(engine.connections.create(owner, { module: 'mailer', values: { api_key: 'k' } }))).toBe(
      'NOT_FOUND',
    );
    await engine.modules.apply(owner, mailer);
    await engine.modules.apply(owner, calendar);
    expect(await engine.connections.list(member)).toEqual([]);

    const before = await engine.events.currentSequence(workspaceId);
    const connection = await engine.connections.create(owner, {
      module: 'Mailer',
      values: { api_key: 'key_1234567890abcdef', webhook_secret: '  ' },
    });
    workspaceConnection = connection.id;
    expect(connection).toMatchObject({
      moduleId: 'mailer',
      providerId: 'default',
      kind: 'api_key',
      visibility: 'workspace',
      ownerUserId: null,
      status: 'connected',
      hints: { api_key: 'key_…cdef' },
      createdBy: 'user:u_owner',
    });
    expect(connection.webhookPath).toMatch(/^\/api\/webhooks\/[0-9a-f]{32}$/);
    // The row never holds the key in clear.
    const rows = await runRaw<{ sealed: string }>(
      db.db,
      sql`SELECT sealed FROM module_connection WHERE id = ${connection.id}::uuid`,
    );
    expect(rows[0]?.sealed).not.toContain('key_1234567890abcdef');
    expect(rows[0]?.sealed.startsWith('v1.')).toBe(true);
    expect((await engine.connections.open(workspaceId, connection.id)).credentials).toEqual({
      api_key: 'key_1234567890abcdef',
    });
    expect(await readEventsAfter(db.db, workspaceId, before, 10)).toEqual([
      expect.objectContaining({
        type: 'module.connected',
        moduleId: 'mailer',
        connectionId: connection.id,
        providerId: 'default',
      }),
    ]);
    // Members see the workspace's connection, only admins change it; a second one for the workspace is refused.
    expect(await engine.connections.get(member, connection.id)).toEqual(connection);
    expect(await codeOf(engine.connections.create(member, { module: 'mailer', values: { api_key: 'x' } }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(engine.connections.update(member, connection.id, { label: 'Mine now' }))).toBe('FORBIDDEN');
    expect(await codeOf(engine.connections.create(owner, { module: 'mailer', values: { api_key: 'other' } }))).toBe(
      'CONFLICT',
    );
  });

  it('validates the module, the provider, whose it is and the fields', async () => {
    const create = (input: unknown, ctx = owner) => engine.connections.create(ctx, input);
    expect(await codeOf(create({ module: 'ghost', values: { api_key: 'k' } }))).toBe('NOT_FOUND');
    expect(await codeOf(create({ module: 'fixture', values: { anything: 'x' } }))).toBe('VALIDATION');
    expect(await codeOf(create({ module: 'mailer', provider: 'nope', values: { api_key: 'k' } }))).toBe('VALIDATION');
    expect(await codeOf(create({ module: 'mailer', visibility: 'user', values: { api_key: 'k' } }))).toBe('VALIDATION');
    expect(await codeOf(create({ module: 'mailer', values: { nope: 'x' } }))).toBe('VALIDATION');
    expect(await codeOf(create({ module: 'mailer', values: { webhook_secret: 'only' } }))).toBe('VALIDATION');
    // OAuth providers connect through their consent page.
    expect(await codeOf(create({ module: 'calendar-sync', values: { token: 'x' } }))).toBe('VALIDATION');
    expect(await codeOf(create({ module: 'mailer', values: 'x' }))).toBe('VALIDATION');
  });

  it('merges replaced values, and stamps tests and uses: a refusal is announced once', async () => {
    const replaced = await engine.connections.update(owner, workspaceConnection, {
      values: { webhook_secret: 'whsec_abcdefghijklmnop' },
      label: 'Production',
    });
    expect(replaced).toMatchObject({
      label: 'Production',
      hints: { api_key: 'key_…cdef', webhook_secret: 'whse…mnop' },
    });
    expect((await engine.connections.open(workspaceId, workspaceConnection)).credentials).toEqual({
      api_key: 'key_1234567890abcdef',
      webhook_secret: 'whsec_abcdefghijklmnop',
    });

    const before = await engine.events.currentSequence(workspaceId);
    const failed = await engine.connections.recordTest(workspaceId, workspaceConnection, {
      ok: false,
      message: 'Bad key',
    });
    expect(failed).toMatchObject({ status: 'auth_failed', lastError: 'Bad key' });
    expect(failed.authFailedAt).not.toBeNull();
    await engine.connections.markAuthFailed(workspaceId, workspaceConnection, 'Still bad');
    // An error that is not about the credentials is kept, without changing the status.
    await engine.connections.recordUse(workspaceId, workspaceConnection, 'The recipient was refused');
    expect(await engine.connections.get(owner, workspaceConnection)).toMatchObject({
      status: 'auth_failed',
      lastError: 'The recipient was refused',
    });
    await engine.connections.recordUse(workspaceId, workspaceConnection, null);
    const used = await engine.connections.get(owner, workspaceConnection);
    expect(used).toMatchObject({ status: 'connected', lastError: null, authFailedAt: null });
    expect(used.lastUsedAt).not.toBeNull();
    expect((await readEventsAfter(db.db, workspaceId, before, 10)).map((event) => event.type)).toEqual([
      'module.connection.failed',
      'module.connected',
    ]);

    const token = used.webhookPath?.split('/').at(-1) ?? '';
    const found = await engine.connections.findByWebhookToken(token);
    expect(found).toMatchObject({
      workspaceId,
      module: { moduleId: 'mailer' },
      connection: { id: workspaceConnection },
    });
    expect(found?.credentials.api_key).toBe('key_1234567890abcdef');
    expect(await engine.connections.findByWebhookToken('0'.repeat(32))).toBeNull();
  });

  it("keeps a person's connections theirs, and resolves theirs before the workspace's", async () => {
    // The member connects their own calendar account (as their agent would), and the workspace gets one too.
    const { state } = await engine.connections.beginOAuth(agent, {
      module: 'calendar-sync',
      codeVerifier: 'verifier-123',
      returnTo: '/workspaces/acme/settings/integrations',
    });
    const record = await engine.connections.takeOAuthState(state);
    expect(record).toEqual({
      workspaceId,
      userId: 'u_member',
      moduleId: 'calendar-sync',
      providerId: 'account',
      visibility: 'user',
      codeVerifier: 'verifier-123',
      returnTo: '/workspaces/acme/settings/integrations',
    });
    // A state is good once.
    expect(await engine.connections.takeOAuthState(state)).toBeNull();
    const save = (userId: string, visibility: 'user' | 'workspace', accessToken: string, refreshToken?: string) =>
      engine.connections.saveOAuth({
        workspaceId,
        moduleId: 'calendar-sync',
        providerId: 'account',
        visibility,
        userId,
        account: visibility === 'user' ? `${userId}@example.com` : 'shared@example.com',
        tokens: { accessToken, refreshToken, expiresAt: new Date(now.getTime() + 3600_000), scopes: ['calendar'] },
      });
    const mine = await save('u_member', 'user', 'at_member_1', 'rt_member');
    const shared = await save('u_owner', 'workspace', 'at_shared', 'rt_shared');
    expect(mine).toMatchObject({ visibility: 'user', ownerUserId: 'u_member', account: 'u_member@example.com' });
    // Connecting the same account again refreshes the connection, keeping its refresh token when none comes.
    const again = await save('u_member', 'user', 'at_member_2');
    expect(again.id).toBe(mine.id);
    expect((await engine.connections.open(workspaceId, mine.id)).credentials).toMatchObject({
      accessToken: 'at_member_2',
      refreshToken: 'rt_member',
    });

    // The owner sees the workspace's connections and none of the member's own.
    const ownerSees = (await engine.connections.list(owner, { module: 'calendar-sync' })).map((c) => c.id);
    expect(ownerSees).toEqual([shared.id]);
    expect(await codeOf(engine.connections.get(owner, mine.id))).toBe('NOT_FOUND');
    expect((await engine.connections.list(member, { module: 'calendar-sync' })).map((c) => c.id).sort()).toEqual(
      [mine.id, shared.id].sort(),
    );

    const resolve = (options: Parameters<DataEngine['connections']['resolve']>[2]) =>
      engine.connections.resolve(workspaceId, 'calendar-sync', options).then((stored) => stored?.connection.id);
    expect(await resolve({ userId: 'u_member' })).toBe(mine.id);
    expect(await resolve({ userId: 'u_owner' })).toBe(shared.id);
    expect(await resolve({ userId: null })).toBe(shared.id);
    expect(await resolve({ connectionId: shared.id, userId: 'u_member' })).toBe(shared.id);
    // Nobody else's run uses a person's connection, even by id.
    expect(await codeOf(resolve({ connectionId: mine.id, userId: null }))).toBe('FORBIDDEN');
    expect(await engine.connections.resolve(workspaceId, 'fixture', {})).toBeNull();

    // Their own is theirs to change; the owner may not touch it.
    expect(await codeOf(engine.connections.disconnect(owner, mine.id))).toBe('NOT_FOUND');
    expect(await engine.connections.openAs(member, mine.id)).toMatchObject({ connection: { id: mine.id } });
    expect(await codeOf(engine.connections.openAs(member, shared.id))).toBe('FORBIDDEN');
  });

  it('expires consent states and refreshes tokens once under concurrent use', async () => {
    const { state } = await engine.connections.beginOAuth(owner, { module: 'calendar-sync', codeVerifier: null });
    now = new Date(now.getTime() + 11 * 60_000);
    expect(await engine.connections.takeOAuthState(state)).toBeNull();
    // Only people start consents.
    const key: EngineContext = {
      workspaceId,
      actor: { kind: 'api_key', id: 'k1' },
      role: null,
      apiKeyPermissions: { module: ['connect', 'manage'] },
    };
    expect(await codeOf(engine.connections.beginOAuth(key, { module: 'calendar-sync', codeVerifier: null }))).toBe(
      'FORBIDDEN',
    );

    const shared = (await engine.connections.list(owner, { module: 'calendar-sync' }))[0];

    if (!shared) {
      throw new Error('the workspace has a calendar connection');
    }

    let refreshed = 0;
    const fetch = vi.fn(async (current: { credentials: Record<string, string> }) => {
      // The second caller waits for the first one's row lock, then sees fresh tokens and asks for none.
      if (current.credentials.accessToken === 'at_refreshed') {
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      refreshed += 1;

      return { accessToken: 'at_refreshed', expiresAt: new Date(now.getTime() + 3600_000) };
    });
    const [first, second] = await Promise.all([
      engine.connections.refresh(workspaceId, shared.id, fetch),
      engine.connections.refresh(workspaceId, shared.id, fetch),
    ]);
    expect(first.credentials.accessToken).toBe('at_refreshed');
    expect(second.credentials.accessToken).toBe('at_refreshed');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refreshed).toBe(1);
    expect((await engine.connections.open(workspaceId, shared.id)).credentials).toMatchObject({
      accessToken: 'at_refreshed',
      refreshToken: 'rt_shared',
    });
  });

  it("sets the workspace's variables, never the server's", async () => {
    expect(await engine.moduleVariables.values(workspaceId, 'mailer')).toEqual({});
    await engine.moduleVariables.update(owner, 'mailer', { values: { REGION: 'us' } });
    expect(await engine.moduleVariables.values(workspaceId, 'mailer')).toEqual({ REGION: 'us' });
    await engine.moduleVariables.update(owner, 'mailer', { values: { REGION: '' } });
    expect(await engine.moduleVariables.values(workspaceId, 'mailer')).toEqual({});
    const update = (values: Record<string, string>, ctx = owner) =>
      engine.moduleVariables.update(ctx, 'mailer', { values });
    expect(await codeOf(update({ PARTNER_ID: 'p1' }))).toBe('VALIDATION');
    expect(await codeOf(update({ NOPE: 'x' }))).toBe('VALIDATION');
    expect(await codeOf(update({ REGION: 'us' }, member))).toBe('FORBIDDEN');
  });

  it('stores inbound events once per external id, announces them and pages them newest first', async () => {
    const before = await engine.events.currentSequence(workspaceId);
    const first = await engine.moduleEvents.receive(
      workspaceId,
      'mailer',
      [
        { type: 'delivered', externalId: 'evt_1', payload: { id: 'evt_1', ok: true } },
        { type: 'bounced', externalId: 'evt_2', payload: { id: 'evt_2' } },
        { type: 'delivered', payload: { anonymous: true } },
      ],
      workspaceConnection,
    );
    expect(first).toMatchObject({ received: 3, duplicates: 0 });
    const again = await engine.moduleEvents.receive(workspaceId, 'mailer', [
      { type: 'delivered', externalId: 'evt_1', payload: {} },
    ]);
    expect(again).toMatchObject({ received: 0, duplicates: 1 });
    const feed = await readEventsAfter(db.db, workspaceId, before, 10);
    expect(feed.map((e) => e.type)).toEqual(['module.event', 'module.event', 'module.event']);
    expect(feed[0]).toMatchObject({
      moduleId: 'mailer',
      eventType: 'delivered',
      eventId: first.events[0]?.id,
      actor: { kind: 'system', id: 'module:mailer' },
    });
    const page = await engine.moduleEvents.list(member, 'mailer', { limit: 2 });
    expect(page.items.map((e) => e.type)).toEqual(['delivered', 'bounced']);
    expect(page.items[0]?.payload).toEqual({ anonymous: true });
    expect(page.nextCursor).toBe(page.items[1]?.id);
    const rest = await engine.moduleEvents.list(member, 'mailer', { cursor: page.nextCursor ?? undefined });
    expect(rest.items.map((e) => e.externalId)).toEqual(['evt_1']);
    expect(rest.nextCursor).toBeNull();
    expect((await engine.moduleEvents.list(member, 'mailer', { type: 'bounced' })).items).toHaveLength(1);
    expect(await engine.moduleEvents.get(workspaceId, first.events[1]?.id ?? '')).toMatchObject({
      type: 'bounced',
      moduleId: 'mailer',
    });
  });

  it('validates event triggers and action steps against installed modules', async () => {
    const create = (input: unknown) => engine.workflows.create(owner, input);
    const step = (patch: Record<string, unknown>) => ({
      kind: 'action',
      actionId: 'mailer.send',
      input: { to: '{{event.payload.email}}' },
      ...patch,
    });
    const trigger = { kind: 'event', moduleId: 'mailer', types: ['delivered'] };
    expect(await codeOf(create({ title: 'x', trigger: { ...trigger, moduleId: 'ghost' }, steps: [step({})] }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(create({ title: 'x', trigger, steps: [step({ actionId: 'ghost.send' })] }))).toBe('VALIDATION');
    expect(await codeOf(create({ title: 'x', trigger, steps: [step({ actionId: 'mailer.nope' })] }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(create({ title: 'x', trigger, steps: [step({ actionId: 'nope' })] }))).toBe('VALIDATION');
    expect(await codeOf(create({ title: 'x', trigger, steps: [step({ input: {} })] }))).toBe('VALIDATION');
    expect(await codeOf(create({ title: 'x', trigger, steps: [step({ input: { to: 'a', extra: 1 } })] }))).toBe(
      'VALIDATION',
    );
    // No record on an event trigger: updating the record is refused, creating one is fine.
    expect(
      await codeOf(
        create({
          title: 'x',
          trigger,
          steps: [
            {
              kind: 'action',
              actionId: 'core.update_record',
              input: { object: 'person', id: '{{record.id}}', values: {} },
            },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    // Calendar sync delivers no events.
    expect(
      await codeOf(create({ title: 'x', trigger: { ...trigger, moduleId: 'calendar-sync' }, steps: [step({})] })),
    ).toBe('VALIDATION');
    const before = await engine.events.currentSequence(workspaceId);
    const workflow = await engine.workflows.create(owner, {
      title: 'On delivery',
      trigger,
      steps: [
        step({}),
        {
          kind: 'action',
          actionId: 'core.create_record',
          input: { object: 'chore', values: { title: '{{event.type}}' } },
        },
      ],
    });
    expect(workflow.trigger).toEqual(trigger);
    // Log-following triggers get a cursor at the sequence before their own creation event.
    expect(await engine.workflows.getCursor(workspaceId, workflow.id)).toBe(before);
  });

  it('disconnects, drops everything with an uninstall and purges with the workspace', async () => {
    const before = await engine.events.currentSequence(workspaceId);
    expect(await codeOf(engine.connections.disconnect(member, workspaceConnection))).toBe('FORBIDDEN');
    const removed = await engine.connections.disconnect(owner, workspaceConnection);
    expect(removed?.credentials.api_key).toBe('key_1234567890abcdef');
    expect(await codeOf(engine.connections.get(owner, workspaceConnection))).toBe('NOT_FOUND');
    expect((await readEventsAfter(db.db, workspaceId, before, 10)).map((event) => event.type)).toEqual([
      'module.disconnected',
    ]);
    await engine.moduleVariables.update(owner, 'mailer', { values: { REGION: 'us' } });
    await engine.connections.create(owner, { module: 'mailer', values: { api_key: 'key_again' } });
    await engine.modules.uninstall(owner, 'mailer', { allowDestructive: true });
    await engine.modules.uninstall(owner, 'calendar-sync', { allowDestructive: true });
    const count = async (table: string) => {
      const rows = await runRaw<{ n: unknown }>(
        db.db,
        sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE workspace_id = ${workspaceId}`,
      );

      return Number(rows[0]?.n);
    };

    for (const table of ['module_connection', 'module_variable', 'module_event']) {
      expect(await count(table)).toBe(0);
    }

    await engine.notifications.send(owner, { recipients: [owner.actor.id], title: 'Going away' });
    await engine.workspaces.purge(workspaceId);
    expect(await count('notification')).toBe(0);
  });
});
