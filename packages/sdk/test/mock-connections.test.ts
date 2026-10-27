import { coreIds, parseManifest } from '@devias/core';
import { manifest as fixture, mailerManifest, paymentsManifest } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient, receiveWebhookEvent } from '../src/mock';
import { demoClient } from './demo-data';

/** No demo data: the fixture installs a Payments of its own, which would get in the way of the checks below. */
const demo = () =>
  createMockClient({
    workspaceId: 'ws_test',
    manifests: [fixture],
    catalog: [paymentsManifest, mailerManifest],
  });

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

describe('mock module connections', () => {
  it('installs Payments with a test key and an event workflow in the demo fixture', async () => {
    const client = demoClient({
      workspaceId: 'ws_demo',
      manifests: [fixture],
      catalog: [paymentsManifest, mailerManifest],
    });
    expect((await client.modules.list()).map((e) => e.id)).toEqual([
      '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
      '01a1751f-5f15-7708-9f78-5224e878aec0',
    ]);
    expect(
      (await client.modules.connections.list({ module: '01a1751f-5f15-7708-9f78-5224e878aec0' })).connections,
    ).toEqual([
      expect.objectContaining({
        providerId: '01a1751f-5f15-7708-9f78-479d86b3b1ec',
        visibility: 'workspace',
        status: 'connected',
      }),
    ]);
    const workflows = await client.workflows.list();
    expect(workflows.find((w) => w.title === 'Invoice paid')?.trigger).toEqual({
      kind: 'module_event',
      moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
      types: ['invoice.paid'],
    });
  });

  it('serves a catalog, connects with masked hints and validates like the server', async () => {
    const client = demo();
    expect((await client.modules.catalog()).map((m) => m.id)).toEqual([
      '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
      '01a1751f-5f15-7708-9f78-5224e878aec0',
      '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    ]);
    expect(await client.modules.connections.list()).toEqual({ providers: [], connections: [] });
    const connect = (values: Record<string, string>) =>
      client.modules.connections.create({ module: '01a1751f-5f15-7708-9f78-5224e878aec0', values });
    expect((await failure(connect({ secret_key: 'x' }))).code).toBe('NOT_FOUND');
    await client.modules.apply(paymentsManifest);
    expect((await client.modules.connections.list()).providers).toEqual([
      expect.objectContaining({
        moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
        providerId: '01a1751f-5f15-7708-9f78-479d86b3b1ec',
        kind: 'api_key',
        available: true,
      }),
    ]);
    expect((await failure(connect({}))).message).toMatch(/Secret key is required/);
    expect((await failure(connect({ nope: 'x' }))).code).toBe('VALIDATION');
    expect(
      (
        await failure(
          client.modules.runAction('01a1751f-5f15-7708-9f78-5224e878aec0', 'create_customer', { email: 'a' }),
        )
      ).message,
    ).toMatch(/not connected/);
    const saved = await connect({ secret_key: 'sk_test_1234567890abcdef' });
    expect(saved).toMatchObject({
      moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
      status: 'connected',
      hints: { secret_key: 'sk_t…cdef' },
    });
    expect(saved.webhookUrl).toMatch(/^https:\/\/mock\.devias\.local\/api\/webhooks\//);
    expect((await failure(connect({ secret_key: 'sk_again' }))).code).toBe('CONFLICT');
    const more = await client.modules.connections.update(saved.id, {
      values: { webhook_secret: 'whsec_1234567890abcdef' },
    });
    expect(more.hints).toEqual({ secret_key: 'sk_t…cdef', webhook_secret: 'whse…cdef' });
    expect((await client.modules.connections.test(saved.id)).ok).toBe(true);
    const ran = await client.modules.runAction('01a1751f-5f15-7708-9f78-5224e878aec0', 'create_customer', {
      email: 'a@x.test',
      connectionId: saved.id,
    });
    expect(ran).toMatchObject({ mock: true, action: 'create_customer', input: { email: 'a@x.test' } });
    expect(
      (await failure(client.modules.runAction('01a1751f-5f15-7708-9f78-5224e878aec0', 'create_customer', {}))).message,
    ).toMatch(/Email is required/);
    expect((await failure(client.modules.runAction('01a1751f-5f15-7708-9f78-5224e878aec0', 'nope', {}))).code).toBe(
      'NOT_FOUND',
    );
    await client.modules.connections.disconnect(saved.id);
    expect((await client.modules.connections.list()).connections).toEqual([]);
  });

  it('starts event workflows from received events and runs action steps with templates', async () => {
    const client = demo();
    await client.modules.apply(paymentsManifest);
    await client.modules.apply(mailerManifest);
    await client.modules.connections.create({
      module: '01a1751f-5f15-7708-9f78-5224e878aec0',
      values: { secret_key: 'sk_test_1234567890abcdef' },
    });
    await client.modules.connections.create({
      module: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      values: { api_key: 're_1234567890abcdef' },
    });
    const bad = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'module_event', moduleId: 'ghost', types: ['*'] },
        steps: [{ kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: {} } }],
      }),
    );
    expect(bad.code).toBe('VALIDATION');
    const workflow = await client.workflows.create({
      title: 'Invoice paid',
      trigger: { kind: 'module_event', moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0', types: ['invoice.paid'] },
      steps: [
        {
          id: 'chore',
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'chore', values: { title: 'Thank {{event.payload.email}}' } },
        },
        {
          id: 'mail',
          kind: 'action',
          actionId: '01a1751f-5f0a-70f6-b258-808951d74c84',
          input: { from: 'a@x.test', to: '{{event.payload.email}}', subject: 'Thanks' },
        },
      ],
    });
    const stored = receiveWebhookEvent(client.store, '01a1751f-5f15-7708-9f78-5224e878aec0', {
      type: 'invoice.paid',
      externalId: 'evt_1',
      payload: { email: 'grace@x.test' },
    });
    expect(stored?.type).toBe('invoice.paid');
    expect(
      receiveWebhookEvent(client.store, '01a1751f-5f15-7708-9f78-5224e878aec0', {
        type: 'invoice.paid',
        externalId: 'evt_1',
      }),
    ).toBeNull();
    receiveWebhookEvent(client.store, '01a1751f-5f15-7708-9f78-5224e878aec0', {
      type: 'customer.created',
      payload: {},
    });
    await flush();
    const runs = await client.workflows.runs(workflow.id);
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'module_event', eventType: 'invoice.paid', moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0' },
    });
    expect(runs.items[0]?.steps[1]?.output).toMatchObject({ mock: true, input: { to: 'grace@x.test' } });
    const tasks = await client.records.list({
      object: 'chore',
      filter: { field: 'title', op: 'eq', value: 'Thank grace@x.test' },
    });
    expect(tasks.items).toHaveLength(1);
    const events = await client.modules.events('01a1751f-5f15-7708-9f78-5224e878aec0');
    expect(events.items.map((e) => e.type)).toEqual(['customer.created', 'invoice.paid']);
    // Connections and events survive a snapshot round-trip, and go away with an uninstall.
    const snapshot = client.store.snapshot();
    expect(snapshot.connections?.map((c) => c.moduleId)).toEqual([
      '01a1751f-5f15-7708-9f78-5224e878aec0',
      '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    ]);
    expect(snapshot.webhookEvents).toHaveLength(2);
    await client.modules.uninstall('01a1751f-5f15-7708-9f78-5224e878aec0', { allowDestructive: true });
    expect([...client.store.connections.values()].map((c) => c.moduleId)).toEqual([
      '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    ]);
    expect(client.store.webhookEvents).toEqual([]);
  });

  it('sets variables by id, keeps a secret out of every answer, and does not take one from an agent', async () => {
    const module = parseManifest({
      id: '01a1751f-5f15-7708-9f78-568c5c10477c',
      version: '0.1.0',
      variables: [
        { id: '01a1751f-5f15-7708-9f78-48786b822a31', label: 'Region', defaultValue: 'eu' },
        { id: '01a1751f-5f15-7708-9f78-4fe20013e6b2', label: 'Signing secret', secret: true },
      ],
    });
    const client = demo();
    await client.modules.apply(module);
    expect(await client.modules.variables.list('01a1751f-5f15-7708-9f78-568c5c10477c')).toMatchObject([
      { id: '01a1751f-5f15-7708-9f78-48786b822a31', value: 'eu', source: 'default' },
      { id: '01a1751f-5f15-7708-9f78-4fe20013e6b2', value: null, source: 'unset' },
    ]);
    const saved = await client.modules.variables.update('01a1751f-5f15-7708-9f78-568c5c10477c', {
      '01a1751f-5f15-7708-9f78-48786b822a31': 'us',
      '01a1751f-5f15-7708-9f78-4fe20013e6b2': 'whsec_1',
    });
    expect(saved).toMatchObject([
      { id: '01a1751f-5f15-7708-9f78-48786b822a31', value: 'us', source: 'workspace' },
      { id: '01a1751f-5f15-7708-9f78-4fe20013e6b2', value: null, source: 'workspace' },
    ]);
    expect(JSON.stringify(saved)).not.toContain('whsec_1');
    expect(
      (await failure(client.modules.variables.update('01a1751f-5f15-7708-9f78-568c5c10477c', { 'signer.nope': 'x' })))
        .code,
    ).toBe('VALIDATION');
    client.store.actor = { kind: 'agent', id: 'agent_1' };
    expect(
      (
        await failure(
          client.modules.variables.update('01a1751f-5f15-7708-9f78-568c5c10477c', {
            '01a1751f-5f15-7708-9f78-4fe20013e6b2': 'other',
          }),
        )
      ).message,
    ).toContain('is a secret');
    await client.modules.variables.update('01a1751f-5f15-7708-9f78-568c5c10477c', {
      '01a1751f-5f15-7708-9f78-48786b822a31': '',
    });
    expect((await client.modules.variables.list('01a1751f-5f15-7708-9f78-568c5c10477c'))[0]).toMatchObject({
      value: 'eu',
      source: 'default',
    });
  });

  it('connects accounts at once, as the signed-in person, and keeps them theirs', async () => {
    const google = {
      id: '01a1751f-5f0d-769d-975f-5ecf07b21598',
      version: '0.1.0',
      variables: [
        { id: '01a1751f-5f0d-769d-975f-474b0fc44405', label: 'Client id', required: true },
        { id: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7', label: 'Client secret', secret: true, required: true },
      ],
      connections: [
        {
          id: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
          kind: 'oauth2' as const,
          oauth: {
            authorizeUrl: 'https://accounts.example/authorize',
            tokenUrl: 'https://accounts.example/token',
            clientId: { variable: '01a1751f-5f0d-769d-975f-474b0fc44405' },
            clientSecret: { variable: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7' },
          },
        },
      ],
    };
    const client = demo();
    await client.modules.apply(parseManifest(google));
    // The Google app is the workspace's: until its client id and secret are set, there is nothing to connect with.
    const [before] = (await client.modules.connections.list({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }))
      .providers;
    expect(before).toMatchObject({
      available: false,
      problem: 'Needs Client id and Client secret in Variables',
      redirectUrl: expect.stringMatching(/\/api\/oauth\/callback$/),
    });
    expect(
      (await failure(client.modules.connections.authorize({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }))).message,
    ).toContain('Needs Client id and Client secret in Variables');
    const set = await client.modules.variables.update('01a1751f-5f0d-769d-975f-5ecf07b21598', {
      '01a1751f-5f0d-769d-975f-474b0fc44405': 'id-1',
      '01a1751f-5f0d-769d-975f-4a1e55d4ecf7': 'secret-1',
    });
    expect(set).toMatchObject([
      { id: '01a1751f-5f0d-769d-975f-474b0fc44405', value: 'id-1', source: 'workspace' },
      { id: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7', secret: true, value: null, source: 'workspace' },
    ]);
    expect(
      (await client.modules.connections.list({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' })).providers[0],
    ).toMatchObject({
      available: true,
    });
    const { url } = await client.modules.connections.authorize({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' });
    expect(url).toContain('mock-consent');
    const [mine] = (await client.modules.connections.list({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }))
      .connections;
    expect(mine).toMatchObject({
      kind: 'oauth2',
      visibility: 'user',
      ownerUserId: client.store.actor.id,
      status: 'connected',
    });
    await client.modules.connections.authorize({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' });
    expect(
      (await client.modules.connections.list({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' })).connections,
    ).toHaveLength(1);
    // Someone else in the same workspace does not see it.
    client.store.actor = { kind: 'user', id: 'someone_else' };
    expect(
      (await client.modules.connections.list({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' })).connections,
    ).toEqual([]);
  });
});
