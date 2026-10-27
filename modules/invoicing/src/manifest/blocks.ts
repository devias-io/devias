import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the module's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.receivables,
    label: 'Receivables',
    description: 'Sent invoices, their total and how many are overdue.',
    surfaces: ['home'],
  }),
  defineBlock({
    id: ids.blocks.collected,
    label: 'Money in',
    description: 'Money collected on invoices over a chosen period.',
    surfaces: ['home'],
  }),
  defineBlock({
    id: ids.blocks.confirm_payment,
    label: 'Confirm a payment',
    description: 'Approval card for recording an invoice payment.',
    surfaces: ['approval'],
  }),
  defineBlock({
    id: ids.blocks.invoice_header,
    label: 'Invoice header',
    description: "The invoice's number, status, customer and actions. Use it as the layout's `header`.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.invoice_figures,
    label: 'Invoice figures',
    description: 'What is left to pay, the total, what is paid and the due date.',
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.invoice_lines,
    label: 'Items',
    description: "The invoice's items and totals.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.invoice_payments,
    label: 'Payments',
    description: 'The payments recorded against the invoice.',
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.invoice_details,
    label: 'Invoice details',
    description: "The invoice's details in groups: customer, invoice, terms.",
    surfaces: ['record'],
  }),
];
