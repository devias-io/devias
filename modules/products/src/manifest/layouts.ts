import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** A group of fields in the aside: a label and an editable value each. */
const aside = (name: string, label: string, fieldIds: string[]) => ({
  name,
  label,
  blockId: coreIds.blocks.fields,
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
      { name: 'title', label: 'Name', blockId: coreIds.blocks.title, config: { fieldId: ids.fields.product.name } },
      { name: 'product_description', label: 'Description', blockId: ids.blocks.product_description },
      { name: 'product_prices', label: 'Prices', blockId: ids.blocks.product_prices },
      { name: 'product_images', label: 'Images', blockId: ids.blocks.product_images },
      { name: 'comments', label: 'Comments', blockId: coreIds.blocks.comments },
      { name: 'activity', label: 'Activity', blockId: coreIds.blocks.activity },
    ],
    aside: [
      aside('product', 'Product', [
        ids.fields.product.kind,
        ids.fields.product.sku,
        ids.fields.product.unit,
        ids.fields.product.active,
      ]),
    ],
  }),
];
