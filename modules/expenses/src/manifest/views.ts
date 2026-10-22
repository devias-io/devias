import { defineView } from '@devias/core';
import { ids } from './ids';

const columns = [
  { fieldId: ids.fields.expense.description, width: 240 },
  { fieldId: ids.fields.expense.amount, width: 120 },
  { fieldId: ids.fields.expense.spent_on, width: 120 },
  { fieldId: ids.fields.expense.category, width: 170 },
  { fieldId: ids.fields.expense.status, width: 120 },
  { fieldId: ids.fields.expense.supplier, width: 180 },
  { fieldId: ids.fields.expense.deal, width: 180 },
  { fieldId: ids.fields.expense.paid_with, width: 190 },
];

/** Every expense, newest first; a board by status that adds each lane up; and the two lists people act on. */
export const views = [
  defineView({
    id: ids.views.expense.all,
    objectId: ids.objects.expense,
    label: 'All expenses',
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    fields: columns,
    sorts: [{ fieldId: ids.fields.expense.spent_on, direction: 'desc' }],
  }),
  defineView({
    id: ids.views.expense.by_status,
    objectId: ids.objects.expense,
    label: 'By status',
    type: 'kanban',
    icon: 'kanban',
    position: 1,
    fields: [
      { fieldId: ids.fields.expense.description },
      { fieldId: ids.fields.expense.amount },
      { fieldId: ids.fields.expense.category },
      { fieldId: ids.fields.expense.spent_on },
    ],
    groupById: ids.fields.expense.status,
    sorts: [{ fieldId: ids.fields.expense.spent_on, direction: 'desc' }],
    settings: { aggregate: { fieldId: ids.fields.expense.amount, operation: 'sum' } },
  }),
  defineView({
    id: ids.views.expense.to_approve,
    objectId: ids.objects.expense,
    label: 'To approve',
    type: 'table',
    icon: 'table',
    position: 2,
    fields: columns,
    filter: { field: ids.fields.expense.status, op: 'eq', value: 'submitted' },
    sorts: [{ fieldId: ids.fields.expense.spent_on, direction: 'asc' }],
  }),
  defineView({
    id: ids.views.expense.to_reimburse,
    objectId: ids.objects.expense,
    label: 'To reimburse',
    type: 'table',
    icon: 'table',
    position: 3,
    fields: columns,
    filter: {
      and: [
        { field: ids.fields.expense.status, op: 'eq', value: 'approved' },
        { field: ids.fields.expense.paid_with, op: 'eq', value: 'personal' },
      ],
    },
    sorts: [{ fieldId: ids.fields.expense.spent_on, direction: 'asc' }],
  }),
];
