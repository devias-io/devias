import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids } from './ids';

/** The invoicing objects: invoices, their lines and the payments against them. Amounts share one currency. */

export const CURRENCY = 'EUR';

/** The currencies the invoice composer offers; the invoice's `currency` field accepts any code, `CURRENCY` is the default. */
export const CURRENCIES = [
  { value: 'EUR', label: 'EUR · Euro' },
  { value: 'USD', label: 'USD · US dollar' },
  { value: 'GBP', label: 'GBP · Pound sterling' },
  { value: 'RON', label: 'RON · Romanian leu' },
  { value: 'CHF', label: 'CHF · Swiss franc' },
  { value: 'CAD', label: 'CAD · Canadian dollar' },
  { value: 'AUD', label: 'AUD · Australian dollar' },
] as const;

export const DISCOUNT_TYPES = [
  { value: 'percent', label: 'Percentage' },
  { value: 'amount', label: 'Fixed amount' },
] as const;

export const INVOICE_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'neutral' },
  { value: 'sent', label: 'Sent', color: 'neutral' },
  { value: 'paid', label: 'Paid', color: 'green' },
  { value: 'void', label: 'Void', color: 'red' },
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]['value'];

export const PAYMENT_METHOD_VALUES = ['bank_transfer', 'card', 'cash', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];
export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly { value: PaymentMethod; label: string }[];

const invoice = defineObject({
  id: ids.objects.invoice,
  nameSingular: 'invoice',
  namePlural: 'invoices',
  labelSingular: 'Invoice',
  labelPlural: 'Invoices',
  icon: 'receipt',
  description: 'A bill with lines, settled by payments.',
  primaryFieldId: ids.fields.invoice.number,
  // Only a draft can be deleted: once sent, an invoice is void or paid, never removed. Its lines go with it.
  deleteWhen: { field: 'status', op: 'eq', value: 'draft' },
  fields: [
    defineField({
      id: ids.fields.invoice.number,
      name: 'number',
      label: 'Number',
      type: 'text',
      isRequired: true,
      isUnique: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.invoice.status,
      name: 'status',
      label: 'Status',
      type: 'select',
      settings: { options: [...INVOICE_STATUSES] },
      defaultValue: 'draft',
      isRequired: true,
      position: 1,
    }),
    defineField({
      id: ids.fields.invoice.company,
      name: 'company',
      label: 'Company',
      type: 'relation',
      icon: 'building-2',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.company,
        inverseLabel: 'Invoices',
      },
      position: 2,
    }),
    defineField({
      id: ids.fields.invoice.contact,
      name: 'contact',
      label: 'Contact',
      type: 'relation',
      icon: 'user',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.person,
        inverseLabel: 'Invoices',
      },
      position: 3,
    }),
    defineField({
      id: ids.fields.invoice.deal,
      name: 'deal',
      label: 'Deal',
      type: 'relation',
      icon: 'target',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: crm.objects.deal,
        inverseLabel: 'Invoices',
      },
      position: 4,
    }),
    defineField({
      id: ids.fields.invoice.issue_date,
      name: 'issue_date',
      label: 'Issue date',
      type: 'date',
      position: 5,
    }),
    defineField({
      id: ids.fields.invoice.due_date,
      name: 'due_date',
      label: 'Due date',
      type: 'date',
      position: 6,
    }),
    defineField({
      id: ids.fields.invoice.tax_rate,
      name: 'tax_rate',
      label: 'Tax rate',
      type: 'number',
      settings: { precision: 2, format: 'percent' },
      defaultValue: 0,
      position: 7,
    }),
    defineField({
      id: ids.fields.invoice.subtotal,
      name: 'subtotal',
      label: 'Subtotal',
      type: 'money',
      description: 'The lines added up; kept current by the page and recalculate_invoice.',
      settings: { currencyCode: CURRENCY },
      position: 8,
    }),
    defineField({
      id: ids.fields.invoice.tax,
      name: 'tax',
      label: 'Tax',
      type: 'money',
      settings: { currencyCode: CURRENCY },
      position: 9,
    }),
    defineField({
      id: ids.fields.invoice.total,
      name: 'total',
      label: 'Total',
      type: 'money',
      settings: { currencyCode: CURRENCY },
      position: 10,
    }),
    defineField({
      id: ids.fields.invoice.notes,
      name: 'notes',
      label: 'Notes',
      type: 'text',
      settings: { multiline: true },
      position: 11,
    }),
    defineField({
      id: ids.fields.invoice.currency,
      name: 'currency',
      label: 'Currency',
      type: 'currency',
      defaultValue: CURRENCY,
      position: 12,
    }),
    defineField({
      id: ids.fields.invoice.discount_type,
      name: 'discount_type',
      label: 'Discount type',
      type: 'select',
      settings: { options: DISCOUNT_TYPES.map((d) => ({ ...d, color: 'neutral' })) },
      defaultValue: 'percent',
      position: 13,
    }),
    defineField({
      id: ids.fields.invoice.discount_value,
      name: 'discount_value',
      label: 'Discount',
      type: 'number',
      description: 'Percentage or amount, by the discount type; taken off before tax.',
      settings: { precision: 2 },
      position: 14,
    }),
    defineField({
      id: ids.fields.invoice.discount_amount,
      name: 'discount_amount',
      label: 'Discount amount',
      type: 'money',
      description: 'What the discount comes to; kept current with the other totals.',
      settings: { currencyCode: CURRENCY },
      position: 15,
    }),
    defineField({
      id: ids.fields.invoice.payment_methods,
      name: 'payment_methods',
      label: 'Ways to pay',
      type: 'multi_select',
      description: 'The payment methods the invoice offers its customer.',
      settings: { options: PAYMENT_METHODS.map((m) => ({ ...m, color: 'neutral' })) },
      position: 16,
    }),
    defineField({
      id: ids.fields.invoice.issuer_name,
      name: 'issuer_name',
      label: 'Issuer',
      type: 'text',
      description: 'Who issues the invoice, as printed on it.',
      position: 17,
    }),
    defineField({
      id: ids.fields.invoice.issuer_address,
      name: 'issuer_address',
      label: 'Issuer address',
      type: 'text',
      settings: { multiline: true },
      position: 18,
    }),
    defineField({
      id: ids.fields.invoice.issuer_tax_id,
      name: 'issuer_tax_id',
      label: 'Issuer tax ID',
      type: 'text',
      description: 'Printed on the invoice when filled in.',
      position: 19,
    }),
    defineField({
      id: ids.fields.invoice.payment_url,
      name: 'payment_url',
      label: 'Payment link',
      type: 'url',
      description: 'Where the customer pays online; set by a payment provider, cleared once paid.',
      position: 20,
    }),
  ],
});
export type Invoice = InferRecord<typeof invoice>;

