import { num, round2 } from '@devias/core';
/**
 * Pure invoice arithmetic, shared by the studio blocks and the server actions so both agree to the cent.
 * Money is kept to two decimals; `tax_rate` is a whole percentage (21 means 21%).
 */

/** Any record with `quantity` and `unit_price` fields (typed loosely: records are plain JSON). */
export type LineLike = Record<string, unknown>;

/** Any record with an `amount` field. */
export type PaymentLike = Record<string, unknown>;

export type InvoiceTotals = { subtotal: number; discount_amount: number; tax: number; total: number };

/** How an invoice is discounted: a percentage or a fixed amount, taken off before tax. */
export type DiscountLike = { type?: unknown; value?: unknown } | null | undefined;

export const lineAmount = (line: LineLike): number => round2(num(line.quantity) * num(line.unit_price));

/** The tax rate of a line: its own when set, else the invoice's. */
export const lineTaxRate = (line: LineLike, fallback: unknown): number =>
  typeof line.tax_rate === 'number' && Number.isFinite(line.tax_rate) ? line.tax_rate : num(fallback);

/** What a discount comes to on a subtotal; never more than the subtotal. */
export const discountOf = (subtotal: number, discount: DiscountLike): number => {
  const value = num(discount?.value);

  if (value <= 0 || subtotal <= 0) {
    return 0;
  }

  const amount = discount?.type === 'amount' ? value : (subtotal * value) / 100;

  return round2(Math.min(amount, subtotal));
};

/** The discount stored on an invoice record. */
export const discountOfInvoice = (invoice: Record<string, unknown>): DiscountLike => ({
  type: invoice.discount_type,
  value: invoice.discount_value,
});

/**
 * Subtotal, discount, tax and total. The discount comes off first and is spread over the lines pro rata, so each
 * line is taxed at its own rate on what is left of it. `tax_rate` is the invoice's default, a whole percentage.
 */
export const totalsOf = (lines: readonly LineLike[], taxRate: unknown, discount?: DiscountLike): InvoiceTotals => {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineAmount(line), 0));
  const discountAmount = discountOf(subtotal, discount);
  const kept = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  const tax = round2(
    lines.reduce((sum, line) => sum + (lineAmount(line) * kept * lineTaxRate(line, taxRate)) / 100, 0),
  );

  return { subtotal, discount_amount: discountAmount, tax, total: round2(subtotal - discountAmount + tax) };
};

export const paidOf = (payments: readonly PaymentLike[]): number =>
  round2(payments.reduce((sum, payment) => sum + num(payment.amount), 0));

export const balanceOf = (total: number, paid: number): number => round2(total - paid);

/** The totals stored on the invoice differ from what its lines add up to. */
export const totalsStale = (invoice: Record<string, unknown>, totals: InvoiceTotals): boolean =>
  num(invoice.subtotal) !== totals.subtotal ||
  num(invoice.discount_amount) !== totals.discount_amount ||
  num(invoice.tax) !== totals.tax ||
  num(invoice.total) !== totals.total;

/** Sent, past its due date and not settled. `today` is a YYYY-MM-DD string. */
export const isOverdue = (invoice: Record<string, unknown>, today: string): boolean =>
  invoice.status === 'sent' &&
  typeof invoice.due_date === 'string' &&
  invoice.due_date.length > 0 &&
  invoice.due_date < today;
