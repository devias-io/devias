import type { RecordData } from '@devias/core';
import { daysBetween, localDate, num } from '@devias/core';
import { totalsOf } from '../../lib/totals';
import { CURRENCY } from '../../manifest';
import { text } from '../shared';

/** The invoice composer's form, and the pure steps between it and invoice records. */

export interface ComposerLine {
  /** The saved line's id; absent for a line that does not exist yet. */
  id?: string;
  key: string;
  description: string;
  quantity: string;
  unit_price: string;
  /** Empty means no tax on this item. */
  tax_rate: string;
}

export interface ComposerParty {
  id: string;
  label: string;
}

export interface ComposerForm {
  number: string;
  currency: string;
  company: ComposerParty | null;
  contact: ComposerParty | null;
  lines: ComposerLine[];
  discountOn: boolean;
  discount_type: 'percent' | 'amount';
  discount_value: string;
  payment_methods: string[];
  issue_date: string;
  /** Days between issue and due, or `null` for a due date picked by hand. */
  termsDays: number | null;
  due_date: string;
  issuer_name: string;
  issuer_address: string;
  taxIdOn: boolean;
  issuer_tax_id: string;
  noteOn: boolean;
  notes: string;
}

export const TERMS = [
  { days: 0, label: 'Due on receipt' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
] as const;

let counter = 0;
export const lineKey = (): string => {
  counter += 1;

  return `line-${counter}`;
};

export const emptyLine = (): ComposerLine => ({
  key: lineKey(),
  description: '',
  quantity: '1',
  unit_price: '',
  tax_rate: '',
});

/** A YYYY-MM-DD date moved by whole days. */
export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);

  return localDate(new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
};

/** The preset an issue and due date correspond to, else `null` (a custom date). */
export const termsFor = (issueDate: string, dueDate: string): number | null => {
  if (!issueDate || !dueDate) {
    return null;
  }

  const days = daysBetween(issueDate, dueDate);

  return TERMS.some((term) => term.days === days) ? days : null;
};

/** The number after the latest one: `INV-009` → `INV-010`, keeping the prefix and the padding. */
export const nextInvoiceNumber = (latest: string | null | undefined): string => {
  const match = /^(.*?)(\d+)$/.exec((latest ?? '').trim());

  if (!match) {
    return 'INV-001';
  }

  const digits = match[2] ?? '';

  return `${match[1] ?? ''}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
};

export const parseNumber = (value: string): number => {
  const parsed = Number(value.replace(',', '.'));

  return Number.isFinite(parsed) ? parsed : 0;
};

const methodsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];

/** A fresh form: the next number, today's date, and the issuer details and ways to pay of the last invoice. */
export const newForm = (today: string, latest: RecordData | undefined, issuerFallback: string): ComposerForm => ({
  number: nextInvoiceNumber(text(latest?.number)),
  currency: text(latest?.currency) ?? CURRENCY,
  company: null,
  contact: null,
  lines: [emptyLine()],
  discountOn: false,
  discount_type: 'percent',
  discount_value: '',
  payment_methods: latest ? methodsOf(latest.payment_methods) : ['bank_transfer'],
  issue_date: today,
  termsDays: 30,
  due_date: addDays(today, 30),
  issuer_name: text(latest?.issuer_name) ?? issuerFallback,
  issuer_address: text(latest?.issuer_address) ?? '',
  taxIdOn: Boolean(text(latest?.issuer_tax_id)),
  issuer_tax_id: text(latest?.issuer_tax_id) ?? '',
  noteOn: false,
  notes: '',
});

export const formFromInvoice = (
  invoice: RecordData,
  lines: readonly RecordData[],
  parties: { company: ComposerParty | null; contact: ComposerParty | null },
): ComposerForm => {
  const issueDate = text(invoice.issue_date) ?? '';
  const dueDate = text(invoice.due_date) ?? '';

  return {
    number: text(invoice.number) ?? '',
    currency: text(invoice.currency) ?? CURRENCY,
    company: parties.company,
    contact: parties.contact,
    lines: lines.length
      ? lines.map((line) => ({
          id: line.id,
          key: line.id,
          description: text(line.description) ?? '',
          quantity: String(num(line.quantity)),
          unit_price: line.unit_price == null ? '' : String(num(line.unit_price)),
          tax_rate: typeof line.tax_rate === 'number' ? String(line.tax_rate) : '',
        }))
      : [emptyLine()],
    discountOn: num(invoice.discount_value) > 0,
    discount_type: invoice.discount_type === 'amount' ? 'amount' : 'percent',
    discount_value: num(invoice.discount_value) > 0 ? String(num(invoice.discount_value)) : '',
    payment_methods: methodsOf(invoice.payment_methods),
    issue_date: issueDate,
    termsDays: termsFor(issueDate, dueDate),
    due_date: dueDate,
    issuer_name: text(invoice.issuer_name) ?? '',
    issuer_address: text(invoice.issuer_address) ?? '',
    taxIdOn: Boolean(text(invoice.issuer_tax_id)),
    issuer_tax_id: text(invoice.issuer_tax_id) ?? '',
    noteOn: Boolean(text(invoice.notes)),
    notes: text(invoice.notes) ?? '',
  };
};

/** The form's lines as line records, skipping rows left blank. `id` is the saved line's, when it has one. */
export const lineRecords = (form: ComposerForm): (Record<string, unknown> & { id?: string })[] =>
  form.lines
    .filter((line) => line.description.trim() || parseNumber(line.unit_price) > 0)
    .map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      description: line.description.trim() || 'Item',
      quantity: parseNumber(line.quantity),
      unit_price: parseNumber(line.unit_price),
      tax_rate: line.tax_rate.trim() === '' ? null : parseNumber(line.tax_rate),
    }));

const discountOfForm = (form: ComposerForm) =>
  form.discountOn ? { type: form.discount_type, value: parseNumber(form.discount_value) } : null;

/** What the form's lines come to: subtotal, discount, tax and total. Items without a rate carry no tax. */
export const formTotals = (form: ComposerForm) => totalsOf(lineRecords(form), 0, discountOfForm(form));

/** The invoice's own fields for a status, with the totals its lines come to. */
export const invoiceRecord = (form: ComposerForm, status: 'draft' | 'sent'): Record<string, unknown> => {
  const discount = discountOfForm(form);
  const dueDate = form.termsDays === 0 ? form.issue_date : form.due_date;

  return {
    number: form.number.trim(),
    status,
    currency: form.currency,
    company: form.company?.id ?? null,
    contact: form.contact?.id ?? null,
    issue_date: form.issue_date || null,
    due_date: dueDate || null,
    tax_rate: 0,
    discount_type: form.discount_type,
    discount_value: discount ? discount.value : null,
    payment_methods: form.payment_methods,
    issuer_name: form.issuer_name.trim() || null,
    issuer_address: form.issuer_address.trim() || null,
    issuer_tax_id: form.taxIdOn ? form.issuer_tax_id.trim() || null : null,
    notes: form.noteOn ? form.notes.trim() || null : null,
    ...formTotals(form),
  };
};

/** Problems that stop an invoice being sent (a draft can be saved with anything). */
export const sendProblems = (form: ComposerForm): string[] => {
  const problems: string[] = [];

  if (!form.number.trim()) {
    problems.push('Give the invoice a number.');
  }

  if (!form.company) {
    problems.push('Choose a customer.');
  }

  if (lineRecords(form).length === 0) {
    problems.push('Add at least one item.');
  }

  if (form.termsDays === null && !form.due_date) {
    problems.push('Pick a due date.');
  }

  return problems;
};