const invoiceLine = defineObject({
  id: ids.objects.invoice_line,
  nameSingular: 'invoice_line',
  namePlural: 'invoice_lines',
  labelSingular: 'Invoice line',
  labelPlural: 'Invoice lines',
  icon: 'list',
  description: 'One billed item: a description, quantity and unit price.',
  primaryFieldId: ids.fields.invoice_line.description,
  fields: [
    defineField({
      id: ids.fields.invoice_line.description,
      name: 'description',
      label: 'Description',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.invoice_line.invoice,
      name: 'invoice',
      label: 'Invoice',
      type: 'relation',
      icon: 'receipt',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.invoice,
        inverseLabel: 'Lines',
        onDelete: 'cascade',
      },
      position: 1,
    }),
    defineField({
      id: ids.fields.invoice_line.quantity,
      name: 'quantity',
      label: 'Quantity',
      type: 'number',
      settings: { precision: 2 },
      defaultValue: 1,
      position: 2,
    }),
    defineField({
      id: ids.fields.invoice_line.unit_price,
      name: 'unit_price',
      label: 'Unit price',
      type: 'money',
      settings: { currencyCode: CURRENCY },
      position: 3,
    }),
    defineField({
      id: ids.fields.invoice_line.tax_rate,
      name: 'tax_rate',
      label: 'Tax rate',
      type: 'number',
      description: 'Tax on this item as a percentage; empty uses the invoice’s rate.',
      settings: { precision: 2, format: 'percent' },
      position: 4,
    }),
  ],
});
export type InvoiceLine = InferRecord<typeof invoiceLine>;

const payment = defineObject({
  id: ids.objects.payment,
  nameSingular: 'payment',
  namePlural: 'payments',
  labelSingular: 'Payment',
  labelPlural: 'Payments',
  icon: 'dollar-sign',
  description: 'Money received against an invoice.',
  primaryFieldId: ids.fields.payment.reference,
  fields: [
    defineField({
      id: ids.fields.payment.invoice,
      name: 'invoice',
      label: 'Invoice',
      type: 'relation',
      icon: 'receipt',
      isRequired: true,
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.invoice,
        inverseLabel: 'Payments',
        onDelete: 'cascade',
      },
      position: 0,
    }),
    defineField({
      id: ids.fields.payment.amount,
      name: 'amount',
      label: 'Amount',
      type: 'money',
      isRequired: true,
      settings: { currencyCode: CURRENCY },
      position: 1,
    }),
    defineField({
      id: ids.fields.payment.paid_on,
      name: 'paid_on',
      label: 'Paid on',
      type: 'date',
      position: 2,
    }),
    defineField({
      id: ids.fields.payment.method,
      name: 'method',
      label: 'Method',
      type: 'select',
      settings: { options: [...PAYMENT_METHODS] },
      defaultValue: 'bank_transfer',
      position: 3,
    }),
    defineField({
      id: ids.fields.payment.reference,
      name: 'reference',
      label: 'Reference',
      type: 'text',
      description: 'The bank or card reference, for reconciliation.',
      position: 4,
    }),
  ],
});
export type Payment = InferRecord<typeof payment>;

/** The objects of the module, in the order its manifest lists them. */
export const objects = [invoice, invoiceLine, payment];
