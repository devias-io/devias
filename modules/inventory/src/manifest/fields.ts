import { defineField } from '@devias/core';
import { ids as products } from '@devias/mod-products/manifest';
import { ids } from './ids';

/** What the module adds to the product: whether its stock is counted, and when it runs low. */
export const fields = [
  defineField({
    id: ids.fields.product.tracked,
    objectId: products.objects.product,
    name: 'tracked',
    label: 'Track stock',
    type: 'boolean',
    description: 'Count its stock from the stock moves. Services are not counted.',
    defaultValue: false,
    position: 20,
  }),
  defineField({
    id: ids.fields.product.reorder_point,
    objectId: products.objects.product,
    name: 'reorder_point',
    label: 'Reorder at',
    type: 'number',
    settings: { precision: 3 },
    description: 'At or below this stock (all locations), the product shows as low.',
    position: 21,
  }),
];
