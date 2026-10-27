import { definePolicy } from '@devias/core';
import { ids } from './ids';

/** What waits for a person to review it, instead of running on its own. */
export const policies = [
  definePolicy({
    id: ids.policies.counts,
    description: 'Correcting stock after a count always needs review.',
    match: { actionId: ids.actions.count },
    decision: 'review',
  }),
];
