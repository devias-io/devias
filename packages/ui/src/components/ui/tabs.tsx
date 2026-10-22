import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, useContext } from 'react';
import { cn } from '../../lib/cn';

/**
 * A compact tab whose active state is a soft rounded fill, keyed on `data-active`. Shared by the `pill` tabs list
 * and `UnderlineTabs`' pill variant so both look the same.
 */
export const pillTabClassName =
  "relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 text-xs font-medium whitespace-nowrap text-secondary-foreground/66 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-active:border-border/10 data-active:bg-secondary data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

/** A tab of the `underline` list: plain text, the active one underlined on the border the list sits on. */
export const underlineTabClassName =
  "relative inline-flex h-11 shrink-0 items-center justify-center gap-2 border-0 bg-transparent px-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity data-active:after:opacity-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** A tab of the `chip` list: plain text, a black (white in dark) fill when active. */
export const chipTabClassName =
  "relative inline-flex h-7 shrink-0 items-center justify-center gap-2 rounded-xs border border-transparent bg-transparent px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-active:bg-primary data-active:text-primary-foreground data-active:hover:bg-primary data-active:hover:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

type TabsListVariant = NonNullable<VariantProps<typeof tabsListVariants>['variant']>;

/** The list's variant, so a trigger in a `pill` list takes the pill styles alone rather than layering on the base. */
const TabsListVariantContext = createContext<TabsListVariant>('default');

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
        pill: 'gap-0.5 bg-transparent p-0 group-data-horizontal/tabs:h-6',
        /** Sits in a row with a bottom border, which the active tab's underline covers. */
        underline: 'w-full justify-start gap-6 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-11',
        /** Tabs on a bordered card-coloured bar, the active one black, white in dark: the tabs of a record page. */
        chip: 'w-fit max-w-full justify-start gap-1 rounded-lg border border-border bg-card p-1 group-data-horizontal/tabs:h-9',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsListVariantContext.Provider value={variant ?? 'default'}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsListVariantContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  const variant = useContext(TabsListVariantContext);

  if (variant === 'pill') {
    return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn(pillTabClassName, className)} {...props} />;
  }

  if (variant === 'underline') {
    return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn(underlineTabClassName, className)} {...props} />;
  }

  if (variant === 'chip') {
    return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn(chipTabClassName, className)} {...props} />;
  }

  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
        'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel data-slot="tabs-content" className={cn('flex-1 text-xs outline-none', className)} {...props} />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
