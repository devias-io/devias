import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the Fixture's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.person_summary,
    label: 'Person summary',
    description: "A person's avatar, name and contact details.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.pipeline,
    label: 'Pipeline',
    description: 'Open deals: their total value and the count per stage.',
    surfaces: ['home'],
  }),
  defineBlock({
    id: ids.blocks.chores,
    label: 'Chores',
    description: 'Open chores: due this week and overdue.',
    surfaces: ['home'],
  }),
  defineBlock({
    id: ids.blocks.new_this_week,
    label: 'New this week',
    description: 'People, companies and deals added since Monday.',
    surfaces: ['home'],
  }),
];
