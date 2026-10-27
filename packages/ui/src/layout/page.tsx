import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PageProps {
  children?: ReactNode;
  /** Remove gutters so tables and boards can use the full width. */
  fullBleed?: boolean;
  className?: string;
}

export function Page({ children, fullBleed = false, className }: PageProps) {
  return (
    <div data-slot="page" className={cn('flex min-h-full flex-col', fullBleed ? '' : 'p-4 pb-8', className)}>
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A small tile above the title, e.g. the object's icon on a record page. */
  icon?: ReactNode;
  /** Kept for existing callers: every page title is the same size now (20px). */
  size?: 'default' | 'lg';
  className?: string;
}

export function PageHeader({ title, description, actions, icon, className }: PageHeaderProps) {
  return (
    <div data-slot="page-header" className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col items-start gap-2">
        {icon}
        <div className="min-w-0 max-w-full">
          <h1 className={cn('truncate font-heading text-heading')}>{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /**
   * `card` (default): the title sits inside the card, on top of its content. `open`: the title sits on the page
   * above the card. `plain`: no card at all, a bold heading over its content, the way a record page names its
   * parts; the page separates them with space.
   */
  variant?: 'card' | 'open' | 'plain';
  /** Without padding, for content that runs to the card's edges, such as a table of rows. */
  flush?: boolean;
}

/** A titled block on a page or record view: a card whose title sits on top of its content, without a divider. */
export function Section({ title, description, actions, children, className, variant = 'card', flush }: SectionProps) {
  const hasHeader = Boolean(title || actions);

  if (variant === 'plain') {
    return (
      <section data-slot="section" data-variant="plain" className={cn('flex flex-col gap-3', className)}>
        {hasHeader ? (
          <header className="flex min-h-8 items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-heading text-sub in-data-[rail]:text-sub">{title}</h2>
              {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
          </header>
        ) : null}
        <div data-slot="section-body" className="flex-1">
          {children}
        </div>
      </section>
    );
  }

  if (variant === 'open') {
    return (
      <section data-slot="section" data-variant="open" className={cn('flex flex-col gap-3', className)}>
        {hasHeader ? (
          <header className="flex min-h-8 items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-heading text-h4">{title}</h2>
              {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
          </header>
        ) : null}
        <div
          data-slot="section-body"
          className={cn('flex-1 rounded-lg bg-card ring-1 ring-card-border', flush ? 'overflow-hidden' : 'p-5')}
        >
          {children}
        </div>
      </section>
    );
  }

  return (
    <section data-slot="section" className={cn('rounded-lg bg-card ring-1 ring-card-border', className)}>
      {hasHeader ? (
        <header className="flex min-h-11 items-center justify-between gap-2 px-4 pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-xs font-medium">{title}</h2>
            {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div className={hasHeader ? 'px-4 pt-4 pb-4' : 'p-4'}>{children}</div>
    </section>
  );
}
