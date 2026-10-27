import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ToolbarProps {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** A dense 36px row of controls, typically above a table or list. */
export function Toolbar({ left, right, className }: ToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      className={cn('flex h-9 shrink-0 items-center gap-1 border-b border-border px-2', className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </div>
  );
}
