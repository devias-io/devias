import { createHmac } from 'node:crypto';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { invoicing } from '@devias/mod-invoicing/server';
import { paymentStripe } from '@devias/mod-payment-stripe/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, signUp } from './helpers';

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
describe('Stripe payments with Invoicing', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let webhookPath: string;

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
        pgliteDataDir: 'memory://',
      },
    );
    api = client(server, { cookie: (await signUp(server, 'owner@pay.test')).cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme', 'acme-pay')).id}`;
    const catalog = (await api(`${base}/modules/catalog`)).json as { id: string }[];

    for (const id of ['invoicing', 'payment-stripe']) {
      const manifest = catalog.find((entry) => entry.id === id);
      expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
    }

    const connection = await api(`${base}/connections`, {
      body: { module: 'payment-stripe', values: { secret_key: 'sk_test_invoices', webhook_secret: 'whsec_invoices' } },
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
      api(`${base}/modules/payment-stripe/actions/create_invoice_payment_link`, { body: { invoice_id: created.id } });
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
    // Stripe retries deliveries: the same event is stored once and queues no second recording.
    expect(await (await deliver()).json()).toEqual({ received: 0, duplicates: 1 });
    expect(await server.jobs.runOnce()).toBe(1);
    expect(await server.jobs.runOnce()).toBe(0);

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
        created_by: 'module:payment-stripe',
      }),
    ]);
    expect(await invoice(created.id)).toMatchObject({ status: 'paid', payment_url: null });
    // The link is switched off, so it cannot take the money twice.
    expect(stripeFetch).toHaveBeenCalledWith('https://api.stripe.com/v1/payment_links/plink_1', expect.anything());

    const notifications = (await api(`${base}/notifications`)).json as { items: { title: string }[] };
    expect(notifications.items.map((item) => item.title)).toContain('Invoice INV-1 was paid online');
  });
});
