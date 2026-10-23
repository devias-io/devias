import { defineSkill } from '@devias/core';
import { ids } from './ids';

/**
 * The skills the CRM ships: procedures its agents load when a request calls for them, and any agent in the workspace
 * that may use every skill. The sales agent names the ones it uses.
 */
export const skills = [
  defineSkill({
    id: ids.skills.close_deal,
    title: 'Close out a deal',
    description: 'When a deal is won or lost, or someone asks to move a deal to Customer or to Lost.',
    body: [
      '# Close out a deal',
      '',
      'A deal is closed when it moves to **Customer** (won) or **Lost**.',
      '',
      '## When it is lost',
      '1. Set its stage to Lost.',
      '2. Set its lost reason: price, timing, went with a competitor, no decision, not a fit, or other. Ask which one if you do not know; never guess.',
      '3. Log a note on the deal with what the person said about why, if they said anything.',
      '',
      '## When it is won',
      '1. Set its stage to Customer.',
      "2. Offer to move the deal's point of contact to the Customer stage too, and do it once they agree.",
      '3. Log a note on the deal with what was agreed.',
      '',
      'Say in one sentence what you changed.',
    ].join('\n'),
  }),
];
