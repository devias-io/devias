import type { PageDefinition } from '@devias/core';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPageRoutes } from '../src/router/page-routes';

afterEach(cleanup);

const text = (label: string) => () => <p>{label}</p>;
const Chrome = () => (
  <div>
    <p>settings chrome</p>
    <Outlet />
  </div>
);

const registry = (pages: PageDefinition[]) => new Map(pages.map((page) => [page.path, page]));

const open = async (
  pages: PageDefinition[],
  path: string,
  wrap?: (page: PageDefinition, node: ReactNode) => ReactNode,
) => {
  const root = createRootRoute({ component: () => <Outlet /> });
  const routes = buildPageRoutes(registry(pages), root, wrap ?? ((_page, node) => node));
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe('idle'));
};

const pages: PageDefinition[] = [
  { path: 'billing', label: 'Billing', component: text('billing overview') },
  { path: 'billing/new', component: text('invoice composer'), creates: 'invoice' },
  { path: 'billing/$invoiceId/edit', component: text('invoice editor') },
  { path: 'settings', label: 'Settings', layout: Chrome, component: text('settings index') },
  { path: 'settings/$section', component: text('settings section') },
  { path: 'records/$objectKey', component: text('object view') },
  { path: 'records/new', component: text('new record') },
];

describe('building routes from pages', () => {
  it('routes a page, and the pages under its prefix, from flat definitions', async () => {
    await open(pages, '/billing');
    expect(await screen.findByText('billing overview')).toBeTruthy();
    cleanup();
    await open(pages, '/billing/new');
    expect(await screen.findByText('invoice composer')).toBeTruthy();
    cleanup();
    await open(pages, '/billing/inv-1/edit');
    expect(await screen.findByText('invoice editor')).toBeTruthy();
  });

  it('wraps a layout page and its children in the layout, and shows the page itself as the index', async () => {
    await open(pages, '/settings');
    expect(await screen.findByText('settings chrome')).toBeTruthy();
    expect(screen.getByText('settings index')).toBeTruthy();
    cleanup();
    await open(pages, '/settings/general');
    expect(await screen.findByText('settings chrome')).toBeTruthy();
    expect(screen.getByText('settings section')).toBeTruthy();
    expect(screen.queryByText('settings index')).toBeNull();
  });

  it('lets a static path win over a param path', async () => {
    await open(pages, '/records/new');
    expect(await screen.findByText('new record')).toBeTruthy();
    expect(screen.queryByText('object view')).toBeNull();
    cleanup();
    await open(pages, '/records/person');
    expect(await screen.findByText('object view')).toBeTruthy();
  });

  it('hands every page to the wrapper, so each one is gated on its own', async () => {
    const seen: string[] = [];
    await open(pages, '/billing/new', (page, node) => {
      seen.push(page.path);

      return <div data-page={page.path}>{node}</div>;
    });
    expect(await screen.findByText('invoice composer')).toBeTruthy();
    expect(seen).toContain('billing/new');
    expect(document.querySelector('[data-page="billing/new"]')).not.toBeNull();
  });
});
