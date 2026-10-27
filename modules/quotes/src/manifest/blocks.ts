import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the module's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.quote_items,
    label: 'Items',
    description: "A quote's items and total, edited in place while it is a draft.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.deal_quotes,
    label: 'Quotes',
    description: 'The quotes made for a deal, with a New quote button.',
    surfaces: ['record'],
  }),
];
