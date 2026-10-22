import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { LINK_PILL } from '../lib/link-pill';

export interface SignalRange {
  id: string;
  /** Short: "7D", "1M". */
  label: string;
}

export interface SignalTile {
  label: ReactNode;
  value: ReactNode;
}

export interface SignalCardProps {
  title: ReactNode;
  /** One sentence on what to look for. */
  description?: ReactNode;
  /** What the headline figure counts: "All payments". */
  label?: ReactNode;
  /** The headline figure, in the display face. */
  value: ReactNode;
  /** Under the figure: its period, "Last 7 days". */
  meta?: ReactNode;
  ranges?: SignalRange[];
  range?: string;
  onRangeChange?: (id: string) => void;
  /** Usually a `TrendChart` with `tone="signal"`; it takes the space left under the figure. */
  chart?: ReactNode;
  /** Figures beside the chart (stacked under it on narrow cards): "Today", "This week". */
  tiles?: SignalTile[];
  /** In the tiles' place, for something richer than a figure: a breakdown, a short list. */
  aside?: ReactNode;
  footer?: ReactNode;
  /**
   * No dark background: the card sits on the page in the theme's own colours, flush with the page's edges. Pair it
   * with a `TrendChart` of the default tone, which reads on both themes.
   */
  bare?: boolean;
  /**
   * A stage: the card floats on a scenic ground, the figure and its chart in a white (dark in dark) card, the tiles
   * beside it, the first as a black striped card. For the one hero of a page.
   */
  stage?: boolean;
  className?: string;
}

/**
 * The one figure that matters and how it moves, on a dark card in both themes: a title and a sentence, the figure
 * with its period and range pills, a chart, and a couple of tiles (or an aside of its own). It fills its container.
 */
