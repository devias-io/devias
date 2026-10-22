import type { AggregateResult } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { formatQuantity, isLow, movesTotal, onHandOf, totalOnHand } from '../src/lib/stock';

const result = (groups: [string, string, number][], total: number): AggregateResult => ({
  object: 'stock_move',
  groupBy: 'location',
  groups: groups.map(([key, label, sum]) => ({ key, label, count: 1, values: { 'sum.quantity': sum } })),
  total: { count: groups.length, values: { 'sum.quantity': total } },
  truncated: false,
});

describe('stock on hand', () => {
  it('adds the moves of one direction up, grouped and filtered', () => {
    expect(movesTotal('in', 'product', { field: 'location', op: 'eq', value: 'l1' })).toEqual({
      object: 'stock_move',
      filter: {
        and: [
          { field: 'direction', op: 'eq', value: 'in' },
          { field: 'location', op: 'eq', value: 'l1' },
        ],
      },
      groupBy: 'product',
      limit: 500,
      measures: [{ fn: 'sum', field: 'quantity' }],
    });
    expect(movesTotal('out')).toEqual({
      object: 'stock_move',
      filter: { field: 'direction', op: 'eq', value: 'out' },
      measures: [{ fn: 'sum', field: 'quantity' }],
    });
  });

  it('is what came in minus what went out, per group and in total, without float noise', () => {
    const ins = result(
      [
        ['warehouse', 'Warehouse', 100.1],
        ['van', 'Van 1', 20],
      ],
      120.1,
    );
    const outs = result(
      [
        ['warehouse', 'Warehouse', 30.2],
        ['site', 'Site A', 5],
      ],
      35.2,
    );
    expect([...onHandOf(ins, outs)]).toEqual([
      ['warehouse', { label: 'Warehouse', onHand: 69.9 }],
      ['van', { label: 'Van 1', onHand: 20 }],
      ['site', { label: 'Site A', onHand: -5 }],
    ]);
    expect(totalOnHand(ins, outs)).toBe(84.9);
  });

  it('is low at or below the reorder point, never without one, and reads in the product unit', () => {
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(6, 5)).toBe(false);
    expect(isLow(0, null)).toBe(false);
    expect(formatQuantity(12.5, 'meter')).toMatch(/^12[.,]5 m$/);
    expect(formatQuantity(3, undefined)).toBe('3 pcs');
  });
});
