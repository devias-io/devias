import { createContext, type ReactNode, useContext } from 'react';
import { cn } from '../lib/cn';

/** Set by `Figures tiles`, so the figures inside it draw as cards. */
const TilesContext = createContext(false);

/**
 * One figure: what it counts in quiet type, then the figure in a heavier one, and a line under it. Lay several out
 * in `Figures`. In `Figures tiles` each is a stat card, flat on the card colour (a hairline in light, none in dark); with
 * `tone="night"` it is black and striped in light, for the one number the page is about, and plain in dark. `extra` is
 * a small visual under the hint, such as a bar.
 */
export function Figure({
  label,
  value,
  hint,
  alert,
  tone,
  extra,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** The hint is a warning: it is drawn in the destructive colour. */
  alert?: boolean;
  /** `night`: a black striped card (light theme only). Only inside `Figures tiles`. */
  tone?: 'night';
  /** A small visual under the hint: a bar, a trend. */
  extra?: ReactNode;
  className?: string;
}) {
  const tile = useContext(TilesContext);
  const night = tile && tone === 'night';

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        tile ? 'min-h-[5.75rem] gap-3 rounded-lg px-5 py-4' : '@2xl:px-6 @2xl:first:pl-0',
        night
          ? 'stripes bg-signal text-signal-foreground dark:bg-card dark:text-card-foreground'
          : tile && 'bg-card ring-1 ring-card-border',
        className,
      )}
      data-slot="figure"
    >
      <span
        className={cn(
          'flex items-center gap-1.5 truncate text-xs',
          night ? 'text-signal-foreground/60 dark:text-muted-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <div className={cn('flex min-w-0 flex-col', !tile && 'contents')}>
        <span
          className={cn(
            'truncate tabular-nums',
            !tile && 'mt-1 text-xl leading-tight font-normal tracking-[-0.03em]',
            tile && 'font-normal',
            tile && 'text-[1.375rem] leading-none tracking-[-0.03em]',
          )}
        >
          {value}
        </span>
        {hint ? (
          <span
            className={cn(
              'truncate text-xs',
              tile ? 'mt-2' : 'mt-0.5',
              alert
                ? 'text-destructive'
                : night
                  ? 'text-signal-foreground/60 dark:text-muted-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {hint}
          </span>
        ) : null}
        {extra ? <div className="mt-3">{extra}</div> : null}
      </div>
    </div>
  );
}

const COLUMNS = { 3: '@2xl:grid-cols-3', 4: '@2xl:grid-cols-4' } as const;

/**
 * A row of figures: two to a row on a narrow container, then `columns` with a quiet line between them, or, with
 * `tiles`, each one a card with a gap between. It measures its own width, so the row follows the room it has,
 * not the window.
 */
export function Figures({
  children,
  columns = 4,
  tiles,
}: {
  children: ReactNode;
  columns?: keyof typeof COLUMNS;
  tiles?: boolean;
}) {
  return (
    <div className="@container">
      <TilesContext.Provider value={Boolean(tiles)}>
        <div
          className={cn(
            'grid grid-cols-2',
            tiles ? 'gap-3' : 'gap-x-6 gap-y-5 @2xl:gap-x-0 @2xl:divide-x @2xl:divide-border',
            COLUMNS[columns],
          )}
        >
          {children}
        </div>
      </TilesContext.Provider>
    </div>
  );
}
