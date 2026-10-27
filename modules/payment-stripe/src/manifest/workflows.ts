import { defineWorkflow } from '@devias/core';
import { ids } from './ids';

/**
 * What happens when Stripe reports a payment: the payment goes on the invoice it was for. The work is the action
 * `handle_checkout_event`; this is what sets it off. Each event the webhook stores starts one run, and a run that
 * fails can be retried from the workflow's runs.
 */
export const workflows = [
  defineWorkflow({
    id: ids.workflows.apply_checkout_payments,
    title: 'Apply Stripe checkout payments to invoices',
    description:
      "When Stripe reports a paid Checkout session from an invoice's payment link, add the payment to the invoice.",
    trigger: {
      kind: 'module_event',
      moduleId: ids.module,
      types: ['checkout.session.completed', 'checkout.session.async_payment_succeeded'],
    },
    steps: [
      {
        id: ids.steps.handle_checkout_event,
        kind: 'action',
        actionId: ids.actions.handle_checkout_event,
        input: { event: '{{event.payload}}' },
      },
    ],
  }),
];
