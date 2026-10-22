import { definePolicy } from '@devias/core';
import { ids } from './ids';

/** What waits for a person to review it, instead of running on its own. */
export const policies = [
  definePolicy({
    id: ids.policies.large_expenses,
    description: 'Expenses over 500 need review.',
    match: { objectId: ids.objects.expense },
    when: { fieldId: ids.fields.expense.amount, above: 500 },
    decision: 'review',
  }),
];
