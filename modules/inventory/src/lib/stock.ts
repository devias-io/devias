import { AGGREGATE_MAX_GROUPS, type AggregateQuery, type AggregateResult, andFilters, type Filter } from '@devias/core';
import { UNITS } from '@devias/mod-products/manifest';
import type { Direction } from '../manifest/objects';

/**
 * Stock on hand is never stored: it is what came in minus what went out, added up from the moves whenever it is
 * asked for, so a move recorded anywhere (the studio, the agent, a workflow, the API) counts at once. The server's
 * actions and the studio's blocks share this arithmetic.
 */

/** Quantities keep three decimals (meters of cable, kilograms of plaster) without float noise. */
export const roundQuantity = (value: number): number => Math.round(value * 1000) / 1000;

/** The aggregate that adds up the moves of one direction, grouped by product or location, within `filter`. */
export const movesTotal = (
  direction: Direction,
  groupBy?: 'product' | 'location',
  filter?: Filter,
): AggregateQuery => ({
  object: 'stock_move',
  filter: andFilters({ field: 'direction', op: 'eq', value: direction }, filter),
  ...(groupBy ? { groupBy, limit: AGGREGATE_MAX_GROUPS } : {}),
  measures: [{ fn: 'sum', field: 'quantity' }],
});

const sumOf = (values: Record<string, unknown>): number => {
  const sum = values['sum.quantity'];

  return typeof sum === 'number' ? sum : 0;
};

export interface OnHand {
  /** The product's or location's name. */
  label: string;
  onHand: number;
}

/** Stock on hand by group (product or location id): in minus out, with each group's label. */
export const onHandOf = (ins: AggregateResult, outs: AggregateResult): Map<string, OnHand> => {
  const levels = new Map<string, OnHand>();
  const add = (result: AggregateResult, sign: 1 | -1) => {
    for (const group of result.groups) {
      if (typeof group.key !== 'string') {
        continue;
      }

      const current = levels.get(group.key) ?? { label: group.label ?? group.key, onHand: 0 };
      levels.set(group.key, { ...current, onHand: roundQuantity(current.onHand + sign * sumOf(group.values)) });
    }
  };
  add(ins, 1);
  add(outs, -1);

  return levels;
};

/** The total on hand, over every group: in minus out. */
export const totalOnHand = (ins: AggregateResult, outs: AggregateResult): number =>
  roundQuantity(sumOf(ins.total.values) - sumOf(outs.total.values));

/** A quantity with the product's unit: "12.5 m", "3 pcs". */
export const formatQuantity = (value: number, unit?: unknown): string => {
  const short = UNITS.find((candidate) => candidate.value === unit)?.short ?? 'pcs';

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)} ${short}`;
};

/** Low on stock: at or below the reorder point, when the product has one. */
export const isLow = (onHand: number, reorderPoint: unknown): boolean =>
  typeof reorderPoint === 'number' && onHand <= reorderPoint;
