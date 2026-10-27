import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';
import { LINK_PILL } from '../lib/link-pill';

export interface InsightCardProps {
  icon?: IconName;
  title: ReactNode;
  /** Small note on the right of the title, e.g. the period ("This week"). */
  meta?: ReactNode;
  children?: ReactNode;
  /** Usually a quiet link to see more ("See pipeline"); drawn as a small pill. */
  footer?: ReactNode;
  /** `night`: a black striped card, for the one number of a row that matters most. Its text and bars follow. */
  tone?: 'night';
  className?: string;
}

/**
 * A glance at one part of the workspace, as a sentence rather than a chart: a white card with a hairline, an icon and a title,
 * a sentence whose key facts stand out (`InsightText` + `Highlight`), an optional metric or chart, and a footer link.
 * It fills its home grid cell.
 */
export function InsightCard({ icon, title, meta, children, footer, tone, className }: InsightCardProps) {
  const night = tone === 'night';

  return (
    <section
      data-slot="insight-card"
      data-tone={tone}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-lg p-4',
        night ? 'stripes bg-signal text-signal-foreground' : 'bg-card text-card-foreground ring-1 ring-card-border',
        className,
      )}
    >
      <header
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs',
          night ? 'text-signal-foreground/60' : 'text-muted-foreground',
        )}
      >
        {icon ? <Icon name={icon} className="size-4 shrink-0" /> : null}
        <h2 className="min-w-0 text-xs font-normal">{title}</h2>
        {meta ? <span className="ms-auto shrink-0 text-xs">{meta}</span> : null}
      </header>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
      {footer ? (
        <footer
          className={cn(
            'mt-3 text-xs',
            night
              ? '[&_a]:inline-flex [&_a]:h-7 [&_a]:items-center [&_a]:rounded-sm [&_a]:bg-white/10 [&_a]:px-3 [&_a]:text-[13px] [&_a]:font-medium [&_a]:text-signal-foreground [&_a]:transition-colors [&_a:hover]:bg-white/20'
              : cn('text-muted-foreground', LINK_PILL),
          )}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** The card's sentence: muted, with the facts wrapped in `Highlight`. */
export function InsightText({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-sm leading-snug tracking-[-0.01em] text-muted-foreground in-data-[tone=night]:text-signal-foreground/60',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A fact inside an `InsightText` sentence, in full contrast. */
export function Highlight({ children }: { children?: ReactNode }) {
  return <span className="text-foreground in-data-[tone=night]:text-signal-foreground">{children}</span>;
}

/** One large number at the bottom of a card, e.g. a total, in the display face. */
export function InsightMetric({ children, label }: { children?: ReactNode; label?: ReactNode }) {
  return (
    <div className="mt-auto pt-3">
      <div className="font-heading text-[1.75rem] leading-none font-normal tracking-[-0.04em] text-foreground tabular-nums in-data-[tone=night]:text-signal-foreground">
        {children}
      </div>
      {label ? (
        <div className="mt-1.5 text-xs text-muted-foreground in-data-[tone=night]:text-signal-foreground/60">
          {label}
        </div>
      ) : null}
    </div>
  );
}

export interface MiniBarsProps {
  values: number[];
  /** One short label per bar, shown under it. */
  labels?: string[];
  /** Bars at these indexes are drawn at full strength; the rest are dimmed. Default: all. */
  emphasize?: number[];
  className?: string;
  'aria-label'?: string;
}

/** A small monochrome bar chart; bars scale to the largest value and never vanish entirely. */
export function MiniBars({ values, labels, emphasize, className, 'aria-label': ariaLabel }: MiniBarsProps) {
  const max = Math.max(1, ...values);

  return (
    <div role="img" aria-label={ariaLabel} className={cn('mt-auto flex items-end gap-1.5 pt-4', className)}>
      {values.map((value, i) => (
        <div key={labels?.[i] ?? i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex h-12 w-full items-end justify-center">
            <div
              className={cn(
                'w-3 rounded-t-[4px] bg-foreground dark:bg-brand-strong in-data-[tone=night]:bg-brand',
                emphasize && !emphasize.includes(i) && 'opacity-30',
              )}
              style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
            />
          </div>
          {labels?.[i] ? (
            <span
              className="w-full truncate text-center text-xs text-muted-foreground in-data-[tone=night]:text-signal-foreground/60"
              title={labels[i]}
            >
              {labels[i]}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
