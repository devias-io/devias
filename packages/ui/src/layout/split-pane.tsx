import type { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
import { cn } from '../lib/cn';

export interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  direction?: 'horizontal' | 'vertical';
  /** Initial size of the first pane in percent. */
  defaultSize?: number;
  minSize?: number;
  className?: string;
}

/** Two resizable panes with a draggable divider. */
export function SplitPane({
  left,
  right,
  direction = 'horizontal',
  defaultSize = 50,
  minSize = 15,
  className,
}: SplitPaneProps) {
  return (
    <ResizablePanelGroup orientation={direction} className={cn('h-full w-full', className)}>
      <ResizablePanel defaultSize={defaultSize} minSize={minSize}>
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={minSize}>{right}</ResizablePanel>
    </ResizablePanelGroup>
  );
}
