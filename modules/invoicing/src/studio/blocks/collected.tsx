import { type AggregateQuery, defineBlockComponent, localDate } from '@devias/core';
import { links, useAggregate, useWorkspace } from '@devias/studio';
import { SignalCard, TrendChart, type TrendPoint } from '@devias/ui';
import { useMemo, useState } from 'react';
import { ids } from '../../manifest';
import { money, SeeMore } from '../shared';

/** The periods the card shows, and how finely each one is drawn: by day, by week, by month. */
const RANGES = [
  { id: '7d', label: '7D', days: 7, by: 'day', meta: 'Last 7 days' },
  { id: '1m', label: '1M', days: 30, by: 'day', meta: 'Last 30 days' },
  { id: '3m', label: '3M', days: 91, by: 'week', meta: 'Last 3 months' },
  { id: '1y', label: '1Y', days: 365, by: 'month', meta: 'Last 12 months' },
] as const;

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** Where a period starts: `days` back, or for a year the first of the month eleven months back (twelve whole months). */
const startOf = (today: Date, range: (typeof RANGES)[number]): Date =>
  range.by === 'month' ? new Date(today.getFullYear(), today.getMonth() - 11, 1) : addDays(today, -range.days + 1);

/** The chart's points from `from` to today, from what was paid each day. */
const pointsOf = (paidByDay: Map<string, number>, from: Date, today: Date, range: (typeof RANGES)[number]) => {
  const count = Math.round((today.getTime() - from.getTime()) / 86_400_000) + 1;
  const days = Array.from({ length: count }, (_, index) => addDays(from, index));
  const paidOn = (day: Date) => paidByDay.get(localDate(day)) ?? 0;

  if (range.by === 'day') {
    return days.map((day): TrendPoint => ({ label: dayLabel.format(day), value: paidOn(day) }));
  }

  const buckets = new Map<string, TrendPoint>();

  for (const day of days) {
    const key =
      range.by === 'week'
        ? localDate(addDays(day, -((day.getDay() + 6) % 7)))
        : `${day.getFullYear()}-${day.getMonth()}`;
    const bucket = buckets.get(key) ?? {
      label:
        range.by === 'week'
          ? `Week of ${shortDay.format(addDays(day, -((day.getDay() + 6) % 7)))}`
          : monthLabel.format(day),
      value: 0,
    };
    buckets.set(key, { ...bucket, value: bucket.value + paidOn(day) });
  }

  return [...buckets.values()];
};

/** Home block: the payments recorded on invoices, how they move, today and this week, as a stage card. */
function CollectedCard() {
  const { slug } = useWorkspace();
  const [rangeId, setRangeId] = useState<string>('7d');
  const range = RANGES.find((candidate) => candidate.id === rangeId) ?? RANGES[0];
  const today = useMemo(() => {
    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const from = useMemo(() => startOf(today, range), [today, range]);
  // One query covers the period and this week, whichever starts first.
  const since = localDate(from < monday ? from : monday);
  const query = useMemo<AggregateQuery>(
    () => ({
      object: 'payment',
      filter: { field: 'paid_on', op: 'gte', value: since },
      groupBy: 'paid_on',
      measures: [{ fn: 'sum', field: 'amount' }],
      limit: 500,
    }),
    [since],
  );
  const result = useAggregate(query);
  const paidByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const group of result.data?.groups ?? []) {
      const sum = group.values['sum.amount'];

      if (typeof group.key === 'string' && typeof sum === 'number') {
        map.set(group.key, sum);
      }
    }

    return map;
  }, [result.data]);
  const points = useMemo(() => pointsOf(paidByDay, from, today, range), [paidByDay, from, today, range]);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const sinceMonday = [...paidByDay]
    .filter(([day]) => day >= localDate(monday))
    .reduce((sum, [, paid]) => sum + paid, 0);
  const loading = !result.data;

  return (
    <SignalCard
      stage
      title="Money in"
      description="What customers paid on your invoices, and how it moves from one day to the next."
      label="All payments"
      value={loading ? '–' : money(total)}
      meta={range.meta}
      ranges={RANGES.map(({ id, label }) => ({ id, label }))}
      range={range.id}
      onRangeChange={setRangeId}
      chart={
        <TrendChart
          points={points}
          format={(value) => money(value)}
          aria-label={`Payments, ${range.meta.toLowerCase()}: ${money(total)}`}
        />
      }
      tiles={[
        { label: 'Today', value: loading ? '–' : money(paidByDay.get(localDate(today)) ?? 0) },
        { label: 'This week', value: loading ? '–' : money(sinceMonday) },
      ]}
      footer={<SeeMore href={links.page(slug, 'billing')}>See billing</SeeMore>}
    />
  );
}

export const collectedBlock = defineBlockComponent({
  id: ids.blocks.collected,
  label: 'Money in',
  icon: 'dollar-sign',
  requires: { objectIds: [ids.objects.payment] },
  // The Home hero: first, before Getting started, and the whole width so its tiles sit beside the chart.
  surfaces: { home: { order: -10, layout: { w: 12, h: 8, minW: 6, minH: 8 } } },
  component: CollectedCard,
});
