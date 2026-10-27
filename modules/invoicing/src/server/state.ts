import type { RecordData } from '@devias/core';
import type { ScopedEngine } from '@devias/server';
import { balanceOf, discountOfInvoice, type InvoiceTotals, paidOf, totalsOf } from '../lib/totals';

export interface InvoiceState {
  totals: InvoiceTotals;
  paid: number;
  balance: number;
  lines: number;
}

/** What an invoice's lines and payments add up to right now, read through the caller's engine. */
export const loadInvoiceState = async (engine: ScopedEngine, invoice: RecordData): Promise<InvoiceState> => {
  const [lines, payments] = await Promise.all([
    engine.records.list({
      object: 'invoice_line',
      filter: { field: 'invoice', op: 'eq', value: invoice.id },
      limit: 200,
    }),
    engine.records.list({ object: 'payment', filter: { field: 'invoice', op: 'eq', value: invoice.id }, limit: 200 }),
  ]);
  const totals = totalsOf(lines.items, invoice.tax_rate, discountOfInvoice(invoice));
  const paid = paidOf(payments.items);

  return { totals, paid, balance: balanceOf(totals.total, paid), lines: lines.items.length };
};