export function SignalCard({
  title,
  description,
  label,
  value,
  meta,
  ranges,
  range,
  onRangeChange,
  chart,
  tiles,
  aside,
  footer,
  bare = false,
  stage = false,
  className,
}: SignalCardProps) {
  if (stage) {
    return (
      <section
        data-slot="signal-card"
        data-variant="stage"
        className={cn('@container scene-meadow flex h-full min-h-0 flex-col overflow-hidden rounded-lg p-3', className)}
      >
        <div className="grid min-h-0 flex-1 gap-3 @2xl:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="flex min-h-0 min-w-0 flex-col rounded-lg bg-card p-4 text-card-foreground shadow-[0_34px_64px_-30px_rgba(10,22,6,0.5)] @2xl:p-5">
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <h2 className="font-heading text-sub">{title}</h2>
                {description ? <p className="sr-only">{description}</p> : null}
              </div>
              {ranges && ranges.length > 0 ? (
                <div role="tablist" aria-label="Period" className="flex gap-1.5">
                  {ranges.map((option) => {
                    const selected = option.id === range;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className={cn(
                          'h-7 min-w-10 cursor-pointer rounded-full px-3 text-[13px] font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected
                            ? 'bg-foreground text-background dark:bg-secondary dark:text-foreground'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                        onClick={() => !selected && onRangeChange?.(option.id)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </header>
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="flex min-w-0 flex-col">
                {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
                <span className="mt-1 truncate font-heading text-[1.75rem] leading-none font-normal tracking-[-0.04em] tabular-nums">
                  {value}
                </span>
                {meta ? <span className="mt-1.5 text-xs text-muted-foreground">{meta}</span> : null}
              </div>
              {chart ? <div className="mt-2 min-h-28 flex-1">{chart}</div> : null}
            </div>
            {footer ? <footer className={cn('mt-3 text-xs', LINK_PILL)}>{footer}</footer> : null}
          </div>
          {tiles && tiles.length > 0 ? (
            <dl className="flex shrink-0 gap-3 @2xl:flex-col">
              {tiles.map((tile, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex min-w-0 flex-1 flex-col justify-between gap-2 rounded-lg p-4',
                    'bg-card text-card-foreground shadow-[0_34px_64px_-30px_rgba(10,22,6,0.5)]',
                  )}
                >
                  <dt className="text-xs text-muted-foreground">{tile.label}</dt>
                  <dd className="truncate font-heading text-[1.25rem] leading-[1.15] font-normal tracking-[-0.03em] tabular-nums">
                    {tile.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {!tiles?.length && aside ? <div className="flex min-h-0 shrink-0 flex-col">{aside}</div> : null}
        </div>
      </section>
    );
  }

  // What the card's text and surfaces are made of: the dark signal tokens, or the page's own when bare.
  const tone = bare
    ? {
        card: 'overflow-visible bg-transparent text-foreground',
        edge: 'px-0',
        description: 'text-muted-foreground',
        label: 'text-muted-foreground',
        meta: 'text-subtle-foreground',
        selected: 'bg-muted text-foreground',
        idle: 'text-muted-foreground hover:text-foreground',
        tile: 'bg-card ring-1 ring-card-border',
        tileLabel: 'text-muted-foreground',
        footer: 'text-muted-foreground',
      }
    : {
        card: 'bg-signal text-signal-foreground',
        edge: 'px-6',
        description: 'text-white/70',
        label: 'text-white/60',
        meta: 'text-white/40',
        selected: 'bg-signal-control text-white',
        idle: 'text-white/40 hover:text-white/70',
        tile: 'bg-signal-tile',
        tileLabel: 'text-white/80',
        footer: 'text-white/60',
      };

  return (
    <section
      data-slot="signal-card"
      className={cn('@container flex h-full min-h-0 flex-col overflow-hidden rounded-lg', tone.card, className)}
    >
      <header className={cn('flex flex-col gap-1 pt-6', tone.edge)}>
        <h2 className="text-base leading-7 font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? <p className={cn('text-xs leading-5 text-pretty', tone.description)}>{description}</p> : null}
      </header>
      <div className={cn('flex min-h-0 flex-1 flex-col gap-4 pt-4 pb-6 @2xl:flex-row', tone.edge)}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              {label ? <span className={cn('text-[13px] leading-4', tone.label)}>{label}</span> : null}
              <span className="mt-1 truncate font-heading text-[28px] leading-9 font-semibold tracking-[-0.02em]">
                {value}
              </span>
              {meta ? <span className={cn('mt-0.5 text-xs leading-4', tone.meta)}>{meta}</span> : null}
            </div>
            {ranges && ranges.length > 0 ? (
              <div role="tablist" aria-label="Period" className="flex gap-0.5">
                {ranges.map((option) => {
                  const selected = option.id === range;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={cn(
                        'h-8 min-w-11 cursor-pointer rounded-full px-3 text-[13px] font-semibold transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-brand/70',
                        selected ? tone.selected : tone.idle,
                      )}
                      onClick={() => !selected && onRangeChange?.(option.id)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {chart ? <div className="mt-3 min-h-28 flex-1">{chart}</div> : null}
        </div>
        {tiles && tiles.length > 0 ? (
          <dl className="flex shrink-0 gap-3 @2xl:w-52 @2xl:flex-col">
            {tiles.map((tile, index) => (
              <div
                key={index}
                className={cn('flex min-w-0 flex-1 flex-col justify-between gap-3 rounded-lg p-5', tone.tile)}
              >
                <dt className={cn('text-xs leading-5', tone.tileLabel)}>{tile.label}</dt>
                <dd className="truncate font-heading text-xl leading-8 font-semibold tracking-[-0.02em]">
                  {tile.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {aside ? <div className="flex min-h-0 shrink-0 flex-col @2xl:w-72">{aside}</div> : null}
      </div>
      {footer ? <footer className={cn('-mt-2 pb-5 text-xs', tone.edge, tone.footer)}>{footer}</footer> : null}
    </section>
  );
}
