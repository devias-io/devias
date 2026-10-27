import { coreIds, defineModule } from '@devias/core';
import { manifest as fixtureManifest } from '@devias/fixtures';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  agentContext,
  createDataEngine,
  createSecretBox,
  type DataEngine,
  type EngineContext,
  EngineError,
  isSealed,
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
  id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  version: '0.1.0',
  label: 'Mailer',
  connections: [
    {
      id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
      kind: 'api_key',
      fields: [
        { name: 'api_key', label: 'API key' },
        { name: 'webhook_secret', label: 'Webhook secret', required: false },
      ],
    },
  ],
  variables: [
    { id: '01a1751f-5f0d-769d-975f-3496a30b1671', label: 'Region', defaultValue: 'eu' },
    { id: '01a1751f-5f0d-769d-975f-394e763c6304', label: 'Signing secret', secret: true },
  ],
  actions: [
    {
      id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
      name: 'send',
      label: 'Send',
      input: [
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'body', label: 'Body', type: 'long_text' },
      ],
    },
  ],
  events: [{ id: '01a1751f-5f0d-769d-975f-43976493500f', name: 'delivered' }],
});
const calendar = defineModule({
  id: '01a1751f-5f0d-769d-975f-5ecf07b21598',
  version: '0.1.0',
  label: 'Calendar sync',
  variables: [
    { id: '01a1751f-5f0d-769d-975f-474b0fc44405', label: 'Client id', required: true },
    { id: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7', label: 'Client secret', secret: true, required: true },
  ],
  connections: [
    {
      id: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
      kind: 'oauth2',
      visibility: 'both',
      oauth: {
        authorizeUrl: 'https://accounts.example/authorize',
        tokenUrl: 'https://accounts.example/token',
        scopes: ['01a1751f-5f0b-70b0-8818-94721c3e49d6'],
        clientId: { variable: '01a1751f-5f0d-769d-975f-474b0fc44405' },
        clientSecret: { variable: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7' },
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
    expect(
      await codeOf(
        engine.connections.create(owner, { module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', values: { api_key: 'k' } }),
      ),
    ).toBe('NOT_FOUND');
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
      moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      providerId: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
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
      sql`SELECT sealed FROM connection WHERE id = ${connection.id}::uuid`,
    );
    expect(rows[0]?.sealed).not.toContain('key_1234567890abcdef');
    expect(rows[0]?.sealed.startsWith('v1.')).toBe(true);
    expect((await engine.connections.open(workspaceId, connection.id)).credentials).toEqual({
      api_key: 'key_1234567890abcdef',
    });
    expect(await readEventsAfter(db.db, workspaceId, before, 10)).toEqual([
      expect.objectContaining({
        type: 'module.connected',
        moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
        connectionId: connection.id,
        providerId: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
      }),
    ]);
    // Members see the workspace's connection, only admins change it; a second one for the workspace is refused.
    expect(await engine.connections.get(member, connection.id)).toEqual(connection);
    expect(
      await codeOf(
        engine.connections.create(member, { module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', values: { api_key: 'x' } }),
      ),
    ).toBe('FORBIDDEN');
    expect(await codeOf(engine.connections.update(member, connection.id, { label: 'Mine now' }))).toBe('FORBIDDEN');
    expect(
      await codeOf(
        engine.connections.create(owner, {
          module: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
          values: { api_key: 'other' },
        }),
      ),
    ).toBe('CONFLICT');
  });

  it("keeps each action's name in the installed module", async () => {
    const installed = (await engine.modules.list(owner)).find(
      (one) => one.id === '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    );
    expect(installed?.actions.map((action) => [action.id, action.name])).toEqual([
      ['01a1751f-5f0d-769d-975f-3dec4f4d5066', 'send'],
    ]);
  });

  it('validates the module, the provider, whose it is and the fields', async () => {
    const create = (input: unknown, ctx = owner) => engine.connections.create(ctx, input);
    expect(await codeOf(create({ module: 'ghost', values: { api_key: 'k' } }))).toBe('NOT_FOUND');
    expect(await codeOf(create({ module: '01a1751f-5f09-7114-9d75-ce42abd8a6ef', values: { anything: 'x' } }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(
        create({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', provider: 'nope', values: { api_key: 'k' } }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', visibility: 'user', values: { api_key: 'k' } }),
      ),
    ).toBe('VALIDATION');
    expect(await codeOf(create({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', values: { nope: 'x' } }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(create({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', values: { webhook_secret: 'only' } })),
    ).toBe('VALIDATION');
    // OAuth providers connect through their consent page.
    expect(await codeOf(create({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598', values: { token: 'x' } }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(create({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f', values: 'x' }))).toBe('VALIDATION');
  });

  it('names a provider by its id, not by the end of it', async () => {
    const acme = defineModule({
      id: '01a1751f-5f0d-769d-975f-603c8bc7416f',
      version: '0.1.0',
      connections: [
        {
          id: '01a1751f-5f0d-769d-975f-52cc5c75afdb',
          kind: 'api_key',
          fields: [{ name: 'api_key', label: 'API key' }],
        },
      ],
    });
    await engine.modules.apply(owner, acme);
    const made = await engine.connections.create(owner, {
      module: '01a1751f-5f0d-769d-975f-603c8bc7416f',
      provider: '01a1751f-5f0d-769d-975f-52cc5c75afdb',
      values: { api_key: 'k' },
    });
    expect(made).toMatchObject({
      moduleId: '01a1751f-5f0d-769d-975f-603c8bc7416f',
      providerId: '01a1751f-5f0d-769d-975f-52cc5c75afdb',
    });
    // The end of the id is not the provider.
    expect(
      await codeOf(
        engine.connections.create(owner, {
          module: '01a1751f-5f0d-769d-975f-603c8bc7416f',
          provider: 'provider_one',
          values: { api_key: 'k' },
        }),
      ),
    ).toBe('VALIDATION');
    await engine.modules.uninstall(owner, '01a1751f-5f0d-769d-975f-603c8bc7416f');
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
      module: { id: '01a1751f-5f0a-70f6-b258-c2c96a69790f' },
      connection: { id: workspaceConnection },
    });
    expect(found?.credentials.api_key).toBe('key_1234567890abcdef');
    expect(await engine.connections.findByWebhookToken('0'.repeat(32))).toBeNull();
  });

  it("keeps a person's connections theirs, and resolves theirs before the workspace's", async () => {
    // The member connects their own calendar account (as their agent would), and the workspace gets one too.
    const { state } = await engine.connections.beginOAuth(agent, {
      module: '01a1751f-5f0d-769d-975f-5ecf07b21598',
      codeVerifier: 'verifier-123',
      returnTo: '/workspaces/acme/settings/integrations',
    });
    const record = await engine.connections.takeOAuthState(state);
    expect(record).toEqual({
      workspaceId,
      userId: 'u_member',
      moduleId: '01a1751f-5f0d-769d-975f-5ecf07b21598',
      providerId: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
      visibility: 'user',
      codeVerifier: 'verifier-123',
      returnTo: '/workspaces/acme/settings/integrations',
    });
    // A state is good once.
    expect(await engine.connections.takeOAuthState(state)).toBeNull();
    const save = (userId: string, visibility: 'user' | 'workspace', accessToken: string, refreshToken?: string) =>
      engine.connections.saveOAuth({
        workspaceId,
        moduleId: '01a1751f-5f0d-769d-975f-5ecf07b21598',
        providerId: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
        visibility,
        userId,
        account: visibility === 'user' ? `${userId}@example.com` : 'shared@example.com',
        tokens: {
          accessToken,
          refreshToken,
          expiresAt: new Date(now.getTime() + 3600_000),
          scopes: ['01a1751f-5f0b-70b0-8818-94721c3e49d6'],
        },
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
    const ownerSees = (await engine.connections.list(owner, { module: '01a1751f-5f0d-769d-975f-5ecf07b21598' })).map(
      (c) => c.id,
    );
    expect(ownerSees).toEqual([shared.id]);
    expect(await codeOf(engine.connections.get(owner, mine.id))).toBe('NOT_FOUND');
    expect(
      (await engine.connections.list(member, { module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }))
        .map((c) => c.id)
        .sort(),
    ).toEqual([mine.id, shared.id].sort());

    const resolve = (options: Parameters<DataEngine['connections']['resolve']>[2]) =>
      engine.connections
        .resolve(workspaceId, '01a1751f-5f0d-769d-975f-5ecf07b21598', options)
        .then((stored) => stored?.connection.id);
    expect(await resolve({ userId: 'u_member' })).toBe(mine.id);
    expect(await resolve({ userId: 'u_owner' })).toBe(shared.id);
    expect(await resolve({ userId: null })).toBe(shared.id);
    expect(await resolve({ connectionId: shared.id, userId: 'u_member' })).toBe(shared.id);
    // Nobody else's run uses a person's connection, even by id.
    expect(await codeOf(resolve({ connectionId: mine.id, userId: null }))).toBe('FORBIDDEN');
    expect(await engine.connections.resolve(workspaceId, '01a1751f-5f09-7114-9d75-ce42abd8a6ef', {})).toBeNull();

    // Their own is theirs to change; the owner may not touch it.
    expect(await codeOf(engine.connections.disconnect(owner, mine.id))).toBe('NOT_FOUND');
    expect(await engine.connections.openAs(member, mine.id)).toMatchObject({ connection: { id: mine.id } });
    expect(await codeOf(engine.connections.openAs(member, shared.id))).toBe('FORBIDDEN');
  });

  it('expires consent states and refreshes tokens once under concurrent use', async () => {
    const { state } = await engine.connections.beginOAuth(owner, {
      module: '01a1751f-5f0d-769d-975f-5ecf07b21598',
      codeVerifier: null,
    });
    now = new Date(now.getTime() + 11 * 60_000);
    expect(await engine.connections.takeOAuthState(state)).toBeNull();
    // Only people start consents.
    const key: EngineContext = {
      workspaceId,
      actor: { kind: 'api_key', id: 'k1' },
      role: null,
      apiKeyPermissions: { module: ['connect', 'manage'] },
    };
    expect(
      await codeOf(
        engine.connections.beginOAuth(key, { module: '01a1751f-5f0d-769d-975f-5ecf07b21598', codeVerifier: null }),
      ),
    ).toBe('FORBIDDEN');

    const shared = (await engine.connections.list(owner, { module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }))[0];

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

  it("sets the workspace's variables by id, and seals a secret one", async () => {
    const region = '01a1751f-5f0d-769d-975f-3496a30b1671';
    const signing = '01a1751f-5f0d-769d-975f-394e763c6304';
    expect(await engine.variables.values(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f')).toEqual({});
    await engine.variables.update(owner, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { values: { [region]: 'us' } });
    expect(await engine.variables.values(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f')).toEqual({
      [region]: 'us',
    });
    await engine.variables.update(owner, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { values: { [region]: '' } });
    expect(await engine.variables.values(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f')).toEqual({});
    const update = (values: Record<string, string>, ctx = owner) =>
      engine.variables.update(ctx, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { values });
    expect(await codeOf(update({ NOPE: 'x' }))).toBe('VALIDATION');
    expect(await codeOf(update({ [region]: 'us' }, member))).toBe('FORBIDDEN');
    // A secret is opened for the module's code, and is sealed in the table.
    await update({ [signing]: '  whsec_1234  ' });
    expect(await engine.variables.values(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f')).toEqual({
      [signing]: 'whsec_1234',
    });
    const [row] = await runRaw<{ value: string }>(
      db.db,
      sql`SELECT value FROM variable WHERE workspace_id = ${workspaceId} AND id = ${signing}`,
    );
    expect(row?.value).not.toContain('whsec_1234');
    expect(isSealed(row?.value ?? '')).toBe(true);
    // Not by an agent or a workflow: the value would pass through a chat or a workflow's steps.
    const agent = agentContext(owner, 'agent_1');
    expect(await codeOf(update({ [signing]: 'other' }, agent))).toBe('VALIDATION');
    await update({ [region]: 'eu-2' }, agent);
    await update({ [signing]: '', [region]: '' });
    expect(await engine.variables.values(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f')).toEqual({});
  });

  it('stores inbound events once per external id, announces them and pages them newest first', async () => {
    const before = await engine.events.currentSequence(workspaceId);
    const first = await engine.webhookEvents.receive(
      workspaceId,
      '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      [
        { type: 'delivered', externalId: 'evt_1', payload: { id: 'evt_1', ok: true } },
        { type: 'bounced', externalId: 'evt_2', payload: { id: 'evt_2' } },
        { type: 'delivered', payload: { anonymous: true } },
      ],
      workspaceConnection,
    );
    expect(first).toMatchObject({ received: 3, duplicates: 0 });
    const again = await engine.webhookEvents.receive(workspaceId, '01a1751f-5f0a-70f6-b258-c2c96a69790f', [
      { type: 'delivered', externalId: 'evt_1', payload: {} },
    ]);
    expect(again).toMatchObject({ received: 0, duplicates: 1 });
    const feed = await readEventsAfter(db.db, workspaceId, before, 10);
    expect(feed.map((e) => e.type)).toEqual(['module.event', 'module.event', 'module.event']);
    expect(feed[0]).toMatchObject({
      moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      eventType: 'delivered',
      eventId: first.events[0]?.id,
      actor: { kind: 'system', id: 'module:01a1751f-5f0a-70f6-b258-c2c96a69790f' },
    });
    const page = await engine.webhookEvents.list(member, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { limit: 2 });
    expect(page.items.map((e) => e.type)).toEqual(['delivered', 'bounced']);
    expect(page.items[0]?.payload).toEqual({ anonymous: true });
    expect(page.nextCursor).toBe(page.items[1]?.id);
    const rest = await engine.webhookEvents.list(member, '01a1751f-5f0a-70f6-b258-c2c96a69790f', {
      cursor: page.nextCursor ?? undefined,
    });
    expect(rest.items.map((e) => e.externalId)).toEqual(['evt_1']);
    expect(rest.nextCursor).toBeNull();
    expect(
      (await engine.webhookEvents.list(member, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { type: 'bounced' })).items,
    ).toHaveLength(1);
    expect(await engine.webhookEvents.get(workspaceId, first.events[1]?.id ?? '')).toMatchObject({
      type: 'bounced',
      moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    });
  });

  it('validates event triggers and action steps against installed modules', async () => {
    const create = (input: unknown) => engine.workflows.create(owner, input);
    const step = (patch: Record<string, unknown>) => ({
      kind: 'action',
      actionId: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
      input: { to: '{{event.payload.email}}' },
      ...patch,
    });
    const trigger = { kind: 'module_event', moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f', types: ['delivered'] };
    expect(await codeOf(create({ title: 'x', trigger: { ...trigger, moduleId: 'ghost' }, steps: [step({})] }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(
        create({ title: 'x', trigger, steps: [step({ actionId: '01a1751f-5f0d-769d-975f-57b473f7eb94' })] }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({ title: 'x', trigger, steps: [step({ actionId: '01a1751f-5f0d-769d-975f-594c559a78f5' })] }),
      ),
    ).toBe('VALIDATION');
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
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: {} },
            },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    // Calendar sync delivers no events.
    expect(
      await codeOf(
        create({
          title: 'x',
          trigger: { ...trigger, moduleId: '01a1751f-5f0d-769d-975f-5ecf07b21598' },
          steps: [step({})],
        }),
      ),
    ).toBe('VALIDATION');
    const before = await engine.events.currentSequence(workspaceId);
    const workflow = await engine.workflows.create(owner, {
      title: 'On delivery',
      trigger,
      steps: [
        step({}),
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
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
    await engine.variables.update(owner, '01a1751f-5f0a-70f6-b258-c2c96a69790f', {
      values: { '01a1751f-5f0d-769d-975f-3496a30b1671': 'us' },
    });
    await engine.connections.create(owner, {
      module: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      values: { api_key: 'key_again' },
    });
    await engine.modules.uninstall(owner, '01a1751f-5f0a-70f6-b258-c2c96a69790f', { allowDestructive: true });
    await engine.modules.uninstall(owner, '01a1751f-5f0d-769d-975f-5ecf07b21598', { allowDestructive: true });
    const count = async (table: string) => {
      const rows = await runRaw<{ n: unknown }>(
        db.db,
        sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE workspace_id = ${workspaceId}`,
      );

      return Number(rows[0]?.n);
    };

    for (const table of ['connection', 'variable', 'webhook_event']) {
      expect(await count(table)).toBe(0);
    }

    await engine.notifications.send(owner, { recipients: [owner.actor.id], title: 'Going away' });
    await engine.workspaces.purge(workspaceId);
    expect(await count('notification')).toBe(0);
  });
});
