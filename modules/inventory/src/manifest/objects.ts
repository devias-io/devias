import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids as products } from '@devias/mod-products/manifest';
import { ids } from './ids';

export const LOCATION_KINDS = [
  { value: 'warehouse', label: 'Warehouse', color: 'blue' },
  { value: 'van', label: 'Van', color: 'orange' },
  { value: 'site', label: 'Site', color: 'green' },
  { value: 'other', label: 'Other', color: 'neutral' },
] as const;

/** Every move adds to a location's stock or takes from it; stock on hand is what came in minus what went out. */
export const DIRECTIONS = [
  { value: 'in', label: 'In', color: 'green' },
  { value: 'out', label: 'Out', color: 'orange' },
] as const;
export type Direction = (typeof DIRECTIONS)[number]['value'];

export const MOVE_REASONS = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'use', label: 'Used on a job' },
  { value: 'sale', label: 'Sale' },
  { value: 'return', label: 'Return' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'count', label: 'Stock count' },
  { value: 'loss', label: 'Loss or damage' },
  { value: 'other', label: 'Other' },
] as const;

const location = defineObject({
  id: ids.objects.location,
  nameSingular: 'location',
  namePlural: 'locations',
  labelSingular: 'Location',
  labelPlural: 'Locations',
  icon: 'map-pin',
  description: 'Where stock is kept: a warehouse, a van, a site.',
  primaryFieldId: ids.fields.location.name,
  fields: [
    defineField({
      id: ids.fields.location.name,
      name: 'name',
      label: 'Name',
      type: 'text',
      isRequired: true,
      isUnique: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.location.kind,
      name: 'kind',
      label: 'Kind',
      type: 'select',
      settings: { options: [...LOCATION_KINDS] },
      defaultValue: 'warehouse',
      position: 1,
    }),
    defineField({
      id: ids.fields.location.address,
      name: 'address',
      label: 'Address',
      type: 'text',
      position: 2,
    }),
    defineField({
      id: ids.fields.location.notes,
      name: 'notes',
      label: 'Notes',
      type: 'text',
      settings: { multiline: true },
      position: 3,
    }),
  ],
});
export type Location = InferRecord<typeof location>;

const stockMove = defineObject({
  id: ids.objects.stock_move,
  nameSingular: 'stock_move',
  namePlural: 'stock_moves',
  labelSingular: 'Stock move',
  labelPlural: 'Stock moves',
  icon: 'package',
  description: 'Stock moving into or out of a location: the ledger stock on hand is added up from.',
  primaryFieldId: ids.fields.stock_move.reference,
  fields: [
    defineField({
      id: ids.fields.stock_move.reference,
      name: 'reference',
      label: 'Reference',
      type: 'text',
      description: 'A delivery note, an order number, or what it was for.',
      position: 0,
    }),
    defineField({
      id: ids.fields.stock_move.product,
      name: 'product',
      label: 'Product',
      type: 'relation',
      icon: 'box',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: products.objects.product,
        inverseLabel: 'Stock moves',
      },
      position: 1,
    }),
    defineField({
      id: ids.fields.stock_move.location,
      name: 'location',
      label: 'Location',
      type: 'relation',
      icon: 'map-pin',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.location,
        inverseLabel: 'Stock moves',
      },
      position: 2,
    }),
    defineField({
      id: ids.fields.stock_move.direction,
      name: 'direction',
      label: 'Direction',
      type: 'select',
      settings: { options: [...DIRECTIONS] },
      isRequired: true,
      position: 3,
    }),
    defineField({
      id: ids.fields.stock_move.quantity,
      name: 'quantity',
      label: 'Quantity',
      type: 'number',
      settings: { precision: 3 },
      description: 'Always positive: the direction says which way.',
      isRequired: true,
      position: 4,
    }),
    defineField({
      id: ids.fields.stock_move.reason,
      name: 'reason',
      label: 'Reason',
      type: 'select',
      settings: { options: MOVE_REASONS.map((reason) => ({ ...reason, color: 'neutral' })) },
      defaultValue: 'other',
      position: 5,
    }),
    defineField({
      id: ids.fields.stock_move.moved_on,
      name: 'moved_on',
      label: 'Date',
      type: 'date',
      isRequired: true,
      position: 6,
    }),
    defineField({
      id: ids.fields.stock_move.deal,
      name: 'deal',
      label: 'Deal',
      type: 'relation',
      icon: 'target',
      description: 'The job the stock was used on.',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.deal,
        inverseLabel: 'Stock moves',
      },
      position: 7,
    }),
    defineField({
      id: ids.fields.stock_move.supplier,
      name: 'supplier',
      label: 'Supplier',
      type: 'relation',
      icon: 'building-2',
      description: 'Who it was bought from.',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.company,
        inverseLabel: 'Stock moves',
      },
      position: 8,
    }),
    defineField({
      id: ids.fields.stock_move.unit_cost,
      name: 'unit_cost',
      label: 'Unit cost',
      type: 'money',
      settings: { currencyCode: 'EUR' },
      position: 9,
    }),
  ],
});
export type StockMove = InferRecord<typeof stockMove>;

/** The objects of the module, in the order its manifest lists them. */
export const objects = [location, stockMove];
