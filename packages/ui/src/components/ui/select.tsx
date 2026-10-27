import { Select as SelectPrimitive } from '@base-ui/react/select';
import { IconCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type * as React from 'react';
import { Icon, type IconName } from '../../icons';
import { cn } from '../../lib/cn';

const Select = SelectPrimitive.Root;

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn('scroll-my-1 p-1', className)} {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value data-slot="select-value" className={cn('flex flex-1 text-left', className)} {...props} />
  );
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'sm' | 'default';
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-transparent bg-muted py-2 pr-2 pl-2.5 text-xs whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<IconChevronDown className="pointer-events-none size-4 text-muted-foreground" />} />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            'relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-1.5 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center min-h-8.5 gap-2.5 rounded-xs py-1.5 pr-9 pl-2.5 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />}
      >
        <IconCheck className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <IconChevronUp />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <IconChevronDown />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export interface OptionSelectOption<V extends string = string> {
  value: V;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface OptionSelectProps<V extends string = string> {
  value: V | null | undefined;
  onValueChange: (value: V) => void;
  options: readonly OptionSelectOption<V>[];
  size?: 'sm' | 'default';
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Classes for the trigger, e.g. `w-full`. */
  className?: string;
  'aria-label'?: string;
}

/**
 * A select from a list of options: the styled, keyboard-friendly replacement for a native `<select>`.
 * An option may use `''` as its value (e.g. "None").
 */
function OptionSelect<V extends string = string>({
  value,
  onValueChange,
  options,
  size = 'default',
  placeholder,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: OptionSelectProps<V>) {
  return (
    <Select
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value ?? null}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next as V);
        }
      }}
    >
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Opens below the trigger, edge to edge with it, rather than over it. */}
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} label={option.label} disabled={option.disabled}>
            {option.icon ? <Icon name={option.icon} className="size-3.5 text-muted-foreground" /> : null}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export {
  OptionSelect,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
