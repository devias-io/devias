import { defineView } from '@devias/core';
import { ids } from './ids';

/** The moves (newest first) and the locations. Stock on hand shows on each product's page and on Home. */
export const views = [
  defineView({
    id: ids.views.stock_move.all,
    objectId: ids.objects.stock_move,
    label: 'All stock moves',
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    fields: [
      { fieldId: ids.fields.stock_move.reference, width: 200 },
      { fieldId: ids.fields.stock_move.moved_on, width: 120 },
      { fieldId: ids.fields.stock_move.product, width: 200 },
      { fieldId: ids.fields.stock_move.location, width: 160 },
      { fieldId: ids.fields.stock_move.direction, width: 100 },
      { fieldId: ids.fields.stock_move.quantity, width: 110 },
      { fieldId: ids.fields.stock_move.reason, width: 150 },
      { fieldId: ids.fields.stock_move.deal, width: 180 },
      { fieldId: ids.fields.stock_move.supplier, width: 180 },
    ],
    sorts: [{ fieldId: ids.fields.stock_move.moved_on, direction: 'desc' }],
  }),
  defineView({
    id: ids.views.location.all,
    objectId: ids.objects.location,
    label: 'All locations',
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    fields: [
      { fieldId: ids.fields.location.name, width: 200 },
      { fieldId: ids.fields.location.kind, width: 130 },
      { fieldId: ids.fields.location.address, width: 260 },
    ],
    sorts: [{ fieldId: ids.fields.location.name, direction: 'asc' }],
  }),
];
