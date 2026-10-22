// @vitest-environment node

import { writeFileSync } from 'node:fs';
import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { buildInvoiceDocument } from '../src/studio/pdf/invoice-data';
import { InvoiceDocument } from '../src/studio/pdf/invoice-document';

const stamp = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };

const invoice = {
  ...stamp,
  id: 'inv-1',
  number: 'INV-0042',
  status: 'sent',
  issue_date: '2026-10-01',
  due_date: '2026-10-31',
  tax_rate: 21,
  currency: 'EUR',
  issuer_name: 'Lotru Origin S.R.L.',
  issuer_address: 'Soseaua Pipera 48A\nBucuresti',
  issuer_tax_id: 'RO 52761306',
  payment_methods: ['bank_transfer', 'card'],
  notes: 'Thanks for your business.',
};
const lines = [
  { ...stamp, id: 'l1', description: 'Design work', quantity: 10, unit_price: 120 },
  { ...stamp, id: 'l2', description: 'Hosting (annual)', quantity: 1, unit_price: 240.5 },
];
const payments = [
  { ...stamp, id: 'p1', amount: 500, paid_on: '2026-10-05', method: 'bank_transfer', reference: 'TX-991' },
];

describe('invoice discount in the PDF data', () => {
  it('shows the discount and taxes what is left', () => {
    const data = buildInvoiceDocument({
      issuer: 'Devias',
      invoice: { ...invoice, discount_type: 'percent', discount_value: 10, currency: 'USD' },
      lines: [{ ...stamp, id: 'l1', description: 'Work', quantity: 1, unit_price: 100 }],
      payments: [],
      names: {},
    });
    expect(data.totals.discount).toContain('10.00');
    expect(data.totals.total).toContain('108.90');
    expect(data.totals.total).toContain('$');
  });
});

describe('invoice PDF', () => {
  const data = buildInvoiceDocument({
    issuer: 'Devias',
    invoice,
    lines,
    payments,
    names: { company: 'Acme Corp', contact: 'Ada Lovelace' },
  });

  it('formats what the document prints', () => {
    expect(data.number).toBe('INV-0042');
    expect(data.status).toBe('Sent');
    expect(data.billTo).toEqual({ company: 'Acme Corp', contact: 'Ada Lovelace' });
    expect(data.lines).toHaveLength(2);
    expect(data.lines[0]?.tax).toBe('21%');
    expect(data.summary).toContain('due by');
    // 1,440.50 subtotal + 21% tax = 1,743.01; 500 paid leaves 1,243.01.
    expect(data.totals.total).toContain('1,743.01');
    expect(data.totals.due).toContain('1,243.01');
    expect(data.payments[0]?.method).toBe('Bank transfer');
    expect(data.issuedBy).toEqual({
      name: 'Lotru Origin S.R.L.',
      address: ['Soseaua Pipera 48A', 'Bucuresti'],
      taxId: 'RO 52761306',
    });
    expect(data.waysToPay).toEqual(['Bank transfer', 'Card']);
    expect(data.totals.discount).toBeNull();
  });

  it('renders a PDF', async () => {
    const buffer = await pdf(<InvoiceDocument data={data} />).toBuffer();
    const bytes = Buffer.from(await new Response(buffer as unknown as BodyInit).arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

    if (process.env.INVOICE_PDF_OUT) {
      writeFileSync(process.env.INVOICE_PDF_OUT, bytes);
    }
  });
});
