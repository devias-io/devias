import type { AiAgentActivityDay } from '@devias/core';
import { ColumnChart, type ColumnDatum, type ColumnSeries, cn, SignalCard } from '@devias/ui';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { formatTokens } from '../../agent-chat/format';
import { useAgentActivity } from '../../hooks/use-agents';
import { ACTIVITY_RANGES, type ActivityRange, activityRange } from '../../lib/activity-range';

const SERIES: ColumnSeries[] = [
  { label: 'Input tokens', tone: 'brand' },
  { label: 'Output tokens', tone: 'muted' },
];

const count = new Intl.NumberFormat();
interface Column extends ColumnDatum {
  messages: number;
  conversations: number;
}

/**
 * Days for a week or a month; weeks (from the first day) for three months, so the columns stay wide enough to read.
 * Each column stacks the output tokens on the input tokens.
 */
export const usageColumns = (days: AiAgentActivityDay[], range: ActivityRange): Column[] => {
  if (range !== '3m') {
    return days.map((day) => {
      const date = parseISO(day.date);

      return {
        label: format(date, 'EEE d MMM'),
        tick: format(date, range === '7d' ? 'EEE' : 'd MMM'),
        values: [day.inputTokens, day.outputTokens],
        messages: day.messages,
        conversations: day.conversations,
      };
    });
  }

  const weeks: Column[] = [];

  for (let start = 0; start < days.length; start += 7) {
    const week = days.slice(start, start + 7);
    const first = parseISO((week[0] as AiAgentActivityDay).date);
    const sum = (pick: (day: AiAgentActivityDay) => number) => week.reduce((total, day) => total + pick(day), 0);
    weeks.push({
      label: `Week of ${format(first, 'd MMM')}`,
      tick: format(first, 'd MMM'),
      values: [sum((day) => day.inputTokens), sum((day) => day.outputTokens)],
      messages: sum((day) => day.messages),
      conversations: sum((day) => day.conversations),
    });
  }

  return weeks;
};

const plural = (n: number, one: string, many: string) => `${count.format(n)} ${n === 1 ? one : many}`;

/**
 * An agent's usage as the page's signal: the tokens it used over the period, input under output, per day (per week
 * over three months), with the replies and conversations behind them in the readout. It counts what was spent;
 * nothing limits it yet.
 */
export function AgentUsageCard({ agentId }: { agentId: string }) {
  const [range, setRange] = useState<ActivityRange>('1m');
  const period = activityRange(range);
  const activity = useAgentActivity(agentId, period.days);
  const days = activity.data?.days ?? [];
  const input = days.reduce((sum, day) => sum + day.inputTokens, 0);
  const output = days.reduce((sum, day) => sum + day.outputTokens, 0);
  const messages = days.reduce((sum, day) => sum + day.messages, 0);
  const conversations = days.reduce((sum, day) => sum + day.conversations, 0);
  const columns = usageColumns(days, range);
  const byLabel = new Map(columns.map((column) => [column.label, column]));
  const sentence = !activity.data
    ? 'The tokens this agent used.'
    : messages === 0
      ? 'This agent was not used in this period.'
      : `${plural(conversations, 'conversation', 'conversations')} started and ${plural(messages, 'reply', 'replies')} given.`;

  return (
    <div className="h-[23rem]" data-slot="agent-usage">
      <SignalCard
        bare
        title="Tokens"
        description={sentence}
        label="All tokens"
        value={activity.data ? formatTokens(input + output) : '—'}
        meta={
          // The legend, with each series' total, sits under the figure it splits.
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-slot="usage-legend">
            <span>{period.period}</span>
            {SERIES.map((entry, index) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-muted-foreground">
                <span className={cn('size-2 rounded-[2px]', index === 0 ? 'bg-brand-strong' : 'bg-foreground/25')} />
                {activity.data ? formatTokens(index === 0 ? input : output) : '—'} {entry.label.toLowerCase()}
              </span>
            ))}
          </span>
        }
        ranges={ACTIVITY_RANGES}
        range={range}
        onRangeChange={(id) => setRange(id as ActivityRange)}
        chart={
          activity.data ? (
            <ColumnChart
              series={SERIES}
              legend={false}
              data={columns}
              format={(datum) => {
                const column = byLabel.get(datum.label);
                const total = datum.values.reduce((sum, value) => sum + value, 0);

                return column && column.messages > 0
                  ? `${formatTokens(total)} tokens · ${plural(column.messages, 'reply', 'replies')}`
                  : `${formatTokens(total)} tokens`;
              }}
              aria-label={`Tokens per ${range === '3m' ? 'week' : 'day'}, ${period.period.toLowerCase()}`}
            />
          ) : null
        }
      />
    </div>
  );
}
