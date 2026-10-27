import { daysBetween } from '@devias/core';
import { describe, expect, it } from 'vitest';
import {
  balanceOf,
  discountOf,
  isOverdue,
  lineAmount,
  lineTaxRate,
  paidOf,
  totalsOf,
  totalsStale,
} from '../src/lib/totals';

describe('invoice totals', () => {
  it('multiplies quantity by unit price to the cent', () => {
    expect(lineAmount({ quantity: 3, unit_price: 19.99 })).toBe(59.97);
    expect(lineAmount({ quantity: 0.1, unit_price: 0.2 })).toBe(0.02);
    expect(lineAmount({ quantity: null, unit_price: 10 })).toBe(0);
  });

  it('adds the lines up and applies the tax rate as a whole percentage', () => {
    const totals = totalsOf(
      [
        { quantity: 2, unit_price: 100 },
        { quantity: 1, unit_price: 50 },
      ],
      21,
    );
    expect(totals).toEqual({ subtotal: 250, discount_amount: 0, tax: 52.5, total: 302.5 });
    expect(totalsOf([], 21)).toEqual({ subtotal: 0, discount_amount: 0, tax: 0, total: 0 });
    expect(totalsOf([{ quantity: 1, unit_price: 100 }], null)).toEqual({
      subtotal: 100,
      discount_amount: 0,
      tax: 0,
      total: 100,
    });
  });

  it('takes a percentage or fixed discount off before tax, spread over the lines', () => {
    const lines = [
      { quantity: 1, unit_price: 100 },
      { quantity: 1, unit_price: 100 },
    ];
    expect(totalsOf(lines, 20, { type: 'percent', value: 10 })).toEqual({
      subtotal: 200,
      discount_amount: 20,
      tax: 36,
      total: 216,
    });
    expect(totalsOf(lines, 20, { type: 'amount', value: 50 })).toEqual({
      subtotal: 200,
      discount_amount: 50,
      tax: 30,
      total: 180,
    });
    // A discount cannot exceed the subtotal.
    expect(totalsOf(lines, 20, { type: 'amount', value: 999 }).total).toBe(0);
    expect(discountOf(100, { type: 'percent', value: -5 })).toBe(0);
  });

  it('taxes each line at its own rate, falling back to the invoice rate', () => {
    const totals = totalsOf(
      [
        { quantity: 1, unit_price: 100, tax_rate: 0 },
        { quantity: 1, unit_price: 100, tax_rate: 10 },
        { quantity: 1, unit_price: 100 },
      ],
      20,
    );
    expect(totals).toEqual({ subtotal: 300, discount_amount: 0, tax: 30, total: 330 });
    expect(lineTaxRate({ tax_rate: 0 }, 20)).toBe(0);
    expect(lineTaxRate({ tax_rate: null }, 20)).toBe(20);
  });

  it('sums payments and reports the balance and staleness', () => {
    expect(paidOf([{ amount: 40 }, { amount: 2.5 }, { amount: 'x' }])).toBe(42.5);
    expect(balanceOf(302.5, 42.5)).toBe(260);
    const totals = { subtotal: 250, discount_amount: 0, tax: 52.5, total: 302.5 };
    expect(totalsStale({ subtotal: 250, tax: 52.5, total: 302.5 }, totals)).toBe(false);
    expect(totalsStale({ subtotal: null, tax: null, total: null }, totals)).toBe(true);
  });

  it('counts an invoice as overdue only when sent and past due', () => {
    expect(isOverdue({ status: 'sent', due_date: '2026-10-01' }, '2026-10-08')).toBe(true);
    expect(isOverdue({ status: 'sent', due_date: '2026-10-08' }, '2026-10-08')).toBe(false);
    expect(isOverdue({ status: 'paid', due_date: '2026-10-01' }, '2026-10-08')).toBe(false);
    expect(isOverdue({ status: 'sent', due_date: null }, '2026-10-08')).toBe(false);
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });
});
