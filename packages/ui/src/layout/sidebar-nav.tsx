import { IconChevronRight } from '@tabler/icons-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon?: IconName;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  badge?: ReactNode;
  children?: SidebarNavItem[];
  defaultOpen?: boolean;
}

export interface SidebarNavGroup {
  id: string;
  title?: string;
  items: SidebarNavItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export interface SidebarLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

export interface SidebarNavProps {
  groups: SidebarNavGroup[];
  /** Router-aware link component; defaults to a plain anchor. */
  linkComponent?: ComponentType<SidebarLinkProps>;
  header?: ReactNode;
  /** Classes for the header's wrapper, e.g. to align it with a top bar. */
  headerClassName?: string;
  /** Fixed block under the header (global destinations), above the scrolling groups. */
  pinned?: ReactNode;
  /** Rows after the groups, scrolling with them (e.g. secondary destinations). */
  trailing?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const DefaultLink = ({ href, className, children, onClick }: SidebarLinkProps) => (
  <a href={href} className={className} onClick={onClick}>
    {children}
  </a>
);

const rowClass = (active?: boolean) =>
  cn(
    'group/nav-item flex h-8.5 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-foreground outline-none select-none',
    'group-data-[sidebar=collapsed]/shell:justify-center group-data-[sidebar=collapsed]/shell:px-0',
    'transition-[background-color,color] hover:bg-sidebar-accent/30 focus-visible:ring-3 focus-visible:ring-sidebar-ring/30',
    active && 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent',
  );

const hasActiveDescendant = (items: SidebarNavItem[] | undefined): boolean =>
  (items ?? []).some((child) => child.active || hasActiveDescendant(child.children));

/**
 * One row. A row with children keeps its icon and shows a chevron at the end; the children sit under it without
 * icons, their labels lined up with the parent's. Sections start closed (`defaultOpen: true` starts one open), unless
 * the page you are on is inside one, which opens by itself.
 */
function NavRow({ item, depth, Link }: { item: SidebarNavItem; depth: number; Link: ComponentType<SidebarLinkProps> }) {
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const activeInside = hasChildren && hasActiveDescendant(item.children);
  const [open, setOpen] = useState(item.defaultOpen ?? activeInside);
  useEffect(() => {
    if (activeInside) {
      setOpen(true);
    }
  }, [activeInside]);
  const highlighted = item.active || (hasChildren && !open && activeInside);
  const toggle = () => setOpen((value) => !value);
  const chevron = (
    <Icon
      name="chevron-down"
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[sidebar=collapsed]/shell:hidden',
        open && 'rotate-180',
      )}
    />
  );
  const inner = (withChevron: boolean) => (
    <span
      className="flex w-full min-w-0 items-center gap-2 group-data-[sidebar=collapsed]/shell:justify-center"
      title={item.label}
    >
      {depth > 0 ? (
        <span className="size-5 shrink-0 group-data-[sidebar=collapsed]/shell:hidden" aria-hidden="true" />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center">
          {item.icon ? <Icon name={item.icon} className="size-4.5" /> : null}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate group-data-[sidebar=collapsed]/shell:hidden">{item.label}</span>
      {item.badge ? (
        <span className="ml-auto text-xs text-muted-foreground group-data-[sidebar=collapsed]/shell:hidden">
          {item.badge}
        </span>
      ) : null}
      {withChevron ? chevron : null}
    </span>
  );

  return (
    <li
      data-slot="sidebar-nav-item"
      data-active={item.active ? 'true' : undefined}
      data-open={hasChildren ? open : undefined}
    >
      {item.href ? (
        // A row that goes somewhere keeps that, and its chevron opens the section on its own.
        <div className="relative">
          <Link href={item.href} className={cn(rowClass(highlighted), hasChildren && 'pr-8')} onClick={item.onClick}>
            {inner(false)}
          </Link>
          {hasChildren ? (
            <button
              type="button"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
              aria-expanded={open}
              className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-xs hover:bg-sidebar-accent group-data-[sidebar=collapsed]/shell:hidden"
              onClick={toggle}
            >
              {chevron}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className={rowClass(highlighted)}
          aria-expanded={hasChildren ? open : undefined}
          onClick={() => (hasChildren && !item.onClick ? toggle() : item.onClick?.())}
        >
          {inner(hasChildren)}
        </button>
      )}
      {hasChildren && open ? (
        <ul className="mt-1 flex flex-col gap-1 group-data-[sidebar=collapsed]/shell:hidden">
          {item.children?.map((child) => (
            <NavRow key={child.id} item={child} depth={depth + 1} Link={Link} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A plain list of sidebar rows, for blocks outside the grouped structure (e.g. pinned tools). */
export function SidebarNavItems({
  items,
  linkComponent,
}: {
  items: SidebarNavItem[];
  linkComponent?: ComponentType<SidebarLinkProps>;
}) {
  const Link = linkComponent ?? DefaultLink;

  return (
    <ul data-slot="sidebar-nav-items" className="flex flex-col gap-1">
      {items.map((item) => (
        <NavRow key={item.id} item={item} depth={0} Link={Link} />
      ))}
    </ul>
  );
}

function NavGroup({
  group,
  Link,
  flush,
}: {
  group: SidebarNavGroup;
  Link: ComponentType<SidebarLinkProps>;
  /** Rows sit under another block (the pinned items), so less space above the first group. */
  flush?: boolean;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? true);

  return (
    <section
      data-slot="sidebar-nav-group"
      className={cn('flex flex-col gap-0.5 px-2 py-1.5', flush ? 'first:pt-2' : 'first:pt-3')}
    >
      {group.title ? (
        <button
          type="button"
          className="group/section flex h-7 items-center justify-start gap-1 rounded-md px-2 text-left text-[13px] font-medium text-sidebar-foreground outline-none group-data-[sidebar=collapsed]/shell:hidden transition-colors hover:bg-sidebar-accent/30 focus-visible:ring-3 focus-visible:ring-sidebar-ring/30"
          onClick={() => group.collapsible !== false && setOpen((v) => !v)}
        >
          {group.title}
          {group.collapsible !== false ? (
            <IconChevronRight
              className={cn(
                'size-3.5 opacity-0 transition-[opacity,rotate] group-hover/section:opacity-100',
                open && 'rotate-90',
              )}
            />
          ) : null}
        </button>
      ) : null}
      <ul className={cn('flex-col gap-1', open ? 'flex' : 'hidden group-data-[sidebar=collapsed]/shell:flex')}>
        {group.items.map((item) => (
          <NavRow key={item.id} item={item} depth={0} Link={Link} />
        ))}
      </ul>
    </section>
  );
}

/** Sidebar navigation: groups of rows with optional nesting, 34px rows. */
export function SidebarNav({
  groups,
  linkComponent,
  header,
  headerClassName,
  pinned,
  trailing,
  footer,
  className,
}: SidebarNavProps) {
  const Link = linkComponent ?? DefaultLink;

  return (
    <nav data-slot="sidebar-nav" className={cn('flex h-full min-h-0 flex-col', className)}>
      {header ? <div className={cn('shrink-0 p-2', headerClassName)}>{header}</div> : null}
      {pinned ? (
        // The pinned rows are the same list as what follows, set apart by a rule.
        <div data-slot="sidebar-nav-pinned" className="mb-1 shrink-0 border-b border-sidebar-border px-2 pt-1 pb-2.5">
          {pinned}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {groups.map((group) => (
          <NavGroup key={group.id} group={group} Link={Link} flush={Boolean(pinned)} />
        ))}
        {trailing ? (
          <div data-slot="sidebar-nav-trailing" className="px-2 pt-1">
            {trailing}
          </div>
        ) : null}
      </div>
      {footer ? <div className="shrink-0 border-t border-sidebar-border p-2">{footer}</div> : null}
    </nav>
  );
}
