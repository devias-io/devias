import { layoutParentOf, type PageDefinition } from '@devias/core';
import { type AnyRoute, createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * One route per page, from the flat registry. A page whose path sits under a page with a `layout` nests inside that
 * layout's route (so the layout wraps it); the rest hang straight off `root`. `wrap` puts the page's gate and error
 * boundary around what it renders.
 */
export const buildPageRoutes = (
  pages: ReadonlyMap<string, PageDefinition>,
  root: AnyRoute,
  wrap: (page: PageDefinition, node: ReactNode) => ReactNode,
): AnyRoute[] => {
  const routeOf = (page: PageDefinition, parent: AnyRoute, base: string): AnyRoute => {
    const relative = base ? page.path.slice(base.length + 1) : page.path;
    const Component = page.component;

    if (!page.layout) {
      return createRoute({
        getParentRoute: () => parent,
        path: relative,
        component: () => wrap(page, <Component />),
      });
    }

    const Layout = page.layout;
    const layoutRoute: AnyRoute = createRoute({
      getParentRoute: () => parent,
      path: relative,
      component: () => wrap(page, <Layout />),
    });
    const index = createRoute({
      getParentRoute: () => layoutRoute,
      path: '/',
      component: () => <Component />,
    });
    const inside = [...pages.values()]
      .filter((candidate) => layoutParentOf(pages, candidate.path)?.path === page.path)
      .map((candidate) => routeOf(candidate, layoutRoute, page.path));

    return layoutRoute.addChildren([index, ...inside]);
  };

  return [...pages.values()]
    .filter((page) => layoutParentOf(pages, page.path) === undefined)
    .map((page) => routeOf(page, root, ''));
};
