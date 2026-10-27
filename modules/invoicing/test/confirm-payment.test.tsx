import type { ApprovalBlockProps, ToolCall } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { installLayoutStubs, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';
import { confirmPaymentBlock } from '../src/studio/blocks/confirm-payment';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const eur = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(value);

/** An invoice of 2,400 for Northwind Labs, one line, nothing paid yet. */
const setup = async (invoice: Record<string, unknown> = {}) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
  const schema = await client.metadata.getSchema();
  const company = await client.records.create('company', { name: 'Northwind Labs' });
  const created = await client.records.create('invoice', {
    number: 'INV-0042',
    status: 'sent',
    company: company.id,
    currency: 'EUR',
    tax_rate: 0,
    ...invoice,
  });
  await client.records.create('invoice_line', {
    invoice: created.id,
    description: 'Design',
    quantity: 1,
    unit_price: 2400,
  });

  return { client, schema, invoice_id: created.id };
};

const show = (
  setupResult: Awaited<ReturnType<typeof setup>>,
  input: Record<string, unknown>,
  handlers: { approve?: () => void; reject?: () => void } = {},
) => {
  const Widget = confirmPaymentBlock.component as unknown as ComponentType<ApprovalBlockProps>;
  const call: ToolCall = {
    id: 'call1',
    toolUseId: 'tu1',
    name: 'add_payment',
    input: { invoice_id: setupResult.invoice_id, ...input },
    status: 'pending',
    requiresApproval: true,
  };

  return render(
    <TestProviders client={setupResult.client} schema={setupResult.schema}>
      <Widget
        config={{}}
        surface="approval"
        call={call}
        busy={false}
        approve={handlers.approve ?? (() => {})}
        reject={handlers.reject ?? (() => {})}
      />
    </TestProviders>,
  );
};

describe('the card that asks to approve a payment', () => {
  it('is the approval of the tool that records a payment', () => {
    expect(confirmPaymentBlock.surfaces.approval?.tools).toEqual(['add_payment']);
    expect(confirmPaymentBlock.id).toBe(ids.blocks.confirm_payment);
  });

  it('says what will be recorded as one sentence, and answers through the pills', async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const { container } = show(await setup(), { method: 'card', paid_on: '2026-10-24' }, { approve, reject });
    // With no amount the balance due is settled, so settles the invoice.
    expect(await screen.findByText(eur(2400))).toBeTruthy();
    const card = container.querySelector('[data-slot="payment-approval"]') as HTMLElement;
    expect(card.textContent).toContain(`Record ${eur(2400)} from Northwind Labs on invoice INV-0042.`);
    // The line under it: how it is paid and what it leaves.
    expect(card.textContent).toContain('Card · ');
    expect(card.textContent).toContain('settles the invoice');
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('href')).toContain('/invoice/');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approve).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it('works out what is left from the invoice and its payments, as the server will', async () => {
    const result = await setup();
    await result.client.records.create('payment', { invoice: result.invoice_id, amount: 400, paid_on: '2026-10-01' });
    const { container } = show(result, { amount: 1000, reference: 'Wire 7781' });
    // 2,400 owed, 400 already paid, 1,000 now: 1,000 left.
    expect(await screen.findByText(eur(1000), { selector: 'span' })).toBeTruthy();
    const card = container.querySelector('[data-slot="payment-approval"]') as HTMLElement;
    expect(card.textContent).toContain(`${eur(1000)} left to pay`);
    expect(card.textContent).toContain('Wire 7781');
    expect(card.textContent).not.toContain('settles the invoice');
  });

  it('cannot be approved while the invoice cannot take the payment, and says why', async () => {
    show(await setup({ status: 'draft' }), {});
    expect(await screen.findByText('This invoice is still a draft. Send it first.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    // Saying no is always possible.
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
