import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids } from './ids';

/** The quotes module's objects: quotes for the CRM's deals, and their items. */

/** Where a quote stands with the customer. */
export const QUOTE_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'neutral' },
  { value: 'sent', label: 'Sent', color: 'neutral' },
  { value: 'accepted', label: 'Accepted', color: 'green' },
  { value: 'declined', label: 'Declined', color: 'red' },
  { value: 'expired', label: 'Expired', color: 'orange' },
] as const;

const quote = defineObject({
  id: ids.objects.quote,
  nameSingular: 'quote',
  namePlural: 'quotes',
  labelSingular: 'Quote',
  labelPlural: 'Quotes',
  icon: 'file-text',
  description: 'An offer for a deal: the items and prices you proposed.',
  primaryFieldId: ids.fields.quote.title,
  fields: [
    defineField({
      id: ids.fields.quote.title,
      name: 'title',
      label: 'Title',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({ id: ids.fields.quote.number, name: 'number', label: 'Number', type: 'text', position: 1 }),
    defineField({
      id: ids.fields.quote.status,
      name: 'status',
      label: 'Status',
      type: 'select',
      settings: { options: [...QUOTE_STATUSES] },
      defaultValue: 'draft',
      isRequired: true,
      position: 2,
    }),
    defineField({
      id: ids.fields.quote.deal,
      name: 'deal',
      label: 'Deal',
      type: 'relation',
      icon: 'target',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.deal,
        inverseLabel: 'Quotes',
      },
      position: 3,
    }),
    defineField({
      id: ids.fields.quote.company,
      name: 'company',
      label: 'Company',
      type: 'relation',
      icon: 'building-2',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.company,
        inverseLabel: 'Quotes',
      },
      position: 4,
    }),
    defineField({
      id: ids.fields.quote.valid_until,
      name: 'valid_until',
      label: 'Valid until',
      type: 'date',
      position: 5,
    }),
    defineField({
      id: ids.fields.quote.total,
      name: 'total',
      label: 'Total',
      type: 'money',
      description: 'What the items add up to; kept current by Recalculate quote.',
      settings: { currencyCode: 'EUR' },
      position: 6,
    }),
    defineField({
      id: ids.fields.quote.notes,
      name: 'notes',
      label: 'Notes',
      type: 'text',
      settings: { multiline: true },
      position: 7,
    }),
  ],
});
export type Quote = InferRecord<typeof quote>;

const quoteItem = defineObject({
  id: ids.objects.quote_item,
  nameSingular: 'quote_item',
  namePlural: 'quote_items',
  labelSingular: 'Quote item',
  labelPlural: 'Quote items',
  icon: 'list',
  description: 'One line of a quote: description, quantity and unit price.',
  primaryFieldId: ids.fields.quote_item.description,
  fields: [
    defineField({
      id: ids.fields.quote_item.description,
      name: 'description',
      label: 'Description',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.quote_item.quote,
      name: 'quote',
      label: 'Quote',
      type: 'relation',
      icon: 'file-text',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.quote,
        inverseLabel: 'Items',
        // A quote's items go with it.
        onDelete: 'cascade',
      },
      position: 1,
    }),
    defineField({
      id: ids.fields.quote_item.quantity,
      name: 'quantity',
      label: 'Quantity',
      type: 'number',
      settings: { precision: 2 },
      defaultValue: 1,
      position: 3,
    }),
    defineField({
      id: ids.fields.quote_item.unit_price,
      name: 'unit_price',
      label: 'Unit price',
      type: 'money',
      settings: { currencyCode: 'EUR' },
      position: 4,
    }),
  ],
});
export type QuoteItem = InferRecord<typeof quoteItem>;

/** The objects of the module, in the order its manifest lists them. */
export const objects = [quote, quoteItem];
