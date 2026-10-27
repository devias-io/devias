import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '../../lib/cn';

/**
 * Bold on, quiet off. On is a solid track in the primary colour (black, white in dark) with a thumb in its ink; off is
 * an empty outlined track with a grey thumb. The thumb keeps its size and only slides. 32 by 20 with a
 * 16px thumb, or 28 by 16 with a 12px one.
 */
function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default';
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 outline-none group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:ring-3 aria-invalid:ring-destructive/30 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-7 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-transparent data-unchecked:ring-1 data-unchecked:ring-foreground/25 data-unchecked:ring-inset data-unchecked:focus-visible:ring-3 data-unchecked:focus-visible:ring-ring/40 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full transition-transform duration-150 group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-checked:translate-x-3 group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:data-checked:translate-x-3 data-checked:bg-primary-foreground data-unchecked:bg-muted-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
