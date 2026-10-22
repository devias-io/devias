import type { RecordData } from '@devias/core';
import { describe, expect, it, vi } from 'vitest';
import { createInvoicePaymentLink } from '../../src/server/actions/create-invoice-payment-link';
import { contextWith, fakeFetch } from '../helpers';

/** An invoice of 100.50 EUR (one line) with 20 already paid, behind an engine and a store that remember writes. */
const setup = (invoice: Partial<RecordData> = {}) => {
  const record: RecordData = {
    id: 'inv_1',
    number: 'INV-7',
    status: 'sent',
    currency: 'EUR',
    tax_rate: 0,
    payment_url: null,
    created_at: '',
    updated_at: '',
    ...invoice,
  };
  const lines = [{ id: 'l1', quantity: 1, unit_price: 100.5 }];
  const payments = [{ id: 'p1', amount: 20 }];
  const engine = {
    records: {
      get: vi.fn(async () => record),
      list: vi.fn(async ({ object }: { object: string }) => ({
        items: object === 'invoice_line' ? lines : payments,
        nextCursor: null,
      })),
      update: vi.fn(async (_object: string, _id: string, patch: Record<string, unknown>) => {
        Object.assign(record, patch);

        return record;
      }),
    },
  };
  let created = 0;
  const fetch = fakeFetch((url) => {
    if (url.endsWith('/prices')) {
      return { body: { id: `price_${++created}` } };
    }

    if (url.endsWith('/payment_links')) {
      return { body: { id: `plink_${created}`, url: `https://buy.stripe.com/${created}` } };
    }

    return { body: { id: 'plink_1', active: false } };
  });
  const store = new Map<string, unknown>();
  const ctx = {
    ...contextWith({ secret_key: 'sk_test' }, fetch),
    engine: engine as never,
    kv: {
      get: async <T>(key: string) => store.get(key) as T | undefined,
      set: async (key: string, value: unknown) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
    },
  };
  const run = () => createInvoicePaymentLink.run({ invoice_id: 'inv_1' }, ctx);
  const form = (call: number) => new URLSearchParams(String((fetch.mock.calls[call] as [string, RequestInit])[1].body));

  return { record, payments, fetch, run, form };
};

describe('createInvoicePaymentLink', () => {
  it('makes a link for the balance in cents, stores it on the invoice and gives it again for the same amount', async () => {
    const { record, fetch, run, form } = setup();
    expect(await run()).toEqual({
      invoice_id: 'inv_1',
      url: 'https://buy.stripe.com/1',
      amount: 80.5,
      currency: 'EUR',
      reused: false,
    });
    expect(form(0).get('currency')).toBe('eur');
    expect(form(0).get('unit_amount')).toBe('8050');
    expect(form(0).get('product_data[name]')).toBe('Invoice INV-7');
    expect(form(1).get('line_items[0][price]')).toBe('price_1');
    expect(form(1).get('metadata[devias_invoice]')).toBe('inv_1');
    expect(record.payment_url).toBe('https://buy.stripe.com/1');

    expect(await run()).toMatchObject({ url: 'https://buy.stripe.com/1', reused: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('replaces the link when the balance changed, switching the old one off', async () => {
    const { record, payments, fetch, run } = setup();
    await run();
    payments.push({ id: 'p2', amount: 30 });
    expect(await run()).toMatchObject({ url: 'https://buy.stripe.com/2', amount: 50.5, reused: false });
    expect(record.payment_url).toBe('https://buy.stripe.com/2');
    const [url, init] = fetch.mock.calls[4] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/payment_links/plink_1');
    expect(String(init.body)).toBe('active=false');
  });

  it('refuses invoices with nothing to pay', async () => {
    await expect(setup({ status: 'draft' }).run()).rejects.toThrow('Invoice INV-7 is still a draft; send it first');
    await expect(setup({ status: 'paid' }).run()).rejects.toThrow('Invoice INV-7 is paid: nothing to pay');
  });
});
