import type { TaskPriority, TaskStatus } from '@devias/core';
import { cn } from '@devias/ui';

/** The small marks that say where a task is and how much it matters, drawn on a 16px grid. */

/**
 * Colors are set inline, not with text classes: a menu row recolors everything inside it on hover and focus
 * (`focus:**:text-accent-foreground`), which would turn a mark that draws with `currentColor` white and leave the
 * white parts of it (the check, the "!") invisible. An inline color wins over that rule.
 */
const STATUS_TONE: Record<TaskStatus, string> = {
  backlog: 'var(--muted-foreground)',
  todo: 'var(--muted-foreground)',
  in_progress: '#f59e0b',
  in_review: '#8b5cf6',
  done: '#10b981',
  canceled: 'var(--muted-foreground)',
};

const PRIORITY_TONE = { urgent: '#f97316', bars: 'var(--foreground)', none: 'var(--muted-foreground)' };

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const value = (status in STATUS_TONE ? status : 'todo') as TaskStatus;

  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      style={{ color: STATUS_TONE[value] }}
      className={cn('size-4 shrink-0', className)}
      data-status={value}
    >
      {value === 'backlog' ? (
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.2" />
      ) : null}
      {value === 'todo' ? <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" /> : null}
      {value === 'in_progress' ? (
        <>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
        </>
      ) : null}
      {value === 'in_review' ? (
        <>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" fill="currentColor" opacity="0.35" />
          <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
        </>
      ) : null}
      {value === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5 8.2 2 2L11 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {value === 'canceled' ? (
        <>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="m6 6 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

const BARS: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };

export function PriorityIcon({ priority, className }: { priority: string; className?: string }) {
  const value = (['urgent', 'high', 'medium', 'low', 'none'].includes(priority) ? priority : 'none') as TaskPriority;

  if (value === 'urgent') {
    return (
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
        style={{ color: PRIORITY_TONE.urgent }}
        className={cn('size-4 shrink-0', className)}
        data-priority="urgent"
      >
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
        <path d="M8 4.5v4" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1" fill="white" />
      </svg>
    );
  }

  if (value === 'none') {
    return (
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
        style={{ color: PRIORITY_TONE.none }}
        className={cn('size-4 shrink-0', className)}
        data-priority="none"
      >
        <path d="M3 8h2m3 0h2m3 0h-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  const filled = BARS[value];

  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      style={{ color: PRIORITY_TONE.bars }}
      className={cn('size-4 shrink-0', className)}
      data-priority={value}
    >
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={2 + bar * 4.5}
          y={10 - bar * 3}
          width="3"
          height={4 + bar * 3}
          rx="0.8"
          fill="currentColor"
          opacity={bar < filled ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}
