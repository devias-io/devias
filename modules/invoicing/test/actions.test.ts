import { evaluateFilter, type RecordData } from '@devias/core';
import type { ActionContext, ScopedEngine } from '@devias/server';
import { describe, expect, it } from 'vitest';
import { addPayment } from '../src/server/actions/add-payment';
import { recalculateInvoice } from '../src/server/actions/recalculate-invoice';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const now = '2026-10-08T10:00:00.000Z';

/** An in-memory stand-in for the caller's engine: only `records` is used by the actions. */
const engineWith = (seed: Record<string, RecordData[]>) => {
  const records: Record<string, RecordData[]> = Object.fromEntries(
    Object.entries(seed).map(([object, list]) => [object, list.map((r) => ({ ...r }))]),
  );
  let counter = 1;
  const find = (object: string, id: string) => {
    const record = (records[object] ?? []).find((r) => r.id === id);

    if (!record) {
      throw new Error(`${object} ${id} not found`);
    }

    return record;
  };
  const recordsApi: ScopedEngine['records'] = {
    list: async (query) => {
      const items = (records[query.object] ?? []).filter((r) => evaluateFilter(r, query.filter));

      return { items, nextCursor: null, totalCount: items.length };
    },
    get: async (object, id) => find(object, id),
    create: async (object, data) => {
      const record = { id: `${object}_${counter++}`, created_at: now, updated_at: now, ...data };
      records[object] = [...(records[object] ?? []), record];

      return record;
    },
    update: async (object, id, patch) => {
      const record = find(object, id);
      Object.assign(record, patch, { updated_at: now });

      return record;
    },
    delete: async () => {},
    upsert: async () => {
      throw new Error('invoicing does not upsert');
    },
    aggregate: async () => {
      throw new Error('invoicing does not aggregate');
    },
    lookup: async () => [],
  };
  const engine = {
    workspaceId: 'ws_test',
    actor: { kind: 'function', id: 'invoicing.test' },
    records: recordsApi,
    metadata: { getSchema: async () => ({}) },
  } as unknown as ScopedEngine;

  return { engine, records };
};

const contextOf = (engine: ScopedEngine): ActionContext => ({
  workspaceId: 'ws_test',
  variables: {},
  connection: async () => {
    throw new Error('invoicing has no connections');
  },
  reportAuthFailure: () => {},
  kv: { get: async () => undefined, set: async () => {}, delete: async () => {} },
  jobs: { enqueue: async () => ({ id: 'job_test', status: 'pending' }) },
  fetch: async () => new Response('{}'),
  logger: noopLogger,
  actor: { kind: 'function', id: 'invoicing.test' },
  engine,
  notify: async () => ({ recipients: 0, created: 0, updated: 0 }),
});

const invoice = (overrides: Partial<RecordData> = {}): RecordData => ({
  id: 'inv1',
  created_at: now,
  updated_at: now,
  number: 'INV-1',
  status: 'sent',
  tax_rate: 21,
  subtotal: null,
  tax: null,
  total: null,
  ...overrides,
});

const lines: RecordData[] = [
  { id: 'l1', created_at: now, updated_at: now, invoice: 'inv1', description: 'Design', quantity: 2, unit_price: 100 },
  { id: 'l2', created_at: now, updated_at: now, invoice: 'inv1', description: 'Hosting', quantity: 1, unit_price: 50 },
  {
    id: 'l3',
    created_at: now,
    updated_at: now,
    invoice: 'other',
    description: 'Elsewhere',
    quantity: 9,
    unit_price: 9,
  },
];

describe('recalculate_invoice', () => {
  it('stores what the invoice’s own lines add up to', async () => {
    const { engine, records } = engineWith({ invoice: [invoice()], invoice_line: lines });
    const result = await recalculateInvoice.run(
      recalculateInvoice.input.parse({ invoice_id: 'inv1' }),
      contextOf(engine),
    );
    expect(result).toEqual({ id: 'inv1', subtotal: 250, discount_amount: 0, tax: 52.5, total: 302.5 });
    expect(records.invoice?.[0]).toMatchObject({ subtotal: 250, tax: 52.5, total: 302.5 });
  });
});

describe('add_payment', () => {
  it('settles the balance by default and marks the invoice paid', async () => {
    const { engine, records } = engineWith({
      invoice: [invoice()],
      invoice_line: lines,
      payment: [{ id: 'p0', created_at: now, updated_at: now, invoice: 'inv1', amount: 2.5 }],
    });
    const result = await addPayment.run(
      addPayment.input.parse({ invoice_id: 'inv1', amount: '', paid_on: '2026-10-08', method: 'card' }),
      contextOf(engine),
    );
    expect(result).toEqual({ payment_id: 'payment_1', invoice_id: 'inv1', paid: 302.5, balance: 0, status: 'paid' });
    expect(records.payment?.[1]).toMatchObject({ invoice: 'inv1', amount: 300, paid_on: '2026-10-08', method: 'card' });
    expect(records.invoice?.[0]).toMatchObject({ status: 'paid', subtotal: 250, tax: 52.5, total: 302.5 });
  });

  it('keeps a partly paid invoice sent and reports what is still owed', async () => {
    const { engine, records } = engineWith({ invoice: [invoice()], invoice_line: lines });
    const result = await addPayment.run(
      addPayment.input.parse({ invoice_id: 'inv1', amount: '100', reference: 'TRX-9' }),
      contextOf(engine),
    );
    expect(result).toMatchObject({ paid: 100, balance: 202.5, status: 'sent' });
    expect(records.payment?.[0]).toMatchObject({ amount: 100, method: 'bank_transfer', reference: 'TRX-9' });
    expect(records.invoice?.[0]?.status).toBe('sent');
  });

  it('refuses drafts, void invoices and settled ones', async () => {
    const draft = engineWith({ invoice: [invoice({ status: 'draft' })], invoice_line: lines });
    await expect(
      addPayment.run(addPayment.input.parse({ invoice_id: 'inv1' }), contextOf(draft.engine)),
    ).rejects.toThrow(/still a draft/);
    const voided = engineWith({ invoice: [invoice({ status: 'void' })], invoice_line: lines });
    await expect(
      addPayment.run(addPayment.input.parse({ invoice_id: 'inv1' }), contextOf(voided.engine)),
    ).rejects.toThrow(/is void/);
    const settled = engineWith({
      invoice: [invoice()],
      invoice_line: lines,
      payment: [{ id: 'p0', created_at: now, updated_at: now, invoice: 'inv1', amount: 302.5 }],
    });
    await expect(
      addPayment.run(addPayment.input.parse({ invoice_id: 'inv1' }), contextOf(settled.engine)),
    ).rejects.toThrow(/nothing left to pay/);
    expect(settled.records.payment).toHaveLength(1);
  });
});
