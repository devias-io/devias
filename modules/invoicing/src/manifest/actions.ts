import { defineAction } from '@devias/core';
import { ids } from './ids';

/**
 * The action a payment provider module (Stripe, …) declares to take an invoice's payment online: input
 * `{ invoice_id }`, output `{ url }`. It sets the invoice's `payment_url`, and records the payment once the customer
 * pays. The invoice page offers it for every installed module that declares it, so Invoicing names no provider.
 */
export const PAYMENT_LINK_ACTION = 'create_invoice_payment_link';

/**
 * Actions workflows, the API and the agent can call; `../server` implements them. Both work inside the
 * workspace only, so their output is not outside content.
 */
export const actions = [
  defineAction({
    id: ids.actions.recalculate_invoice,
    name: 'recalculate_invoice',
    label: 'Recalculate an invoice',
    icon: 'refresh-cw',
    description: 'Total the lines and store subtotal, discount, tax and total on the invoice.',
    input: [{ name: 'invoice_id', label: 'Invoice', type: 'record', objectId: ids.objects.invoice, required: true }],
    output: [
      { name: 'id', type: 'record', objectId: ids.objects.invoice, description: 'The invoice.' },
      { name: 'subtotal', type: 'number', description: 'The lines added up.' },
      { name: 'discount_amount', type: 'number', description: 'What the discount takes off.' },
      { name: 'tax', type: 'number', description: 'The tax on what is left.' },
      { name: 'total', type: 'number', description: 'What the customer owes.' },
    ],
    approval: 'auto',
    external: false,
  }),
  defineAction({
    id: ids.actions.add_payment,
    name: 'add_payment',
    label: 'Add a payment',
    description: 'Add a payment to a sent invoice; a settled invoice becomes paid.',
    input: [
      { name: 'invoice_id', label: 'Invoice', type: 'record', objectId: ids.objects.invoice, required: true },
      { name: 'amount', label: 'Amount', type: 'number', help: 'Leave empty to settle the balance due.' },
      { name: 'paid_on', label: 'Paid on', placeholder: '{{today}}', help: 'YYYY-MM-DD; defaults to today.' },
      { name: 'method', label: 'Method', placeholder: 'bank_transfer', help: 'bank_transfer, card, cash or other.' },
      { name: 'reference', label: 'Reference' },
    ],
    output: [
      { name: 'payment_id', type: 'record', objectId: ids.objects.payment, description: 'The payment recorded.' },
      {
        name: 'invoice_id',
        type: 'record',
        objectId: ids.objects.invoice,
        description: 'The invoice it was recorded on.',
      },
      { name: 'paid', type: 'number', description: 'What has been paid so far, this payment included.' },
      { name: 'balance', type: 'number', description: 'What is still owed.' },
      { name: 'status', description: "The invoice's status after this payment." },
    ],
    external: false,
  }),
];
