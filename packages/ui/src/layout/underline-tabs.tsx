import { pillTabClassName } from '../components/ui/tabs';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';

export interface UnderlineTab {
  id: string;
  label: string;
  icon?: IconName;
  /** Shown muted after the label, e.g. how many items the tab holds. */
  count?: number;
}

export interface UnderlineTabsProps {
  tabs: UnderlineTab[];
  value: string;
  onValueChange?: (id: string) => void;
  /** `underline` sits on a row's bottom border; `pill` puts the active tab on a soft rounded fill, borderless. */
  variant?: 'underline' | 'pill';
  className?: string;
  'aria-label'?: string;
}

/**
 * A row of tabs. The `underline` variant (default) underlines the active one: put it in a row with a bottom
 * border, the underline sits on that border. The `pill` variant is compact and needs no border. Long rows scroll
 * sideways.
 */
export function UnderlineTabs({
  tabs,
  value,
  onValueChange,
  variant = 'underline',
  className,
  'aria-label': ariaLabel,
}: UnderlineTabsProps) {
  const pill = variant === 'pill';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-variant={variant}
      className={cn(
        'flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]',
        pill ? 'gap-0.5' : '-mb-px gap-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? '' : undefined}
            className={
              pill
                ? pillTabClassName
                : cn(
                    'relative flex h-9 shrink-0 items-center gap-1.5 px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    active
                      ? 'text-foreground after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:bg-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
            }
            onClick={() => !active && onValueChange?.(tab.id)}
          >
            {tab.icon && !pill ? <Icon name={tab.icon} className="size-3.5" /> : null}
            <span className={cn('truncate', pill ? 'max-w-32' : 'max-w-48')}>{tab.label}</span>
            {tab.count !== undefined ? (
              <span className="text-xs text-muted-foreground tabular-nums">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
