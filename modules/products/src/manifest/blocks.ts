import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the module's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.product_description,
    label: 'Description',
    description: "The product's description, edited in place.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.product_images,
    label: 'Images',
    description: "The product's pictures, the cover large; add one by link.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.product_prices,
    label: 'Prices',
    description: "The product's prices, edited in place; one is the default.",
    surfaces: ['record'],
  }),
];
