import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { createStaticNavigation } from '@devias/studio';
import { TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import {
  addDays,
  emptyLine,
  invoiceRecord,
  newForm,
  nextInvoiceNumber,
  sendProblems,
  termsFor,
} from '../src/studio/composer/composer-state';
import { InvoiceComposerPage } from '../src/studio/composer/invoice-composer';

afterEach(cleanup);

describe('composer state', () => {
  it('numbers the next invoice after the latest, keeping prefix and padding', () => {
    expect(nextInvoiceNumber('INV-009')).toBe('INV-010');
    expect(nextInvoiceNumber('UND-013')).toBe('UND-014');
    expect(nextInvoiceNumber('12')).toBe('13');
    expect(nextInvoiceNumber(null)).toBe('INV-001');
    expect(nextInvoiceNumber('draft')).toBe('INV-001');
  });

  it('moves dates by whole days and recognises payment terms', () => {
    expect(addDays('2026-10-09', 30)).toBe('2026-11-08');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(termsFor('2026-10-09', '2026-11-08')).toBe(30);
    expect(termsFor('2026-10-09', '2026-10-09')).toBe(0);
    expect(termsFor('2026-10-09', '2026-10-20')).toBeNull();
  });

  it('builds the invoice record with totals, discount and optional parts', () => {
    const form = {
      ...newForm('2026-10-09', undefined, 'Devias'),
      company: { id: 'c1', label: 'Acme' },
      lines: [
        { ...emptyLine(), description: 'Design', quantity: '2', unit_price: '100', tax_rate: '20' },
        { ...emptyLine(), description: 'Hosting', quantity: '1', unit_price: '50', tax_rate: '' },
        emptyLine(),
      ],
      discountOn: true,
      discount_type: 'percent' as const,
      discount_value: '10',
      noteOn: false,
      notes: 'ignored',
      taxIdOn: true,
      issuer_tax_id: 'RO 1',
    };
    const record = invoiceRecord(form, 'sent');
    expect(record).toMatchObject({
      number: 'INV-001',
      status: 'sent',
      company: 'c1',
      due_date: '2026-11-08',
      subtotal: 250,
      discount_amount: 25,
      tax: 36,
      total: 261,
      issuer_tax_id: 'RO 1',
      notes: null,
    });
    expect(sendProblems(form)).toEqual([]);
    expect(sendProblems({ ...form, company: null, lines: [emptyLine()] })).toEqual([
      'Choose a customer.',
      'Add at least one item.',
    ]);
  });
});

describe('invoice composer', () => {
  it('composes an invoice with a live preview and saves it as a draft with its items', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
    const schema = await client.metadata.getSchema();
    await client.records.create('company', { name: 'Acme Corp' });
    render(
      <TestProviders
        client={client}
        schema={schema}
        navigation={createStaticNavigation('/workspaces/acme/billing/new')}
      >
        <InvoiceComposerPage />
      </TestProviders>,
    );
    await screen.findByText('New invoice');
    expect((screen.getByLabelText('Invoice number') as HTMLInputElement).value).toBe('INV-001');

    fireEvent.click(await screen.findByRole('button', { name: /Acme Corp/ }));
    fireEvent.change(screen.getByLabelText('Product or service'), { target: { value: 'Design work' } });
    fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Tax rate for item 1'), { target: { value: '20' } });

    // The paper follows the form.
    const paper = document.querySelector('[data-slot="invoice-paper"]') as HTMLElement;
    await waitFor(() => expect(paper.textContent).toContain('Design work'));
    expect(paper.textContent).toContain('Acme Corp');
    expect(paper.textContent).toContain('120.00');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const invoices = await client.records.list({ object: 'invoice' });
      expect(invoices.items).toHaveLength(1);
    });
    const invoice = (await client.records.list({ object: 'invoice' })).items[0];
    expect(invoice).toMatchObject({ number: 'INV-001', status: 'draft', subtotal: 100, tax: 20, total: 120 });
    const lines = await client.records.list({ object: 'invoice_line' });
    expect(lines.items[0]).toMatchObject({
      description: 'Design work',
      unit_price: 100,
      tax_rate: 20,
      invoice: invoice?.id,
    });
  });
});
