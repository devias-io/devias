import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = 'inbox', title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}
    >
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
        <Icon name={icon} className="size-5" />
      </div>
      <h3 className="text-xs font-medium">{title}</h3>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
