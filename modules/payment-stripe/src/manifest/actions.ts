import { defineAction } from '@devias/core';
import { ids as invoicing } from '@devias/mod-invoicing/manifest';
import { ids } from './ids';

/** The actions `../server` implements: a payment link for an invoice, and recording a payment Stripe reported. */
export const actions = [
  defineAction({
    id: ids.actions.create_invoice_payment_link,
    name: 'create_invoice_payment_link',
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
  defineAction({
    id: ids.actions.handle_checkout_event,
    name: 'handle_checkout_event',
    label: 'Handle a Stripe checkout event',
    icon: 'credit-card',
    description:
      "Add the payment of a paid Checkout session, from an invoice's payment link, to its invoice. Anything else is left alone, and a payment already recorded is not added twice. The workflow that comes with the module runs it for each event.",
    input: [
      {
        name: 'event',
        label: 'Stripe event',
        type: 'json',
        required: true,
        help: 'A checkout.session.completed or checkout.session.async_payment_succeeded event, as Stripe sent it.',
      },
    ],
    output: [
      { name: 'recorded', type: 'boolean', description: 'True when a payment was added to the invoice.' },
      { name: 'reason', description: 'Why nothing was added, when nothing was.' },
      { name: 'invoice_id', type: 'record', objectId: invoicing.objects.invoice, description: 'The invoice.' },
    ],
    // It works inside the workspace; Stripe is told only to switch off a link that has been paid.
    external: false,
  }),
];
