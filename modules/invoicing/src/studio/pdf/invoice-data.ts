import type { RecordData } from '@devias/core';
import { num } from '@devias/core';
import { formatDate } from '@devias/studio';
import { balanceOf, discountOfInvoice, lineAmount, lineTaxRate, paidOf, totalsOf } from '../../lib/totals';
import { INVOICE_STATUSES, PAYMENT_METHODS } from '../../manifest';
import { currencyOf, money, statusOf, text } from '../shared';

/** Everything the invoice prints (PDF and on-screen paper), already formatted: renderers only lay it out. */
export interface InvoiceDocumentData {
  number: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  issuedBy: { name: string; address: string[]; taxId: string | null };
  billTo: { company: string | null; contact: string | null };
  lines: { description: string; quantity: string; unit_price: string; tax: string; amount: string }[];
  totals: { subtotal: string; discount: string | null; tax: string; total: string; paid: string; due: string };
  /** "1,243.01 EUR due by 31 Oct 2026": the headline under the header. */
  summary: string;
  payments: { date: string; method: string; reference: string; amount: string }[];
  waysToPay: string[];
  /** Where the customer can pay online, while there is something to pay. */
  payOnline: string | null;
  notes: string | null;
}

export interface InvoiceDocumentInput {
  /** Fallback issuer name when the invoice has none of its own. */
  issuer: string;
  invoice: RecordData;
  lines: readonly RecordData[];
  payments: readonly RecordData[];
  /** Labels of the related company and contact, when the invoice has them. */
  names: { company?: string | null; contact?: string | null };
}

const dateOf = (value: unknown): string | null => {
  const raw = text(value);

  return raw ? formatDate(raw) || null : null;
};

const quantity = (value: unknown): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(num(value));

const percent = (value: number): string =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}%`;

export const waysToPayOf = (value: unknown): string[] => {
  const labels: string[] = [];

  for (const method of Array.isArray(value) ? value : []) {
    const label = PAYMENT_METHODS.find((candidate) => candidate.value === method)?.label;

    if (label) {
      labels.push(label);
    }
  }

  return labels;
};

export const buildInvoiceDocument = ({
  issuer,
  invoice,
  lines,
  payments,
  names,
}: InvoiceDocumentInput): InvoiceDocumentData => {
  const totals = totalsOf(lines, invoice.tax_rate, discountOfInvoice(invoice));
  const currency = currencyOf(invoice);
  const fmt = (value: number) => money(value, currency);
  const paid = paidOf(payments);
  const due = balanceOf(totals.total, paid);
  const status = statusOf(invoice.status) ?? INVOICE_STATUSES[0];
  const dueDate = dateOf(invoice.due_date);

  return {
    number: text(invoice.number) ?? invoice.id,
    status: status.label,
    issue_date: dateOf(invoice.issue_date),
    due_date: dueDate,
    issuedBy: {
      name: text(invoice.issuer_name) ?? issuer,
      address: (text(invoice.issuer_address) ?? '')
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean),
      taxId: text(invoice.issuer_tax_id),
    },
    billTo: { company: names.company ?? null, contact: names.contact ?? null },
    lines: lines.map((line) => ({
      description: text(line.description) ?? '-',
      quantity: quantity(line.quantity),
      unit_price: fmt(num(line.unit_price)),
      tax: percent(lineTaxRate(line, invoice.tax_rate)),
      amount: fmt(lineAmount(line)),
    })),
    totals: {
      subtotal: fmt(totals.subtotal),
      discount: totals.discount_amount > 0 ? `−${fmt(totals.discount_amount)}` : null,
      tax: fmt(totals.tax),
      total: fmt(totals.total),
      paid: fmt(paid),
      due: fmt(due),
    },
    summary: `${fmt(due)} due${dueDate ? ` by ${dueDate}` : ' on receipt'}`,
    payments: payments.map((payment) => ({
      date: dateOf(payment.paid_on) ?? '-',
      method: PAYMENT_METHODS.find((method) => method.value === payment.method)?.label ?? text(payment.method) ?? '-',
      reference: text(payment.reference) ?? '',
      amount: fmt(num(payment.amount)),
    })),
    waysToPay: waysToPayOf(invoice.payment_methods),
    payOnline: invoice.status === 'sent' && due > 0 ? text(invoice.payment_url) : null,
    notes: text(invoice.notes),
  };
};
