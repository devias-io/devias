import { defineAction } from '@devias/core';
import { ids as invoicing } from '@devias/mod-invoicing/manifest';
import { ids } from './ids';

/** The one action: a payment link for an invoice, which `../server` implements. */
export const actions = [
  defineAction({
    id: ids.actions.create_invoice_payment_link,
    label: 'Create a payment link for an invoice',
    icon: 'link',
    description:
      'Create a payment link for what is left to pay on a sent invoice; the payment is recorded when the customer pays. Needs Invoicing and the checkout.session webhook events.',
    input: [
      { name: 'invoice_id', label: 'Invoice', type: 'record', objectId: invoicing.objects.invoice, required: true },
    ],
    output: [
      { name: 'invoice_id', type: 'record', objectId: invoicing.objects.invoice, description: 'The invoice.' },
      { name: 'url', description: 'The payment link, also stored on the invoice.' },
      { name: 'amount', type: 'number', description: 'What the link asks for: what is left to pay.' },
      { name: 'currency', description: 'The currency of the amount.' },
      { name: 'reused', type: 'boolean', description: 'True when the invoice already had a link for that amount.' },
    ],
  }),
];
