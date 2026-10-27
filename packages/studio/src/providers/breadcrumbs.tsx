import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export interface Crumb {
  label: ReactNode;
  href?: string;
}

interface BreadcrumbsContextValue {
  items: Crumb[];
  set: (items: Crumb[]) => void;
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null);

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ items, set }), [items]);

  return <BreadcrumbsContext.Provider value={value}>{children}</BreadcrumbsContext.Provider>;
}

export const useBreadcrumbs = (): Crumb[] => useContext(BreadcrumbsContext)?.items ?? [];

/** Pages declare their breadcrumb trail; the top bar renders it. */
export const useSetBreadcrumbs = (items: Crumb[]): void => {
  // Depend on the stable setter, never on the context value: the value changes whenever crumbs are
  // set, which would re-run this effect and loop ("maximum update depth exceeded").
  const set = useContext(BreadcrumbsContext)?.set;
  const key = JSON.stringify(items.map((i) => [typeof i.label === 'string' ? i.label : '', i.href ?? '']));
  // biome-ignore lint/correctness/useExhaustiveDependencies: items changes identity every render; key captures its content
  useEffect(() => {
    set?.(items);

    return () => set?.([]);
  }, [set, key]);
};
