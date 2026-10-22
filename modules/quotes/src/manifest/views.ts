import { coreIds, defineView } from '@devias/core';
import { ids } from './ids';

/** Saved views: every quote, the ones awaiting an answer, and the items of all of them. */
export const views = [
  defineView({
    id: ids.views.quote.all,
    objectId: ids.objects.quote,
    label: 'All quotes',
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    fields: [
      { fieldId: ids.fields.quote.title, width: 240 },
      { fieldId: ids.fields.quote.number, width: 120 },
      { fieldId: ids.fields.quote.status, width: 120 },
      { fieldId: ids.fields.quote.deal, width: 200 },
      { fieldId: ids.fields.quote.company, width: 180 },
      { fieldId: ids.fields.quote.total, width: 130 },
      { fieldId: ids.fields.quote.valid_until, width: 130 },
    ],
    sorts: [{ fieldId: coreIds.fields.updated_at, direction: 'desc' }],
  }),
  defineView({
    id: ids.views.quote.awaiting_answer,
    objectId: ids.objects.quote,
    label: 'Awaiting answer',
    type: 'table',
    icon: 'table',
    position: 1,
    fields: [
      { fieldId: ids.fields.quote.title, width: 240 },
      { fieldId: ids.fields.quote.status, width: 120 },
      { fieldId: ids.fields.quote.deal, width: 200 },
      { fieldId: ids.fields.quote.total, width: 130 },
      { fieldId: ids.fields.quote.valid_until, width: 130 },
    ],
    filter: { field: ids.fields.quote.status, op: 'eq', value: 'sent' },
    sorts: [{ fieldId: ids.fields.quote.valid_until, direction: 'asc' }],
  }),
  defineView({
    id: ids.views.quote_item.all,
    objectId: ids.objects.quote_item,
    label: 'All quote items',
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    fields: [
      { fieldId: ids.fields.quote_item.description, width: 240 },
      { fieldId: ids.fields.quote_item.quote, width: 200 },
      { fieldId: ids.fields.quote_item.quantity, width: 100 },
      { fieldId: ids.fields.quote_item.unit_price, width: 130 },
    ],
  }),
];
