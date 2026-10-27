import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { IconCheck, IconMinus } from '@tabler/icons-react';
import { cn } from '../../lib/cn';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-4.5 shrink-0 items-center justify-center rounded-xs border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-brand dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-brand data-checked:bg-brand data-checked:text-brand-foreground data-indeterminate:border-brand data-indeterminate:bg-brand data-indeterminate:text-brand-foreground group-has-[:focus-visible]/field-label:data-checked:border-brand dark:data-checked:border-primary dark:data-checked:bg-primary dark:data-checked:text-primary-foreground dark:data-indeterminate:border-primary dark:data-indeterminate:bg-primary dark:data-indeterminate:text-primary-foreground dark:group-has-[:focus-visible]/field-label:data-checked:border-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <IconCheck className="in-data-indeterminate:hidden" />
        <IconMinus className="hidden in-data-indeterminate:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
