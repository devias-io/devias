import { createHmac } from 'node:crypto';
import { coreIds, defineModule, type ModuleManifest, notificationActions, workflowCanRun } from '@devias/core';
import { ids as crmIds } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as emailIds } from '@devias/mod-email-resend/manifest';
import { ids as stripeIds } from '@devias/mod-payment-stripe/manifest';
import { defineActionHandler, defineModuleServer } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

/** Answers like Stripe and Resend would, and records what was sent. */
const providerFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';

  if (url.startsWith('https://api.stripe.com/v1/balance')) {
    return auth === 'Bearer sk_test_goodkey12345'
      ? json({ livemode: false })
      : json({ error: { message: 'Invalid API Key' } }, 401);
  }

  if (url.startsWith('https://api.resend.com/domains')) {
    return json({ data: [{ name: 'acme.test', status: 'verified' }] });
  }

  if (url.startsWith('https://api.resend.com/emails')) {
    return json({ id: 'em_1' });
  }

  return json({ message: 'unexpected' }, 500);
});

const stripeSignature = (secret: string, body: string): string => {
  const t = Math.floor(Date.now() / 1000);

  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
};

describe('module connections, actions and events over HTTP', () => {
  let server: Server;
  let api: Api;
  let memberApi: Api;
  let ws: { id: string };
  let base: string;
  let catalog: ModuleManifest[];
  let stripeId = '';
  const install = async (id: string) => {
    const manifest = catalog.find((candidate) => candidate.id === id);
    const applied = await api(`${base}/modules/apply`, { body: { manifest } });
    expect(applied.status).toBe(200);
  };

  beforeAll(async () => {
    server = await createTestServer({ moduleFetch: providerFetch });
    const owner = await signUp(server, 'owner@modules.test');
    api = client(server, { cookie: owner.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme-ext');
    base = `/api/workspaces/${ws.id}`;
    // A member, invited through Better Auth's organization plugin.
    const member = await signUp(server, 'member@modules.test');
    const invited = await api('/api/auth/organization/invite-member', {
      body: { email: member.email, role: 'member', organizationId: ws.id },
      headers: { origin: 'http://localhost:5173' },
    });
    const invitation = invited.json as { id: string };
    await client(server, { cookie: member.cookie })('/api/auth/organization/accept-invitation', {
      body: { invitationId: invitation.id },
      headers: { origin: 'http://localhost:5173' },
    });
    memberApi = client(server, { cookie: member.cookie });
  });
  afterAll(() => server.close());

  it('serves the catalog, installs Stripe and tests its connection right away', async () => {
    const listed = await memberApi(`${base}/modules/catalog`);
    expect(listed.status).toBe(200);
    catalog = listed.json as ModuleManifest[];
    expect(catalog.map((m) => m.id).sort()).toEqual([crmIds.module, emailIds.module, stripeIds.module].sort());
    expect(catalog.find((m) => m.id === stripeIds.module)?.actions.map((a) => a.name)).toEqual([
      'create_invoice_payment_link',
      'handle_checkout_event',
    ]);
    expect(catalog.find((m) => m.id === emailIds.module)?.events.map((e) => e.name)).toContain('email.delivered');

    // Stripe is opt-in: nothing to connect until it is installed.
    expect((await api(`${base}/connections`)).json).toEqual({ providers: [], connections: [] });
    const connect = (values: Record<string, string>, as = api, module: string = stripeIds.module) =>
      as(`${base}/connections`, { body: { module, values } });
    expect((await connect({ secret_key: 'sk_test_goodkey12345' })).status).toBe(404);
    await install(stripeIds.module);
    expect((await api(`${base}/connections?module=${stripeIds.module}`)).json).toEqual({
      providers: [
        {
          moduleId: stripeIds.module,
          providerId: stripeIds.connections.default,
          kind: 'api_key',
          label: 'Stripe',
          visibility: 'workspace',
          available: true,
        },
      ],
      connections: [],
    });

    // A refused key is stored, and says why.
    const bad = await connect({ secret_key: 'sk_test_wrongkey12345' });
    expect(bad.status).toBe(201);
    expect(bad.json).toMatchObject({ status: 'auth_failed', lastError: 'Stripe rejected the secret key' });
    stripeId = (bad.json as { id: string }).id;

    const saved = await api(`${base}/connections/${stripeId}`, {
      method: 'PATCH',
      body: { values: { secret_key: 'sk_test_goodkey12345', webhook_secret: 'whsec_testing_secret' } },
    });
    expect(saved.status).toBe(200);
    const connection = saved.json as Record<string, unknown>;
    expect(connection).toMatchObject({
      moduleId: stripeIds.module,
      visibility: 'workspace',
      status: 'connected',
      lastError: null,
      hints: { secret_key: 'sk_t…2345', webhook_secret: 'whse…cret' },
    });
    expect(String(connection.webhookUrl)).toMatch(/^http:\/\/localhost:3000\/api\/webhooks\/[0-9a-f]{32}$/);
    expect(JSON.stringify(connection)).not.toContain('goodkey');
    // Members see the workspace's connection but do not change it.
    expect(((await memberApi(`${base}/connections`)).json as { connections: unknown[] }).connections).toHaveLength(1);
    expect((await connect({ secret_key: 'x' }, memberApi)).status).toBe(403);
    expect(
      (await memberApi(`${base}/connections/${stripeId}`, { method: 'PATCH', body: { values: { secret_key: 'x' } } }))
        .status,
    ).toBe(403);
    expect((await memberApi(`${base}/connections/${stripeId}`, { method: 'DELETE' })).status).toBe(403);
    // Modules that are not installed, a second workspace key and unknown fields are refused.
    expect((await connect({ api_key: 'x' }, api, emailIds.module)).status).toBe(404);
    expect((await connect({ secret_key: 'sk_again' })).status).toBe(409);
    expect(
      (await api(`${base}/connections/${stripeId}`, { method: 'PATCH', body: { values: { nope: 'x' } } })).status,
    ).toBe(400);
  });

  it('tests, runs actions ad hoc and lists events; webhooks need a valid signature', async () => {
    const stripe = (await api(`${base}/connections/${stripeId}`)).json as { webhookUrl: string };
    const tested = await api(`${base}/connections/${stripeId}/test`, { body: {} });
    expect(tested.json).toMatchObject({ ok: true, message: 'Connected in test mode' });
    // Testing the workspace's connection is for admins.
    expect((await memberApi(`${base}/connections/${stripeId}/test`, { body: {} })).status).toBe(403);

    // Each action has a route of its own: the body is its input, and what the module's code says comes back.
    const action = `${base}/modules/${stripeIds.module}/actions/create_invoice_payment_link`;
    const ran = await memberApi(action, { body: { invoice_id: 'inv_1' } });
    // This workspace has no Invoicing, which the module says plainly.
    expect(ran.status).toBe(502);
    expect(JSON.stringify(ran.json)).toContain('Invoicing is not installed in this workspace');
    expect((await api(action, { body: {} })).status).toBe(400);
    expect((await api(`${base}/modules/${stripeIds.module}/actions/nope`, { body: {} })).status).toBe(404);

    const path = new URL(stripe.webhookUrl).pathname;
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', receipt_email: 'ada@acme.test' } },
    });
    const post = (signature: string | null, at = path) =>
      server.app.request(at, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
        body,
      });
    expect((await post(null)).status).toBe(400);
    expect((await post(stripeSignature('whsec_other', body))).status).toBe(400);
    expect((await post(stripeSignature('whsec_testing_secret', body), `/api/webhooks/${'0'.repeat(32)}`)).status).toBe(
      404,
    );
    const accepted = await post(stripeSignature('whsec_testing_secret', body));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ received: 1, duplicates: 0 });
    const replay = await post(stripeSignature('whsec_testing_secret', body));
    expect(await replay.json()).toEqual({ received: 0, duplicates: 1 });

    const events = (await memberApi(`${base}/modules/${stripeIds.module}/events`)).json as {
      items: { type: string; externalId: string; payload: { id: string } }[];
    };
    expect(events.items).toHaveLength(1);
    expect(events.items[0]).toMatchObject({
      type: 'payment_intent.succeeded',
      externalId: 'evt_1',
      payload: { id: 'evt_1' },
    });
  });

  it('starts workflows from module events and calls actions from steps', async () => {
    const stripe = (await api(`${base}/connections/${stripeId}`)).json as { webhookUrl: string };
    await install(emailIds.module);
    // Actions refuse to run until the module is connected.
    const unconnected = await api(`${base}/modules/${emailIds.module}/actions/send_email`, {
      body: { from: 'a', to: 'b', subject: 'c' },
    });
    expect(unconnected.status).toBe(400);
    expect((unconnected.json as { error: { message: string } }).error.message).toMatch(/not connected/);
    await api(`${base}/connections`, { body: { module: emailIds.module, values: { api_key: 're_key_1234567890' } } });
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Payment received',
        trigger: { kind: 'module_event', moduleId: stripeIds.module, types: ['payment_intent.succeeded'] },
        steps: [
          {
            id: 'chore',
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: {
              object: 'chore',
              values: { title: 'Thank {{event.payload.data.object.receipt_email}} for {{event.type}}' },
            },
          },
          {
            id: 'mail',
            kind: 'action',
            actionId: emailIds.actions.send_email,
            input: {
              from: 'Acme <billing@acme.test>',
              to: '{{event.payload.data.object.receipt_email}}',
              subject: 'Thanks',
              text: 'Paid: {{event.payload.data.object.id}}',
            },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const workflow = created.json as { id: string };
    expect(await server.workflows.runOnce(ws.id)).toBe(0);

    const deliver = (payload: unknown) => {
      const body = JSON.stringify(payload);

      return server.app.request(new URL(stripe.webhookUrl).pathname, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': stripeSignature('whsec_testing_secret', body),
        },
        body,
      });
    };
    const delivered = await deliver({
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_2', receipt_email: 'grace@acme.test' } },
    });
    expect(delivered.status).toBe(200);
    // Other event types do not start it.
    await deliver({ id: 'evt_3', type: 'charge.refunded', data: { object: { id: 'ch_9' } } });
    expect(await server.workflows.runOnce(ws.id)).toBe(1);
    expect(await server.workflows.runOnce(ws.id)).toBe(0);

    const runs = (await api(`${base}/workflows/${workflow.id}/runs`)).json as {
      items: {
        status: string;
        trigger: Record<string, unknown>;
        steps: { id: string; status: string; output: unknown }[];
      }[];
    };
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'module_event', eventType: 'payment_intent.succeeded', moduleId: stripeIds.module },
    });
    expect(runs.items[0]?.steps.map((s) => [s.id, s.status])).toEqual([
      ['chore', 'succeeded'],
      ['mail', 'succeeded'],
    ]);
    expect(runs.items[0]?.steps[1]?.output).toEqual({ id: 'em_1' });
    const tasks = (
      (
        await api(`${base}/records/chore/list`, {
          body: { filter: { field: 'title', op: 'contains', value: 'grace@acme.test' } },
        })
      ).json as { items: { title: string }[] }
    ).items;
    expect(tasks.map((t) => t.title)).toEqual(['Thank grace@acme.test for payment_intent.succeeded']);
    const sent = providerFetch.mock.calls.find(([url]) => url === 'https://api.resend.com/emails');
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ to: ['grace@acme.test'], text: 'Paid: pi_2' });
    // Uninstalling the mailer leaves the workflow, which now fails validation when saved again.
    expect((await api(`${base}/modules/${emailIds.module}?allowDestructive=true`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await api(`${base}/workflows/${workflow.id}`, { method: 'PATCH', body: { name: 'Renamed' } })).status).toBe(
      400,
    );
  });
});

