import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '../../lib/cn';

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // The border stays as it is; a 2px line over it shows on hover (half strength) and while dragged or focused. The
        // studio's RailGrip draws the same line, so every resize edge looks alike.
        'relative flex w-px items-center justify-center bg-border outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2 after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent after:transition-colors data-[separator=hover]:after:bg-ring/50 data-[separator=active]:after:bg-ring focus-visible:after:bg-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1/2 aria-[orientation=horizontal]:before:left-0 aria-[orientation=horizontal]:before:h-3 aria-[orientation=horizontal]:before:w-full aria-[orientation=horizontal]:before:translate-x-0 aria-[orientation=horizontal]:before:-translate-y-1/2 aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-0.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        className,
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  );
}

/**
 * The line a resize grip draws over its edge: half strength on hover, full while dragged or focused. It goes inside a
 * `group/grip` that is `data-active` while dragged; ResizableHandle draws the same line with its own states.
 */
function ResizeLine() {
  return (
    <span className="w-0.5 rounded-full bg-transparent transition-colors group-hover/grip:bg-ring/50 group-focus-visible/grip:bg-ring! group-data-active/grip:bg-ring!" />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, ResizeLine };
