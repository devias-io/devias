import { defineModule, type ModuleManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifest, PAYMENT_LINK_ACTION } from '../src/manifest';
import {
  invoiceDetailsBlock,
  invoiceFiguresBlock,
  invoiceHeaderBlock,
  invoiceLinesBlock,
  invoicePaymentsBlock,
} from '../src/studio/record';

afterEach(cleanup);

const blocks = [invoiceHeaderBlock, invoiceFiguresBlock, invoiceLinesBlock, invoicePaymentsBlock, invoiceDetailsBlock];

const setup = async (invoice: Record<string, unknown>, providers: ModuleManifest[] = []) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest, ...providers] });
  const schema = await client.metadata.getSchema();
  const created = await client.records.create('invoice', { number: 'INV-1', tax_rate: 20, ...invoice });
  await client.records.create('invoice_line', {
    description: 'Design',
    invoice: created.id,
    quantity: 2,
    unit_price: 100,
  });
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'invoice');

  if (!object) {
    throw new Error('the invoice object was not installed');
  }

  const view = render(
    <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: blocks })}>
      <RecordPage object={object} recordId={created.id} />
    </TestProviders>,
  );

  return { client, invoice: created, ...view };
};

const editableValues = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="invoice-details"] [role="button"]').length;

describe('invoice page', () => {
  it('is laid out like a record page: a header, a row of figures, then items and details in two columns', async () => {
    const { client, invoice, container } = await setup({ status: 'sent', due_date: '2020-01-01' });
    await client.records.create('payment', { invoice: invoice.id, amount: 100, paid_on: '2026-01-02', method: 'card' });
    await waitFor(() => expect(container.querySelector('[data-slot="paid-bar"]')).toBeTruthy());
    // Two tabs: the page, then the comments (what the layout does not list is not added).
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Comments']);
    // The header: the page's breadcrumbs, then the block with the number, its status and what the status allows.
    const page = container.querySelector('[data-slot="record-header"]') as HTMLElement;
    expect(page.textContent).toContain('Invoices');
    const header = page.querySelector('[data-slot="invoice-header"]') as HTMLElement;
    expect(header.querySelector('h1')?.textContent).toBe('INV-1');
    expect(header.textContent).toContain('Sent');
    expect(header.textContent).toContain('Past due');
    expect(header.querySelector('[data-action="record-payment"]')).toBeTruthy();
    // The figures: what is left, the total, what is paid, and when it was due.
    const figures = [...container.querySelectorAll('[data-slot="figure"]')].map((figure) => figure.textContent);
    expect(figures[0]).toContain('Amount due');
    expect(figures[0]).toContain('140');
    // A bar of what is paid against the total, in the amount due.
    expect(figures[0]).toMatch(/100.*of.*240.*paid/);
    expect(figures[1]).toContain('Total');
    expect(figures[2]).toContain('Paid');
    expect(figures[3]).toContain('Due date');
    expect(figures[3]).toContain('overdue');
    // The details are in groups, edited in place on a draft; the old timeline card is gone.
    const groups = [...container.querySelectorAll('[data-slot="invoice-details"] h2')].map(
      (title) => title.textContent,
    );
    expect(groups).toEqual(['Customer', 'Invoice', 'Terms']);
    expect([...container.querySelectorAll('h2')].map((title) => title.textContent)).not.toContain('Timeline');
    // The items, the payments and the activity share a lane (the page adds what mentions the invoice after them); the
    // details are beside it, in the rail.
    const main = container.querySelector('[data-lane="1"]') as HTMLElement;
    expect(
      [...main.querySelectorAll(':scope > [data-cell]')].slice(0, 3).map((cell) => cell.getAttribute('data-cell')),
    ).toEqual(['invoice_lines', 'invoice_payments', 'activity']);
    expect(container.querySelector('[data-lane="9"] [data-cell="invoice_details"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="invoice-figures"]')).toBeTruthy();
    expect(container.querySelector('[data-cell="invoice_payments"]')?.textContent).toContain('Payments');
  });

  it('edits a draft in place, adds items, and locks everything once sent', async () => {
    const { client, invoice, container } = await setup({ status: 'draft' });
    await screen.findByRole('button', { name: 'Send invoice' });
    // Every detail is a click-to-edit value while the invoice is a draft; so are the line cells.
    expect(editableValues(container)).toBeGreaterThanOrEqual(6);
    await waitFor(() => expect(container.querySelector('[data-line] [role="button"]')).toBeTruthy());
    expect(container.querySelector('[data-slot="locked"]')).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-slot="amount-due"]')?.textContent).toContain('240'));

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(container.querySelectorAll('[data-line]')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    await screen.findByRole('button', { name: 'Record payment' });
    expect(editableValues(container)).toBe(0);
    expect(container.querySelector('[data-line] [role="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="locked"]')?.textContent).toMatch(/can’t be changed/);
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    const sent = await client.records.get('invoice', invoice.id);
    expect(sent).toMatchObject({ status: 'sent', subtotal: 200, tax: 40, total: 240 });
    expect(typeof sent.issue_date).toBe('string');
  });

  it('flags a past-due invoice and settles it through the payment dialog', async () => {
    const { client, invoice, container } = await setup({ status: 'sent', due_date: '2020-01-01' });
    await screen.findByRole('button', { name: 'Record payment' });
    expect(screen.getAllByText('Past due').length).toBeGreaterThan(0);
    await waitFor(() => expect(container.querySelector('[data-slot="headline-amount"]')?.textContent).toContain('240'));

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    const amount = (await screen.findByLabelText('Amount')) as HTMLInputElement;
    expect(amount.value).toBe('240');
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'TRX-1' } });
    // The dialog is portaled, so look it up on the document.
    fireEvent.click(document.querySelector('[data-action="confirm-payment"]') as HTMLElement);
    await waitFor(async () => {
      const updated = await client.records.get('invoice', invoice.id);
      expect(updated.status).toBe('paid');
    });
    await waitFor(() =>
      expect(container.querySelector('[data-slot="invoice-payments"]')?.textContent).toContain('TRX-1'),
    );
    expect(container.querySelector('[data-slot="amount-due"]')?.textContent?.replace(/[^\d.]/g, '')).toBe('0.00');
    expect(container.querySelector('[data-slot="locked"]')?.textContent).toMatch(/paid invoice is final/);
  });

  it('takes the payment online through each installed provider, and shows the link once made', async () => {
    // Any module declaring the payment link action is a provider; Invoicing names none.
    const cardpay = defineModule({
      id: 'cardpay',
      version: '0.1.0',
      name: 'CardPay',
      actions: [
        {
          id: `cardpay.${PAYMENT_LINK_ACTION}`,
          label: 'Create a payment link for an invoice',
          input: [{ name: 'invoice_id', label: 'Invoice id', required: true }],
        },
      ],
    });
    const { client, invoice, container } = await setup({ status: 'sent' }, [cardpay]);
    const url = 'https://pay.example/inv-1';
    // The provider stores the link on the invoice, as Stripe does.
    const run = vi.spyOn(client.modules, 'runAction').mockImplementation(async () => {
      await client.records.update('invoice', invoice.id, { payment_url: url });

      return { url };
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Create payment link' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('cardpay', PAYMENT_LINK_ACTION, { invoice_id: invoice.id }));
    expect(await screen.findByRole('link', { name: url })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy payment link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update link' })).toBeTruthy();
    expect(container.querySelector('[data-slot="online-payment"]')).toBeTruthy();
  });

  it('shows no online payment where no provider is installed', async () => {
    const { container } = await setup({ status: 'sent' });
    await screen.findByRole('button', { name: 'Record payment' });
    expect(container.querySelector('[data-slot="online-payment"]')).toBeNull();
  });
});

describe('deleting an invoice', () => {
  it('is possible only on a draft, takes its items with it, and is offered by the page menu only then', async () => {
    const { client, invoice } = await setup({ status: 'draft' });
    // The menu: Delete is there for a draft.
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
    expect(await screen.findByRole('menuitem', { name: /Delete/ })).toBeTruthy();
    cleanup();

    const sent = await setup({ status: 'sent' });
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
    expect(await screen.findByRole('menuitem', { name: /Copy link/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    // The rule is the data model's, so the API and the agent obey it too.
    await expect(sent.client.records.delete('invoice', [sent.invoice.id])).rejects.toMatchObject({ code: 'CONFLICT' });

    // A draft goes with its items.
    const lines = await client.records.list({
      object: 'invoice_line',
      filter: { field: 'invoice', op: 'eq', value: invoice.id },
    });
    expect(lines.items).toHaveLength(1);
    await client.records.delete('invoice', [invoice.id]);
    const after = await client.records.list({
      object: 'invoice_line',
      filter: { field: 'invoice', op: 'eq', value: invoice.id },
    });
    expect(after.items).toHaveLength(0);
  });
});
