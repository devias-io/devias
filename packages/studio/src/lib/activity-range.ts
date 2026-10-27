import type { SignalRange } from '@devias/ui';

export type ActivityRange = '7d' | '1m' | '3m';

export const ACTIVITY_RANGES: (SignalRange & {
  id: ActivityRange;
  days: number;
  /** Under the figure: "Last 7 days". */
  period: string;
  /** After a count: "12 runs in 7 days". */
  short: string;
})[] = [
  { id: '7d', label: '7D', days: 7, period: 'Last 7 days', short: 'in 7 days' },
  { id: '1m', label: '1M', days: 30, period: 'Last 30 days', short: 'in 30 days' },
  { id: '3m', label: '3M', days: 90, period: 'Last 90 days', short: 'in 90 days' },
];

export const activityRange = (id: ActivityRange) =>
  ACTIVITY_RANGES.find((range) => range.id === id) ?? (ACTIVITY_RANGES[0] as (typeof ACTIVITY_RANGES)[number]);
