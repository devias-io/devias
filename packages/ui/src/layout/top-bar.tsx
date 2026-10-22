import { IconChevronRight } from '@tabler/icons-react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TopBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** 49px top bar with three slots. Lives inside AppShell's header row. */
export function TopBar({ left, center, right, className }: TopBarProps) {
  return (
    <div data-slot="top-bar" className={cn('flex h-full w-full items-center gap-2', className)}>
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">{left}</div>
      {center ? <div className="flex w-full max-w-xl min-w-0 shrink items-center justify-center">{center}</div> : null}
      {/* Never narrower than its content: the centre gives way first, so the right side does not slide under it. */}
      <div className="flex min-w-fit flex-1 basis-0 items-center justify-end gap-0.5">{right}</div>
    </div>
  );
}

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  linkComponent?: ComponentType<{ href: string; className?: string; children: ReactNode }>;
  className?: string;
}

const DefaultLink = ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export function Breadcrumbs({ items, linkComponent, className }: BreadcrumbsProps) {
  const Link = linkComponent ?? DefaultLink;

  return (
    <ol
      data-slot="breadcrumbs"
      className={cn('flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground', className)}
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const cls = cn(
          'flex h-7 min-w-0 items-center truncate rounded-md px-1',
          !last && 'transition-colors hover:text-foreground',
        );

        return (
          <li key={index} className="flex min-w-0 items-center gap-1">
            {item.href && !last ? (
              <Link href={item.href} className={cls}>
                {item.label}
              </Link>
            ) : item.onClick && !last ? (
              <button type="button" className={cls} onClick={item.onClick}>
                {item.label}
              </button>
            ) : (
              <span className={cls} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            )}
            {!last ? <IconChevronRight className="size-3 shrink-0 text-subtle-foreground" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
