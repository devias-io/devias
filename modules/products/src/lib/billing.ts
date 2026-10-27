import type { Interval } from '../manifest/objects';

/** How a price is billed, as the handful of schedules people use; anything else is "every N intervals". */
export const CADENCES = [
  { key: 'once', label: 'One time', type: 'one_time', interval: null, interval_count: 1 },
  { key: 'day', label: 'Daily', type: 'recurring', interval: 'day', interval_count: 1 },
  { key: 'week', label: 'Weekly', type: 'recurring', interval: 'week', interval_count: 1 },
  { key: 'month', label: 'Monthly', type: 'recurring', interval: 'month', interval_count: 1 },
  { key: 'quarter', label: 'Every 3 months', type: 'recurring', interval: 'month', interval_count: 3 },
  { key: 'half', label: 'Every 6 months', type: 'recurring', interval: 'month', interval_count: 6 },
  { key: 'year', label: 'Yearly', type: 'recurring', interval: 'year', interval_count: 1 },
] as const;
export type CadenceKey = (typeof CADENCES)[number]['key'];

/** What a price stores for a schedule. */
export interface Billing {
  type: 'one_time' | 'recurring';
  interval: Interval | null;
  interval_count: number;
}

/** A price record, or anything with its billing fields. */
type PriceLike = Record<string, unknown>;

const count = (value: unknown): number => (typeof value === 'number' && value >= 1 ? Math.round(value) : 1);

/** The billing a price record stores (an unset type is one time; a recurring price without an interval is monthly). */
export const billingOf = (price: PriceLike): Billing => {
  if (price.type !== 'recurring') {
    return { type: 'one_time', interval: null, interval_count: 1 };
  }

  const interval = (['day', 'week', 'month', 'year'] as const).find((value) => value === price.interval) ?? 'month';

  return { type: 'recurring', interval, interval_count: count(price.interval_count) };
};

/** The words for a billing: "One time", "Monthly", "Every 2 weeks". */
export const billingLabel = (billing: Billing): string => {
  const preset = CADENCES.find(
    (cadence) =>
      cadence.type === billing.type &&
      cadence.interval === billing.interval &&
      cadence.interval_count === billing.interval_count,
  );

  if (preset) {
    return preset.label;
  }

  return `Every ${billing.interval_count} ${billing.interval}s`;
};

/** The preset a billing is, or null for a schedule of its own. */
export const cadenceKeyOf = (billing: Billing): CadenceKey | null =>
  CADENCES.find(
    (cadence) =>
      cadence.type === billing.type &&
      cadence.interval === billing.interval &&
      cadence.interval_count === billing.interval_count,
  )?.key ?? null;

/** What to store for a preset. */
export const billingOfCadence = (key: CadenceKey): Billing => {
  const cadence = CADENCES.find((candidate) => candidate.key === key) ?? CADENCES[0];

  return { type: cadence.type, interval: cadence.interval, interval_count: cadence.interval_count };
};
