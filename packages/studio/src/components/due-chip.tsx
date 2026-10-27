import { isTaskClosed } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import { todayLocal } from '../hooks/use-tasks';
import { dayOf, dueWords } from '../lib/task-words';

/** A task's due date as a small chip: red once it is past and the task is still open. */
export function DueChip({ date, status, className }: { date: string | null; status: string; className?: string }) {
  if (!date) {
    return null;
  }

  const today = todayLocal();
  const overdue = date < today && !isTaskClosed(status);

  return (
    <span
      data-slot="due-chip"
      data-overdue={overdue || undefined}
      title={dueWords(date, today)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs',
        overdue ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon name="calendar" className="size-3" />
      {dayOf(date)}
    </span>
  );
}
