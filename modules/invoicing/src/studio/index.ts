import { defineModuleStudio } from '@devias/core';
import { manifest } from '../manifest';
import { collectedBlock } from './blocks/collected';
import { confirmPaymentBlock } from './blocks/confirm-payment';
import { receivablesBlock } from './blocks/receivables';
import { billingPages } from './pages/billing';
import {
  invoiceDetailsBlock,
  invoiceFiguresBlock,
  invoiceHeaderBlock,
  invoiceLinesBlock,
  invoicePaymentsBlock,
} from './record';

/**
 * Invoicing as a module: its manifest (invoices, lines, payments, and the invoice layout), the blocks of the invoice page
 * (a draft is edited in place, a sent, paid or void invoice is final), the Money in and Receivables blocks on Home, the card that asks you to approve a payment the agent records, and the
 * Billing pages.
 */
export const invoicing = defineModuleStudio(manifest, {
  blocks: [
    collectedBlock,
    receivablesBlock,
    confirmPaymentBlock,
    invoiceHeaderBlock,
    invoiceFiguresBlock,
    invoiceLinesBlock,
    invoicePaymentsBlock,
    invoiceDetailsBlock,
  ],
  pages: billingPages,
});

export default invoicing;
