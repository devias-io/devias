import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids } from './ids';

/** The currency an expense is in when none is given. */
export const CURRENCY = 'EUR';

/** What an expense was for, in the words of a business that does work on site. */
export const EXPENSE_CATEGORIES = [
  { value: 'materials', label: 'Materials', color: 'neutral' },
  { value: 'tools', label: 'Tools and equipment', color: 'neutral' },
  { value: 'vehicle', label: 'Fuel and vehicles', color: 'neutral' },
  { value: 'travel', label: 'Travel', color: 'neutral' },
  { value: 'meals', label: 'Meals', color: 'neutral' },
  { value: 'software', label: 'Software and subscriptions', color: 'neutral' },
  { value: 'office', label: 'Office', color: 'neutral' },
  { value: 'other', label: 'Other', color: 'neutral' },
] as const;

/** Draft → submitted → approved (→ reimbursed when someone paid it themselves), or rejected. */
export const EXPENSE_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'neutral' },
  { value: 'submitted', label: 'Submitted', color: 'neutral' },
  { value: 'approved', label: 'Approved', color: 'neutral' },
  { value: 'rejected', label: 'Rejected', color: 'neutral' },
  { value: 'reimbursed', label: 'Reimbursed', color: 'neutral' },
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]['value'];

/** Who paid: the business, or a person who is owed the money back. */
export const PAID_WITH = [
  { value: 'company', label: 'Company card or account' },
  { value: 'personal', label: 'Personal (to reimburse)' },
  { value: 'cash', label: 'Petty cash' },
] as const;

const expense = defineObject({
  id: ids.objects.expense,
  nameSingular: 'expense',
  namePlural: 'expenses',
  labelSingular: 'Expense',
  labelPlural: 'Expenses',
  icon: 'wallet',
  description: 'Money the business spent: what for, how much, who paid.',
  primaryFieldId: ids.fields.expense.description,
  fields: [
    defineField({
      id: ids.fields.expense.description,
      name: 'description',
      label: 'Description',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.expense.amount,
      name: 'amount',
      label: 'Amount',
      type: 'money',
      settings: { currencyCode: CURRENCY },
      description: 'What was paid, tax included.',
      isRequired: true,
      position: 1,
    }),
    defineField({
      id: ids.fields.expense.currency,
      name: 'currency',
      label: 'Currency',
      type: 'currency',
      defaultValue: CURRENCY,
      position: 2,
    }),
    defineField({
      id: ids.fields.expense.tax,
      name: 'tax',
      label: 'VAT',
      type: 'money',
      settings: { currencyCode: CURRENCY },
      description: 'The VAT included in the amount, from the receipt.',
      position: 3,
    }),
    defineField({
      id: ids.fields.expense.spent_on,
      name: 'spent_on',
      label: 'Date',
      type: 'date',
      isRequired: true,
      position: 4,
    }),
    defineField({
      id: ids.fields.expense.category,
      name: 'category',
      label: 'Category',
      type: 'select',
      settings: { options: [...EXPENSE_CATEGORIES] },
      defaultValue: 'other',
      position: 5,
    }),
    defineField({
      id: ids.fields.expense.status,
      name: 'status',
      label: 'Status',
      type: 'select',
      settings: { options: [...EXPENSE_STATUSES] },
      defaultValue: 'draft',
      isRequired: true,
      position: 6,
    }),
    defineField({
      id: ids.fields.expense.paid_with,
      name: 'paid_with',
      label: 'Paid with',
      type: 'select',
      settings: { options: PAID_WITH.map((option) => ({ ...option, color: 'neutral' })) },
      defaultValue: 'company',
      position: 7,
    }),
    defineField({
      id: ids.fields.expense.supplier,
      name: 'supplier',
      label: 'Supplier',
      type: 'relation',
      icon: 'building-2',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.company,
        inverseLabel: 'Expenses',
      },
      position: 8,
    }),
    defineField({
      id: ids.fields.expense.deal,
      name: 'deal',
      label: 'Deal',
      type: 'relation',
      icon: 'target',
      description: 'The job it was spent on, to see what a deal really cost.',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.deal,
        inverseLabel: 'Expenses',
      },
      position: 9,
    }),
    defineField({
      id: ids.fields.expense.receipt_url,
      name: 'receipt_url',
      label: 'Receipt',
      type: 'url',
      description: 'A link to the receipt or invoice from the supplier.',
      position: 10,
    }),
    defineField({
      id: ids.fields.expense.notes,
      name: 'notes',
      label: 'Notes',
      type: 'text',
      settings: { multiline: true },
      position: 11,
    }),
  ],
});
export type Expense = InferRecord<typeof expense>;

/** The objects of the module, in the order its manifest lists them. */
export const objects = [expense];
