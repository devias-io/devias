import { definePolicy } from '@devias/core';
import { ids } from './ids';

/** What the agent and workflows may do on their own, and what waits for a person to review it. */
export const policies = [
  definePolicy({
    id: ids.policies.review_payments,
    description: 'Adding a payment always needs review.',
    match: { actionId: ids.actions.add_payment },
    decision: 'review',
  }),
  definePolicy({
    id: ids.policies.large_invoices,
    description: 'Invoices over 5,000 need review.',
    match: { objectId: ids.objects.invoice },
    when: { fieldId: ids.fields.invoice.total, above: 5000 },
    decision: 'review',
  }),
];