/** A module whose one action tells every member something, through `ctx.notify`. */
const pinger = defineModuleServer(
  defineModule({
    id: '01a1751f-5f04-770f-8546-817f0bc66573',
    version: '0.1.0',
    actions: [
      {
        id: '01a1751f-5f04-770f-8546-7d96bb3708da',
        name: 'ping_everyone',
        label: 'Ping everyone',
        input: [{ name: 'title', label: 'Title', required: true }],
        external: false,
      },
    ],
  }),
  {
    actions: [
      defineActionHandler({
        id: '01a1751f-5f04-770f-8546-7d96bb3708da',
        input: z.object({ title: z.string().min(1) }),
        run: (input, ctx) =>
          ctx.notify({
            title: input.title,
            body: `Sent by ${ctx.actor.id}`,
            kind: 'pinger.ping',
            key: 'ping',
            to: { all: true },
          }),
      }),
    ],
  },
);

describe('module actions notify people', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let ownerId: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [crm, pinger], pgliteDataDir: 'memory://' },
    );
    const owner = await signUp(server, 'owner@pinger.test');
    ownerId = owner.userId;
    api = client(server, { cookie: owner.cookie });
    const ws = await createWorkspace(api, 'Pings', 'pings');
    base = `/api/workspaces/${ws.id}`;
  });
  afterAll(() => server.close());

  it('reaches every member as the module action, replacing the unread one with the same key', async () => {
    expect((await api(`${base}/modules/apply`, { body: { manifest: pinger.manifest } })).status).toBe(200);
    const ran = await api(`${base}/modules/01a1751f-5f04-770f-8546-817f0bc66573/actions/ping_everyone`, {
      body: { title: 'Pinged' },
    });
    expect(ran.status, JSON.stringify(ran.json)).toBe(200);
    // The route is the action's name, not the end of its id.
    expect(
      (await api(`${base}/modules/01a1751f-5f04-770f-8546-817f0bc66573/actions/ping`, { body: { title: 'Pinged' } }))
        .status,
    ).toBe(404);
    expect(ran.json).toEqual({ recipients: 1, created: 1, updated: 0 });
    const inbox = (await api(`${base}/notifications`)).json as { items: unknown[] };
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      title: 'Pinged',
      body: 'Sent by 01a1751f-5f04-770f-8546-817f0bc66573',
      kind: 'pinger.ping',
      key: 'ping',
      level: 'info',
      // The module, for the person who ran its action.
      actor: { kind: 'module', id: '01a1751f-5f04-770f-8546-817f0bc66573', onBehalfOf: { kind: 'user', id: ownerId } },
      readAt: null,
    });
    expect(
      (
        await api(`${base}/modules/01a1751f-5f04-770f-8546-817f0bc66573/actions/ping_everyone`, {
          body: { title: 'Pinged again' },
        })
      ).json,
    ).toEqual({
      recipients: 1,
      created: 0,
      updated: 1,
    });
    expect(
      ((await api(`${base}/notifications`)).json as { items: { title: string }[] }).items.map((i) => i.title),
    ).toEqual(['Pinged again']);
  });

  it('is a step workflows may run, unlike the inbox actions', () => {
    expect(workflowCanRun(notificationActions.send)).toBe(true);
    expect(workflowCanRun(notificationActions.list)).toBe(false);
    expect(workflowCanRun(notificationActions.markAllRead)).toBe(false);
  });
});
