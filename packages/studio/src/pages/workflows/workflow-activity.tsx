import type { WorkflowActivity, WorkflowActivityDay } from '@devias/core';
import { ColumnChart, type ColumnDatum, type ColumnSeries, cn, SignalCard } from '@devias/ui';
import { format, parseISO } from 'date-fns';
import { ACTIVITY_RANGES, type ActivityRange, activityRange } from '../../lib/activity-range';

const runsOf = (day: WorkflowActivityDay) => day.succeeded + day.failed;

/**
 * Days for a week or a month; weeks (from the first day) for three months, so the columns stay wide enough to read.
 * Each column stacks the runs that succeeded under those that failed.
 */
export const activityColumns = (days: WorkflowActivityDay[], range: ActivityRange): ColumnDatum[] => {
  if (range !== '3m') {
    return days.map((day) => {
      const date = parseISO(day.date);

      return {
        label: format(date, 'EEE d MMM'),
        tick: format(date, range === '7d' ? 'EEE' : 'd MMM'),
        values: [day.succeeded, day.failed],
      };
    });
  }

  const weeks: ColumnDatum[] = [];

  for (let start = 0; start < days.length; start += 7) {
    const week = days.slice(start, start + 7);
    const first = parseISO((week[0] as WorkflowActivityDay).date);
    weeks.push({
      label: `Week of ${format(first, 'd MMM')}`,
      tick: format(first, 'd MMM'),
      values: [week.reduce((sum, day) => sum + day.succeeded, 0), week.reduce((sum, day) => sum + day.failed, 0)],
    });
  }

  return weeks;
};

const SERIES: ColumnSeries[] = [
  { label: 'Succeeded', tone: 'brand' },
  { label: 'Failed', tone: 'negative' },
];

const count = new Intl.NumberFormat();
const runsLabel = (value: number) => `${count.format(value)} ${value === 1 ? 'run' : 'runs'}`;

/** "98.3% of runs succeeded." Rounded down, so a single failure never reads as 100%. */
const successRate = (total: number, failed: number): string =>
  failed === 0 ? 'Every run succeeded.' : `${Math.floor(((total - failed) / total) * 1000) / 10}% of runs succeeded.`;

/**
 * The page's signal: how many times the workflows ran over the period, as columns of what succeeded and what failed.
 * The period also sets the counts in the table under it.
 */
export function WorkflowActivityCard({
  activity,
  range,
  onRangeChange,
}: {
  activity: WorkflowActivity | undefined;
  range: ActivityRange;
  onRangeChange: (range: ActivityRange) => void;
}) {
  const period = activityRange(range);
  const days = activity?.days ?? [];
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const total = days.reduce((sum, day) => sum + runsOf(day), 0);
  const failing = activity?.workflows.filter((health) => health.lastStatus === 'failed').length ?? 0;
  const sentence = !activity
    ? 'Every time a workflow ran.'
    : total === 0
      ? 'No workflow ran in this period.'
      : [
          successRate(total, failed),
          failing === 1
            ? '1 workflow failed on its last run; open its runs to see why.'
            : failing > 1
              ? `${failing} workflows failed on their last run; open their runs to see why.`
              : null,
        ]
          .filter(Boolean)
          .join(' ');

  return (
    <div className="h-[19rem]">
      <SignalCard
        bare
        title="Runs"
        description={sentence}
        label="All runs"
        value={activity ? count.format(total) : '—'}
        meta={
          // The legend, with each series' total, sits under the figure it splits.
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-slot="runs-legend">
            <span>{period.period}</span>
            {SERIES.map((entry, index) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-muted-foreground">
                <span className={cn('size-2 rounded-[2px]', index === 0 ? 'bg-brand-strong' : 'bg-destructive')} />
                {activity ? count.format(index === 0 ? total - failed : failed) : '—'} {entry.label.toLowerCase()}
              </span>
            ))}
          </span>
        }
        ranges={ACTIVITY_RANGES}
        range={range}
        onRangeChange={(id) => onRangeChange(id as ActivityRange)}
        chart={
          activity ? (
            <ColumnChart
              series={SERIES}
              legend={false}
              data={activityColumns(days, range)}
              format={(datum) => {
                const [succeeded = 0, lost = 0] = datum.values;

                return `${runsLabel(succeeded + lost)}${lost > 0 ? ` · ${count.format(lost)} failed` : ''}`;
              }}
              aria-label={`Runs per ${range === '3m' ? 'week' : 'day'}, ${period.period.toLowerCase()}`}
            />
          ) : null
        }
      />
    </div>
  );
}
