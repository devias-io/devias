import { createHmac } from 'node:crypto';
import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import type { ChatEvent } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as invoicingIds } from '@devias/mod-invoicing/manifest';
import invoicing from '@devias/mod-invoicing/server';
import { ids as stripeIds } from '@devias/mod-payment-stripe/manifest';
import paymentStripe from '@devias/mod-payment-stripe/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents, type Session, signUp } from './helpers';

/** Answers like Stripe would: the key check, prices, payment links and switching a link off. */
const stripeFetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  if (url.endsWith('/v1/balance')) {
    return json({ livemode: false });
  }

  if (url.endsWith('/v1/prices')) {
    return json({ id: 'price_1' });
  }

  if (url.endsWith('/v1/payment_links')) {
    return json({ id: 'plink_1', url: 'https://buy.stripe.com/test_1' });
  }

  if (url.endsWith('/v1/payment_links/plink_1')) {
    return json({ id: 'plink_1', active: false });
  }

  return new Response('{}', { status: 500 });
});

const signed = (body: string) => {
  const t = Math.floor(Date.now() / 1000);

  return `t=${t},v1=${createHmac('sha256', 'whsec_invoices').update(`${t}.${body}`).digest('hex')}`;
};

/** Stripe takes Invoicing's invoices online: a link on the invoice, then the payment recorded once Stripe says so. */
describe('Payments via Stripe with Invoicing', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let webhookPath: string;
  let workspaceId: string;
  let owner: Session;
  const model = createFakeModelClient([], { delayMs: 0 });

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      {
        modules: [crm, invoicing, paymentStripe],
        builtin: [crmManifest],
        moduleFetch: stripeFetch,
        modelClient: model,
        pgliteDataDir: 'memory://',
      },
    );
    owner = await signUp(server, 'owner@pay.test');
    api = client(server, { cookie: owner.cookie });
    workspaceId = (await createWorkspace(api, 'Acme', 'acme-pay')).id;
    base = `/api/workspaces/${workspaceId}`;
    const catalog = (await api(`${base}/modules/catalog`)).json as { id: string }[];

    for (const id of [invoicingIds.module, stripeIds.module]) {
      const manifest = catalog.find((entry) => entry.id === id);
      expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
    }

    const connection = await api(`${base}/connections`, {
      body: { module: stripeIds.module, values: { secret_key: 'sk_test_invoices', webhook_secret: 'whsec_invoices' } },
    });
    expect(connection.json).toMatchObject({ status: 'connected' });
    webhookPath = new URL((connection.json as { webhookUrl: string }).webhookUrl).pathname;
  });
  afterAll(() => server.close());

  const invoice = async (id: string) => (await api(`${base}/records/invoice/${id}`)).json as Record<string, unknown>;

  it('puts a payment link on a sent invoice and records the payment Stripe reports, once', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Initech' } })).json as { id: string };
    const created = (
      await api(`${base}/records/invoice`, {
        body: { number: 'INV-1', company: company.id, currency: 'EUR' },
      })
    ).json as { id: string };
    await api(`${base}/records/invoice_line`, {
      body: { invoice: created.id, description: 'Boiler repair', quantity: 2, unit_price: 60.25 },
    });
    const link = () =>
      api(`${base}/modules/${stripeIds.module}/actions/create_invoice_payment_link`, {
        body: { invoice_id: created.id },
      });
    // A draft is not sent yet, so there is nothing to pay.
    expect((await link()).status).toBe(502);
    await api(`${base}/records/invoice/${created.id}`, { method: 'PATCH', body: { status: 'sent' } });

    const made = await link();
    expect(made.status).toBe(200);
    expect(made.json).toEqual({
      invoice_id: created.id,
      url: 'https://buy.stripe.com/test_1',
      amount: 120.5,
      currency: 'EUR',
      reused: false,
    });
    expect(await invoice(created.id)).toMatchObject({ payment_url: 'https://buy.stripe.com/test_1' });
    const price = stripeFetch.mock.calls.find(([url]) => url.endsWith('/v1/prices')) as [string, RequestInit];
    expect(new URLSearchParams(String(price[1].body)).get('unit_amount')).toBe('12050');

    // The customer pays through the link; Stripe tells the webhook.
    const body = JSON.stringify({
      id: 'evt_paid',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'paid',
          amount_total: 12_050,
          currency: 'eur',
          payment_intent: 'pi_1',
          payment_link: 'plink_1',
          metadata: { devias_invoice: created.id },
        },
      },
    });
    const deliver = () =>
      server.app.request(webhookPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signed(body) },
        body,
      });
    expect(await (await deliver()).json()).toEqual({ received: 1, duplicates: 0 });
    // Stripe retries deliveries: the same event is stored once and starts no second run.
    expect(await (await deliver()).json()).toEqual({ received: 0, duplicates: 1 });
    expect(await server.workflows.runOnce(workspaceId)).toBe(1);
    expect(await server.workflows.runOnce(workspaceId)).toBe(0);

    const payments = (
      await api(`${base}/records/payment/list`, {
        body: { filter: { field: 'invoice', op: 'eq', value: created.id } },
      })
    ).json as { items: Record<string, unknown>[] };
    expect(payments.items).toEqual([
      expect.objectContaining({
        amount: 120.5,
        method: 'card',
        reference: 'pi_1',
        created_by: `module:${stripeIds.module}`,
      }),
    ]);
    expect(await invoice(created.id)).toMatchObject({ status: 'paid', payment_url: null });
    // The link is switched off, so it cannot take the money twice.
    expect(stripeFetch).toHaveBeenCalledWith('https://api.stripe.com/v1/payment_links/plink_1', expect.anything());

    const notifications = (await api(`${base}/notifications`)).json as { items: { title: string }[] };
    expect(notifications.items.map((item) => item.title)).toContain('Invoice INV-1 was paid online');
  });
  /** Stripe's word for a paid Checkout session started by an invoice's link. */
  const sessionEvent = (
    event: string,
    session: string,
    invoiceId: string,
    extra: { type?: string; payment_status?: string; currency?: string } = {},
  ) => ({
    id: event,
    type: extra.type ?? 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: session,
        payment_status: extra.payment_status ?? 'paid',
        amount_total: 5_000,
        currency: extra.currency ?? 'eur',
        payment_intent: `pi_${session}`,
        payment_link: null,
        metadata: { devias_invoice: invoiceId },
      },
    },
  });
  const send = async (event: unknown) => {
    const body = JSON.stringify(event);

    return server.app.request(webhookPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signed(body) },
      body,
    });
  };
  const sentInvoice = async (number: string, options: { currency?: string; draft?: boolean } = {}) => {
    const company = (await api(`${base}/records/company`, { body: { name: `${number} Ltd` } })).json as { id: string };
    const made = (
      await api(`${base}/records/invoice`, {
        body: { number, company: company.id, currency: options.currency ?? 'EUR' },
      })
    ).json as { id: string };
    await api(`${base}/records/invoice_line`, {
      body: { invoice: made.id, description: 'Work', quantity: 1, unit_price: 50 },
    });

    if (!options.draft) {
      await api(`${base}/records/invoice/${made.id}`, { method: 'PATCH', body: { status: 'sent' } });
    }

    return made.id;
  };
  const paymentsOf = async (invoiceId: string) =>
    (
      (
        await api(`${base}/records/payment/list`, {
          body: { filter: { field: 'invoice', op: 'eq', value: invoiceId } },
        })
      ).json as { items: Record<string, unknown>[] }
    ).items;
  const recordingWorkflow = async () => {
    const found = ((await api(`${base}/workflows`)).json as { id: string; moduleId?: string }[]).find(
      (workflow) => workflow.moduleId === stripeIds.module,
    );
    expect(found).toBeDefined();

    return (found as { id: string }).id;
  };
  const runsOf = async () =>
    (
      (await api(`${base}/workflows/${await recordingWorkflow()}/runs`)).json as {
        items: {
          id: string;
          status: string;
          error?: string;
          trigger: { retryOf?: string };
          steps: { output?: unknown }[];
        }[];
      }
    ).items;

  it('comes with a workflow that records payments, which the workspace can turn off but not rewrite', async () => {
    const id = await recordingWorkflow();
    const workflow = (await api(`${base}/workflows/${id}`)).json as { title: string; enabled: boolean };
    expect(workflow).toMatchObject({ title: 'Apply Stripe checkout payments to invoices', enabled: true });
    const renamed = await api(`${base}/workflows/${id}`, { method: 'PATCH', body: { title: 'Mine' } });
    expect(renamed.status).toBe(409);
    expect((await api(`${base}/workflows/${id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('records a session once however many events report it, and leaves unpaid ones alone', async () => {
    const invoiceId = await sentInvoice('INV-2');
    // Still clearing (a bank debit): nothing to record yet.
    await send(sessionEvent('evt_2a', 'cs_2', invoiceId, { payment_status: 'unpaid' }));
    await server.workflows.runOnce(workspaceId);
    expect(await paymentsOf(invoiceId)).toEqual([]);

    // Paid; then the slower method also reports the same session. Two events, one payment.
    await send(sessionEvent('evt_2b', 'cs_2', invoiceId));
    await send(sessionEvent('evt_2c', 'cs_2', invoiceId, { type: 'checkout.session.async_payment_succeeded' }));
    await server.workflows.runOnce(workspaceId);
    expect(await paymentsOf(invoiceId)).toEqual([expect.objectContaining({ amount: 50, reference: 'pi_cs_2' })]);
    const outputs = (await runsOf()).slice(0, 3).map((run) => run.steps[0]?.output);
    expect(outputs).toEqual([
      expect.objectContaining({ recorded: false, reason: 'Already recorded' }),
      expect.objectContaining({ recorded: true, invoice_id: invoiceId }),
      expect.objectContaining({ recorded: false }),
    ]);
  });

  it('tells owners once when money arrives for an invoice that owes nothing', async () => {
    const invoiceId = await sentInvoice('INV-3', { draft: true });
    await send(sessionEvent('evt_3a', 'cs_3', invoiceId));
    await send(sessionEvent('evt_3b', 'cs_3', invoiceId, { type: 'checkout.session.async_payment_succeeded' }));
    await server.workflows.runOnce(workspaceId);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    const titles = ((await api(`${base}/notifications`)).json as { items: { title: string }[] }).items.map(
      (item) => item.title,
    );
    expect(titles.filter((title) => title === 'Invoice INV-3 was paid online, but nothing was owed')).toHaveLength(1);
  });

  it('fails the run when Stripe was paid in another currency, and a retry is a run of its own', async () => {
    const invoiceId = await sentInvoice('INV-4');
    await send(sessionEvent('evt_4a', 'cs_4', invoiceId, { currency: 'usd' }));
    await server.workflows.runOnce(workspaceId);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    const [failed] = await runsOf();
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('USD') });
    expect(failed?.error).toContain('EUR');

    const retried = await api(`${base}/workflows/${await recordingWorkflow()}/runs/${failed?.id}/retry`, { body: {} });
    expect(retried.status).toBe(201);
    expect(retried.json).toMatchObject({ status: 'failed', trigger: { retryOf: failed?.id } });
  });
  it('acceptance: "Why was the Stripe payment not recorded?" finds the failed run, explains it and runs it again after approval', async () => {
    const invoiceId = await sentInvoice('INV-5');
    await send(sessionEvent('evt_5a', 'cs_5', invoiceId, { currency: 'usd' }));
    await server.workflows.runOnce(workspaceId);
    const workflowId = await recordingWorkflow();
    const [failed] = await runsOf();
    expect(failed).toMatchObject({ status: 'failed' });
    // The owner puts the invoice in the currency the customer paid in; now it can be recorded.
    await api(`${base}/records/invoice/${invoiceId}`, { method: 'PATCH', body: { currency: 'USD' } });

    model.push(
      { content: [toolUse('list_workflow_runs', { workflow: workflowId, limit: 3 }, 'tu_runs')] },
      { content: [toolUse('retry_workflow_run', { id: workflowId, runId: failed?.id }, 'tu_retry')] },
      { content: [text('Stripe was paid in USD but the invoice was in EUR. I ran it again.')] },
    );
    const ai = `${base}/ai`;
    const conversation = (await api(`${ai}/conversations`, { body: {} })).json as { id: string };
    const asked = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ content: "Why wasn't the Stripe payment for INV-5 recorded?" }),
      }),
    );
    // Listing runs without asking; the failed one says what went wrong.
    const listed = asked.find(
      (event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result',
    );
    expect(listed).toMatchObject({
      status: 'executed',
      result: {
        runs: expect.arrayContaining([
          expect.objectContaining({ id: failed?.id, status: 'failed', error: expect.stringContaining('USD') }),
        ]),
      },
    });
    // Running it again asks first.
    const pause = asked.find((event) => event.type === 'paused');
    const retry = pause?.type === 'paused' ? pause.pending[0] : undefined;
    expect(retry).toMatchObject({ name: 'retry_workflow_run', requiresApproval: true });
    const resolved = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/tool-calls/${retry?.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(resolved.find((event) => event.type === 'tool_result')).toMatchObject({
      status: 'executed',
      result: { status: 'succeeded', trigger: { retryOf: failed?.id } },
    });
    expect(resolved.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    expect(await paymentsOf(invoiceId)).toEqual([expect.objectContaining({ amount: 50, reference: 'pi_cs_5' })]);
  });
});
