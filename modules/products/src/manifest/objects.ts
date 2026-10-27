import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids } from './ids';

/** The module's objects: what you sell (products) and how it is priced (prices). */

/** A good is something you hand over; a service is something you do. */
export const PRODUCT_KINDS = [
  { value: 'good', label: 'Good', color: 'neutral' },
  { value: 'service', label: 'Service', color: 'neutral' },
] as const;

/** How a product is counted; `short` follows a quantity ("12 m"). */
export const UNITS = [
  { value: 'piece', label: 'Piece', short: 'pcs' },
  { value: 'hour', label: 'Hour', short: 'h' },
  { value: 'day', label: 'Day', short: 'days' },
  { value: 'meter', label: 'Meter', short: 'm' },
  { value: 'square_meter', label: 'Square meter', short: 'm²' },
  { value: 'kilogram', label: 'Kilogram', short: 'kg' },
  { value: 'liter', label: 'Liter', short: 'l' },
  { value: 'box', label: 'Box', short: 'boxes' },
] as const;

/** Whether a price is paid once or again and again. */
export const PRICE_TYPES = [
  { value: 'one_time', label: 'One time', color: 'neutral' },
  { value: 'recurring', label: 'Recurring', color: 'neutral' },
] as const;

/** How often a recurring price is paid again (every `interval_count` of these). */
export const INTERVALS = [
  { value: 'day', label: 'Day', color: 'neutral' },
  { value: 'week', label: 'Week', color: 'neutral' },
  { value: 'month', label: 'Month', color: 'neutral' },
  { value: 'year', label: 'Year', color: 'neutral' },
] as const;
export type Interval = (typeof INTERVALS)[number]['value'];

/** The currency a price is in when none is given; each price stores its own. */
export const CURRENCY = 'EUR';

/** Whether the amount already contains the tax, or the tax is added on top of it. */
export const TAX_BEHAVIORS = [
  { value: 'exclusive', label: 'Excludes tax', color: 'neutral' },
  { value: 'inclusive', label: 'Includes tax', color: 'neutral' },
] as const;

const product = defineObject({
  id: ids.objects.product,
  nameSingular: 'product',
  namePlural: 'products',
  labelSingular: 'Product',
  labelPlural: 'Products',
  icon: 'package',
  description: 'Something you sell: a good or a service.',
  primaryFieldId: ids.fields.product.name,
  fields: [
    defineField({
      id: ids.fields.product.name,
      name: 'name',
      label: 'Name',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.product.description,
      name: 'description',
      label: 'Description',
      type: 'text',
      settings: { multiline: true },
      description: 'What the customer reads on a quote or invoice.',
      position: 1,
    }),
    defineField({
      id: ids.fields.product.kind,
      name: 'kind',
      label: 'Kind',
      type: 'select',
      settings: { options: [...PRODUCT_KINDS] },
      defaultValue: 'good',
      isRequired: true,
      position: 2,
    }),
    defineField({ id: ids.fields.product.sku, name: 'sku', label: 'SKU', type: 'text', position: 3 }),
    defineField({
      id: ids.fields.product.images,
      name: 'images',
      label: 'Images',
      type: 'images',
      description: 'Picture links; the first is the cover (up to eight).',
      position: 4,
    }),
    defineField({
      id: ids.fields.product.unit,
      name: 'unit',
      label: 'Unit',
      type: 'select',
      description: 'What one is counted in.',
      settings: { options: UNITS.map(({ value, label }) => ({ value, label, color: 'neutral' })) },
      defaultValue: 'piece',
      position: 5,
    }),
    defineField({
      id: ids.fields.product.active,
      name: 'active',
      label: 'Active',
      type: 'boolean',
      description: 'Whether it can be offered. Turn off instead of deleting.',
      defaultValue: true,
      position: 6,
    }),
    defineField({
      id: ids.fields.product.default_price,
      name: 'default_price',
      label: 'Default price',
      type: 'relation',
      icon: 'tag',
      description: 'The price offered when nothing else is chosen.',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.price,
        inverseLabel: 'Default for',
      },
      position: 7,
    }),
  ],
});
export type Product = InferRecord<typeof product>;

const price = defineObject({
  id: ids.objects.price,
  nameSingular: 'price',
  namePlural: 'prices',
  labelSingular: 'Price',
  labelPlural: 'Prices',
  icon: 'tag',
  description: 'One way to pay for a product: an amount, once or on a schedule.',
  primaryFieldId: ids.fields.price.nickname,
  fields: [
    defineField({
      id: ids.fields.price.nickname,
      name: 'nickname',
      label: 'Name',
      type: 'text',
      description: "Tells it apart from the product's other prices. Not shown to customers.",
      position: 0,
    }),
    defineField({
      id: ids.fields.price.product,
      name: 'product',
      label: 'Product',
      type: 'relation',
      icon: 'package',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.product,
        inverseLabel: 'Prices',
        // A product's prices go with it.
        onDelete: 'cascade',
      },
      position: 1,
    }),
    defineField({
      id: ids.fields.price.amount,
      name: 'amount',
      label: 'Amount',
      type: 'money',
      description: 'Per unit.',
      settings: { currencyFieldId: ids.fields.price.currency },
      isRequired: true,
      position: 2,
    }),
    defineField({
      id: ids.fields.price.currency,
      name: 'currency',
      label: 'Currency',
      type: 'currency',
      defaultValue: CURRENCY,
      isRequired: true,
      position: 3,
    }),
    defineField({
      id: ids.fields.price.type,
      name: 'type',
      label: 'Billing',
      type: 'select',
      settings: { options: [...PRICE_TYPES] },
      defaultValue: 'one_time',
      isRequired: true,
      position: 4,
    }),
    defineField({
      id: ids.fields.price.interval,
      name: 'interval',
      label: 'Every',
      type: 'select',
      description: 'For a recurring price: the unit of the schedule.',
      settings: { options: [...INTERVALS] },
      position: 5,
    }),
    defineField({
      id: ids.fields.price.interval_count,
      name: 'interval_count',
      label: 'Interval count',
      type: 'number',
      description: 'For a recurring price: intervals between payments.',
      settings: { precision: 0 },
      defaultValue: 1,
      position: 6,
    }),
    defineField({
      id: ids.fields.price.tax_behavior,
      name: 'tax_behavior',
      label: 'Tax',
      type: 'select',
      settings: { options: [...TAX_BEHAVIORS] },
      defaultValue: 'exclusive',
      position: 7,
    }),
    defineField({
      id: ids.fields.price.lookup_key,
      name: 'lookup_key',
      label: 'Lookup key',
      type: 'text',
      description: 'A stable key to find the price by, such as `pro-monthly`.',
      isUnique: true,
      position: 8,
    }),
    defineField({
      id: ids.fields.price.active,
      name: 'active',
      label: 'Active',
      type: 'boolean',
      description: 'Whether it can be offered. Turn off instead of deleting.',
      defaultValue: true,
      position: 9,
    }),
  ],
});
export type Price = InferRecord<typeof price>;

/** The objects of the module, in the order its manifest lists them. */
export const objects = [product, price];
