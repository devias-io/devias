import { definePolicy } from '@devias/core';
import { ids } from './ids';

/** What waits for a person to review it, instead of running on its own. */
export const policies = [
  definePolicy({
    id: ids.policies.send_email,
    description: 'Sending an email always needs review.',
    match: { actionId: ids.actions.send_email },
    decision: 'review',
  }),
];
