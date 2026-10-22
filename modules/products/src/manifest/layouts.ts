import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** A group of fields in the aside: a label and an editable value each. */
const aside = (label: string, fieldIds: string[]) => ({
  blockId: coreIds.blocks.fields,
  label,
  config: { fieldIds },
});

/**
 * The product page, one flow in the `split` shape: its name, its description, its prices, its pictures, then the conversation, with what
 * the product is beside. Other modules add their own sections (stock, for one) without this layout naming them.
 */
export const layouts = [
  defineLayout({
    id: ids.layouts.product.default,
    objectId: ids.objects.product,
    label: 'Product',
    isDefault: true,
    shell: 'split',
    main: [
      { blockId: coreIds.blocks.title, label: 'Name', config: { fieldId: ids.fields.product.name } },
      { blockId: ids.blocks.product_description, label: 'Description' },
      { blockId: ids.blocks.product_prices, label: 'Prices' },
      { blockId: ids.blocks.product_images, label: 'Images' },
      { blockId: coreIds.blocks.notes, label: 'Notes' },
      { blockId: coreIds.blocks.activity, label: 'Activity' },
    ],
    aside: [
      aside('Product', [
        ids.fields.product.kind,
        ids.fields.product.sku,
        ids.fields.product.unit,
        ids.fields.product.active,
      ]),
    ],
  }),
];
