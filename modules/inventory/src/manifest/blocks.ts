import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the module's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.product_stock,
    label: 'Stock',
    description: "A product's stock on hand by location, and whether it is low.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.low_stock,
    label: 'Low stock',
    description: 'Products at or below their reorder point.',
    surfaces: ['home'],
  }),
];
