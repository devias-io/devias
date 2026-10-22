import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext } from 'react';

export interface StudioLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}

export interface NavigateOptions {
  replace?: boolean;
}

/**
 * The small navigation seam the studio's components use instead of talking to the router directly.
 * The router provides the real implementation; tests provide a stub.
 */
export interface Navigation {
  pathname: string;
  search: Record<string, unknown>;
  /** Route params of the current match (`objectKey`, `recordId`, `section`, ...). */
  params: Record<string, string>;
  navigate: (href: string, options?: NavigateOptions) => void;
  Link: ComponentType<StudioLinkProps>;
}

const PlainLink = ({ href, className, children, onClick, title }: StudioLinkProps) => (
  <a href={href} className={className} onClick={onClick} title={title}>
    {children}
  </a>
);

const NavigationContext = createContext<Navigation | null>(null);

export const NavigationProvider = NavigationContext.Provider;

export const useNavigation = (): Navigation => {
  const value = useContext(NavigationContext);

  if (!value) {
    throw new Error('useNavigation must be used inside a NavigationProvider');
  }

  return value;
};

/** Navigation that only updates the browser location; used outside the router (tests, fallbacks). */
export const createStaticNavigation = (
  pathname = '/',
  search: Record<string, unknown> = {},
  params: Record<string, string> = {},
): Navigation => ({
  pathname,
  search,
  params,
  navigate: (href, options) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (options?.replace) {
      window.history.replaceState(null, '', href);
    } else {
      window.history.pushState(null, '', href);
    }
  },
  Link: PlainLink,
});
