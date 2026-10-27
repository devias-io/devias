import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { cn } from '../../lib/cn';

/**
 * Content that scrolls under a bar of its own: thin, drawn over the content's edge rather than beside it, so it takes
 * no room from the layout. Size the area with `className` (a `max-h-*` makes it scroll); a viewport that must follow
 * that size takes `viewportClassName="max-h-[inherit]"`.
 */
function ScrollArea({
  className,
  viewportClassName,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation = 'vertical', ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-foreground/16 transition-colors hover:bg-foreground/32 data-scrolling:bg-foreground/32"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
