import type { RecordData } from '@devias/core';
import { localDate, round2 } from '@devias/core';
import type { ScopedEngine } from '@devias/server';
import { balanceOf } from '../lib/totals';
import type { PaymentMethod } from '../manifest';
import { loadInvoiceState } from './state';

/**
 * Taking payments against invoices, shared by the `add_payment` action and by payment provider modules (Stripe
 * records what its customers paid online), each through its own engine and so as itself.
 */

/** An invoice by id; says so plainly when this workspace has no invoices at all (Invoicing is not installed). */
export const openInvoice = async (engine: ScopedEngine, invoiceId: string): Promise<RecordData> => {
  try {
    return await engine.records.get('invoice', invoiceId);
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };

    if (code === 'NOT_FOUND' && typeof message === 'string' && message.startsWith('Object "invoice"')) {
      throw new Error('Invoicing is not installed in this workspace');
    }

    throw error;
  }
};

/** How an invoice is named in messages: its number, or its id before it has one. */
export const invoiceLabel = (invoice: RecordData): string =>
  typeof invoice.number === 'string' && invoice.number ? invoice.number : invoice.id;

export interface PaymentInput {
  invoice_id: string;
  /** Omitted: the balance due. */
  amount?: number | undefined;
  /** YYYY-MM-DD; omitted: today. */
  paid_on?: string | undefined;
  method?: PaymentMethod | undefined;
  reference?: string | undefined;
}

/**
 * Add a payment against a sent invoice. Without an amount the balance due is settled; once nothing is owed the
 * invoice becomes paid and its payment link is cleared. Draft invoices must be sent first and void ones take no money.
 */
export const recordInvoicePayment = async (engine: ScopedEngine, input: PaymentInput) => {
  const invoice = await openInvoice(engine, input.invoice_id);
  const label = invoiceLabel(invoice);

  if (invoice.status === 'void') {
    throw new Error(`Invoice ${label} is void`);
  }

  if (invoice.status === 'draft') {
    throw new Error(`Invoice ${label} is still a draft; send it first`);
  }

  const state = await loadInvoiceState(engine, invoice);
  const amount = input.amount ?? state.balance;

  if (amount <= 0) {
    throw new Error(`Invoice ${label} has nothing left to pay`);
  }

  const payment = await engine.records.create('payment', {
    invoice: invoice.id,
    amount: round2(amount),
    paid_on: input.paid_on ?? localDate(new Date()),
    method: input.method ?? 'bank_transfer',
    ...(input.reference ? { reference: input.reference } : {}),
  });
  const paid = round2(state.paid + round2(amount));
  const balance = balanceOf(state.totals.total, paid);
  const status = balance <= 0 ? 'paid' : 'sent';
  await engine.records.update('invoice', invoice.id, {
    ...state.totals,
    status,
    ...(status === 'paid' ? { payment_url: null } : {}),
  });

  return { payment_id: payment.id, invoice_id: invoice.id, paid, balance, status };
};
