import { type KeyboardEvent, type PointerEvent, useState } from 'react';
import { cn } from '../lib/cn';

export interface ColumnSeries {
  /** Names the series in the legend and the table: "Succeeded". */
  label: string;
  /** `brand` for the main series, `negative` for failures, `muted` for the rest. */
  tone: 'brand' | 'negative' | 'muted';
}

export interface ColumnDatum {
  /** What the column stands for, in the readout: "Mon 12 Oct", "Week of 29 Sep". */
  label: string;
  /** Under the column: "Mon", "12 Oct". */
  tick?: string;
  /** One value per series, stacked bottom to top. */
  values: number[];
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  /** Bottom to top. */
  series: ColumnSeries[];
  /** The readout over the active column: "32 runs · 2 failed". */
  format?: (datum: ColumnDatum) => string;
  /** `signal` for the dark signal card, `default` for light and dark pages. */
  tone?: 'signal' | 'default';
  /** Show the legend under the columns (default: with two series or more). Turn it off only when the series are named
   * next to the chart, for instance with their totals beside the headline figure. */
  legend?: boolean;
  className?: string;
  'aria-label'?: string;
}

const FILL = {
  signal: { brand: 'bg-brand', negative: 'bg-signal-negative', muted: 'bg-white/25' },
  default: { brand: 'bg-brand-strong', negative: 'bg-destructive', muted: 'bg-foreground/25' },
} as const;

/** Up to this many columns each get a tick; past it only the first and the last do. */
const TICK_EACH = 8;

const sum = (values: number[]) => values.reduce((total, value) => total + Math.max(value, 0), 0);

/**
 * Counts over time as stacked columns, each series a segment, separated by a 2px gap, with a rounded top. The column
 * under the pointer (or picked with the arrow keys) is read out above the columns; without one the latest is. It fills
 * its container, so give that a height.
 */
export function ColumnChart({
  data,
  series,
  format = (datum) => String(sum(datum.values)),
  tone = 'default',
  legend = series.length > 1,
  className,
  'aria-label': ariaLabel,
}: ColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const signal = tone === 'signal';
  const fill = FILL[tone];
  const max = Math.max(1, ...data.map((datum) => sum(datum.values)));
  const shown = active ?? data.length - 1;
  const datum = data[shown];
  const center = (shown + 0.5) / Math.max(data.length, 1);
  const anchor = center < 0.12 ? 'start' : center > 0.88 ? 'end' : 'center';

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * data.length);
    setActive(Math.min(data.length - 1, Math.max(0, index)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const from = active ?? data.length - 1;
    setActive(Math.min(data.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1))));
  };
  const first = data[0];
  const last = data[data.length - 1];
  const muted = signal ? 'text-white/45' : 'text-muted-foreground';

  return (
    <div data-slot="column-chart" className={cn('flex size-full min-h-0 flex-col', className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move between columns
        tabIndex={0}
        className="relative flex min-h-0 flex-1 cursor-crosshair touch-none flex-col rounded-lg pt-10 outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        onKeyDown={keys}
        onBlur={() => setActive(null)}
      >
        {datum ? (
          <div
            data-slot="column-value"
            className={cn(
              'pointer-events-none absolute top-0 flex flex-col whitespace-nowrap',
              anchor === 'center' && '-translate-x-1/2 items-center',
              anchor === 'start' && 'items-start',
              anchor === 'end' && '-translate-x-full items-end',
            )}
            style={{
              left: anchor === 'start' ? 0 : anchor === 'end' ? '100%' : `${center * 100}%`,
            }}
          >
            <span className="text-[14px] leading-5 font-semibold">{format(datum)}</span>
            <span className={cn('text-[11px] leading-3', muted)}>{datum.label}</span>
          </div>
        ) : null}
        <div
          className="flex min-h-0 flex-1 items-end gap-[3px]"
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
        >
          {data.map((column, index) => {
            const total = sum(column.values);
            const bottom = column.values.findIndex((value) => value > 0);
            const top = column.values.reduce((found, value, part) => (value > 0 ? part : found), -1);

            return (
              <div
                key={`${column.label}-${index}`}
                data-slot="column"
                data-active={index === active || undefined}
                className={cn(
                  'flex h-full min-w-0 flex-1 justify-center transition-opacity duration-200',
                  active !== null && index !== active && 'opacity-35',
                )}
              >
                <div className="flex h-full w-full max-w-6 flex-col-reverse gap-[2px]">
                  {total === 0 ? (
                    <div className={cn('h-[2px] shrink-0 rounded-full', signal ? 'bg-white/15' : 'bg-border')} />
                  ) : (
                    column.values.map((value, part) =>
                      value > 0 ? (
                        <div
                          key={part}
                          className={cn(
                            'min-h-[2px] shrink-0',
                            fill[series[part]?.tone ?? 'muted'],
                            part === top && 'rounded-t-[4px]',
                          )}
                          // The gaps above the bottom segment come out of the segments, so the tallest column fits.
                          style={{
                            height: part === bottom ? `${(value / max) * 100}%` : `calc(${(value / max) * 100}% - 2px)`,
                          }}
                        />
                      ) : null,
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className={cn('h-px shrink-0', signal ? 'bg-white/10' : 'bg-border')} />
      </div>
      <div className={cn('mt-2 flex shrink-0 gap-[3px] text-[11px] leading-3', muted)} aria-hidden>
        {data.length <= TICK_EACH ? (
          data.map((column, index) => (
            <span key={`${column.label}-${index}`} className="min-w-0 flex-1 truncate text-center">
              {column.tick ?? ''}
            </span>
          ))
        ) : (
          <>
            <span>{first?.tick ?? ''}</span>
            <span className="ms-auto">{last?.tick ?? ''}</span>
          </>
        )}
      </div>
      {legend ? (
        <ul className={cn('mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs', muted)} aria-label="Legend">
          {series.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-[2px]', fill[entry.tone])} />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((entry) => (
              <th key={entry.label} scope="col">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((column, index) => (
            <tr key={`${column.label}-${index}`}>
              <th scope="row">{column.label}</th>
              {series.map((entry, part) => (
                <td key={entry.label}>{column.values[part] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
