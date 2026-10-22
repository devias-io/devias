import { parseManifest } from '@devias/core';
import { manifest as fixture, mailerManifest, paymentsManifest } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient, receiveModuleEvent } from '../src/mock';
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
    expect((await client.modules.list()).map((e) => e.moduleId)).toEqual(['fixture', 'payments']);
    expect((await client.modules.connections.list({ module: 'payments' })).connections).toEqual([
      expect.objectContaining({ providerId: 'default', visibility: 'workspace', status: 'connected' }),
    ]);
    const workflows = await client.workflows.list();
    expect(workflows.find((w) => w.title === 'Invoice paid')?.trigger).toEqual({
      kind: 'event',
      moduleId: 'payments',
      types: ['invoice.paid'],
    });
  });

  it('serves a catalog, connects with masked hints and validates like the server', async () => {
    const client = demo();
    expect((await client.modules.catalog()).map((m) => m.id)).toEqual(['fixture', 'payments', 'mailer']);
    expect(await client.modules.connections.list()).toEqual({ providers: [], connections: [] });
    const connect = (values: Record<string, string>) =>
      client.modules.connections.create({ module: 'payments', values });
    expect((await failure(connect({ secret_key: 'x' }))).code).toBe('NOT_FOUND');
    await client.modules.apply(paymentsManifest);
    expect((await client.modules.connections.list()).providers).toEqual([
      expect.objectContaining({ moduleId: 'payments', providerId: 'default', kind: 'api_key', available: true }),
    ]);
    expect((await failure(connect({}))).message).toMatch(/Secret key is required/);
    expect((await failure(connect({ nope: 'x' }))).code).toBe('VALIDATION');
    expect((await failure(client.modules.runAction('payments', 'create_customer', { email: 'a' }))).message).toMatch(
      /not connected/,
    );
    const saved = await connect({ secret_key: 'sk_test_1234567890abcdef' });
    expect(saved).toMatchObject({ moduleId: 'payments', status: 'connected', hints: { secret_key: 'sk_t…cdef' } });
    expect(saved.webhookUrl).toMatch(/^https:\/\/mock\.devias\.local\/api\/webhooks\//);
    expect((await failure(connect({ secret_key: 'sk_again' }))).code).toBe('CONFLICT');
    const more = await client.modules.connections.update(saved.id, {
      values: { webhook_secret: 'whsec_1234567890abcdef' },
    });
    expect(more.hints).toEqual({ secret_key: 'sk_t…cdef', webhook_secret: 'whse…cdef' });
    expect((await client.modules.connections.test(saved.id)).ok).toBe(true);
    const ran = await client.modules.runAction('payments', 'create_customer', {
      email: 'a@x.test',
      connectionId: saved.id,
    });
    expect(ran).toMatchObject({ mock: true, action: 'create_customer', input: { email: 'a@x.test' } });
    expect((await failure(client.modules.runAction('payments', 'create_customer', {}))).message).toMatch(
      /Email is required/,
    );
    expect((await failure(client.modules.runAction('payments', 'nope', {}))).code).toBe('NOT_FOUND');
    await client.modules.connections.disconnect(saved.id);
    expect((await client.modules.connections.list()).connections).toEqual([]);
  });

  it('starts event workflows from received events and runs action steps with templates', async () => {
    const client = demo();
    await client.modules.apply(paymentsManifest);
    await client.modules.apply(mailerManifest);
    await client.modules.connections.create({ module: 'payments', values: { secret_key: 'sk_test_1234567890abcdef' } });
    await client.modules.connections.create({ module: 'mailer', values: { api_key: 're_1234567890abcdef' } });
    const bad = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'event', moduleId: 'ghost', types: ['*'] },
        steps: [{ kind: 'action', actionId: 'core.create_record', input: { object: 'chore', values: {} } }],
      }),
    );
    expect(bad.code).toBe('VALIDATION');
    const workflow = await client.workflows.create({
      title: 'Invoice paid',
      trigger: { kind: 'event', moduleId: 'payments', types: ['invoice.paid'] },
      steps: [
        {
          id: 'chore',
          kind: 'action',
          actionId: 'core.create_record',
          input: { object: 'chore', values: { title: 'Thank {{event.payload.email}}' } },
        },
        {
          id: 'mail',
          kind: 'action',
          actionId: 'mailer.send_email',
          input: { from: 'a@x.test', to: '{{event.payload.email}}', subject: 'Thanks' },
        },
      ],
    });
    const stored = receiveModuleEvent(client.store, 'payments', {
      type: 'invoice.paid',
      externalId: 'evt_1',
      payload: { email: 'grace@x.test' },
    });
    expect(stored?.type).toBe('invoice.paid');
    expect(receiveModuleEvent(client.store, 'payments', { type: 'invoice.paid', externalId: 'evt_1' })).toBeNull();
    receiveModuleEvent(client.store, 'payments', { type: 'customer.created', payload: {} });
    await flush();
    const runs = await client.workflows.runs(workflow.id);
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'event', eventType: 'invoice.paid', moduleId: 'payments' },
    });
    expect(runs.items[0]?.steps[1]?.output).toMatchObject({ mock: true, input: { to: 'grace@x.test' } });
    const tasks = await client.records.list({
      object: 'chore',
      filter: { field: 'title', op: 'eq', value: 'Thank grace@x.test' },
    });
    expect(tasks.items).toHaveLength(1);
    const events = await client.modules.events('payments');
    expect(events.items.map((e) => e.type)).toEqual(['customer.created', 'invoice.paid']);
    // Connections and events survive a snapshot round-trip, and go away with an uninstall.
    const snapshot = client.store.snapshot();
    expect(snapshot.connections?.map((c) => c.moduleId)).toEqual(['payments', 'mailer']);
    expect(snapshot.moduleEvents).toHaveLength(2);
    await client.modules.uninstall('payments', { allowDestructive: true });
    expect([...client.store.connections.values()].map((c) => c.moduleId)).toEqual(['mailer']);
    expect(client.store.moduleEvents).toEqual([]);
  });

  it('connects accounts at once, as the signed-in person, and keeps them theirs', async () => {
    const google = {
      id: 'calendar-sync',
      version: '0.1.0',
      variables: [
        { key: 'CLIENT_ID', label: 'Client id', server: true },
        { key: 'CLIENT_SECRET', label: 'Client secret', server: true, secret: true },
      ],
      connections: [
        {
          id: 'calendar-sync.account',
          kind: 'oauth2' as const,
          oauth: {
            authorizeUrl: 'https://accounts.example/authorize',
            tokenUrl: 'https://accounts.example/token',
            clientId: { variable: 'CLIENT_ID' },
            clientSecret: { variable: 'CLIENT_SECRET' },
          },
        },
      ],
    };
    const client = demo();
    await client.modules.apply(parseManifest(google));
    const { url } = await client.modules.connections.authorize({ module: 'calendar-sync' });
    expect(url).toContain('mock-consent');
    const [mine] = (await client.modules.connections.list({ module: 'calendar-sync' })).connections;
    expect(mine).toMatchObject({
      kind: 'oauth2',
      visibility: 'user',
      ownerUserId: client.store.actor.id,
      status: 'connected',
    });
    await client.modules.connections.authorize({ module: 'calendar-sync' });
    expect((await client.modules.connections.list({ module: 'calendar-sync' })).connections).toHaveLength(1);
    // Someone else in the same workspace does not see it.
    client.store.actor = { kind: 'user', id: 'someone_else' };
    expect((await client.modules.connections.list({ module: 'calendar-sync' })).connections).toEqual([]);
  });
});
