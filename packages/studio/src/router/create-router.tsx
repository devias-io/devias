import {
  type AuthAdapter,
  isPageAvailable,
  type PageDefinition,
  pageTitle,
  type ResolvedStudioConfig,
} from '@devias/core';
import { Button, EmptyState, UiGallery } from '@devias/ui';
import type { QueryClient } from '@tanstack/react-query';
import {
  type AnyRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { type ReactNode, useMemo } from 'react';
import { InvitePage, SignInPage, SignUpPage, WorkspacesPage } from '../auth/pages';
import { useSchema } from '../providers/schema';
import { useWorkspace } from '../providers/workspace';
import { WorkspaceProviders } from '../providers/workspace-providers';
import { useCoreModules } from '../registries';
import { ErrorBoundary } from '../shell/error-boundary';
import { StudioShell } from '../shell/studio-shell';
import { links, splitHref } from './links';
import { type Navigation, NavigationProvider, type StudioLinkProps } from './navigation';
import { NotFoundPage, WorkspaceNotFoundPage } from './not-found';
import { buildPageRoutes } from './page-routes';
import { RouteErrorPage } from './route-error';
import { getOrganizationBySlugCached, getSessionCached, rememberActiveOrganization } from './session-cache';

export interface RouterContext {
  auth: AuthAdapter;
  config: ResolvedStudioConfig;
  queryClient: QueryClient;
}

const isDev = (): boolean => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

const RouterLink = ({ href, className, children, onClick, title }: StudioLinkProps) => {
  const { pathname, search } = splitHref(href);

  return (
    <Link to={pathname} search={search} className={className} onClick={onClick} title={title}>
      {children}
    </Link>
  );
};

/** Adapts TanStack Router to the studio's navigation seam. */
function RouterNavigation({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false }) as Record<string, string>;
  const value = useMemo<Navigation>(
    () => ({
      pathname: location.pathname,
      search: (location.search ?? {}) as Record<string, unknown>,
      params,
      navigate: (href, options) => {
        const { pathname, search } = splitHref(href);
        void navigate({ to: pathname, search, replace: options?.replace ?? false });
      },
      Link: RouterLink,
    }),
    [location.pathname, location.search, params, navigate],
  );

  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}

/** A page's route stays registered for every workspace; where its module is not installed it says so instead. */
function PageGate({ page, title, children }: { page: PageDefinition; title: string | undefined; children: ReactNode }) {
  const { index } = useSchema();
  const core = useCoreModules();
  const { slug, isAdmin } = useWorkspace();

  if (isPageAvailable(page, index, core)) {
    return <>{children}</>;
  }

  const name = title ?? page.path;

  return (
    <EmptyState
      icon={page.icon ?? 'box'}
      title={`${name} is not installed`}
      description="The module that adds it is not installed in this workspace."
      action={
        isAdmin ? (
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link to={links.settings(slug, 'modules')} />}
          >
            Open modules
          </Button>
        ) : undefined
      }
    />
  );
}

const searchString = (search: Record<string, unknown>, key: string) =>
  typeof search[key] === 'string' ? (search[key] as string) : undefined;

export const createStudioRouter = ({
  config,
  auth,
  queryClient,
}: {
  config: ResolvedStudioConfig;
  auth: AuthAdapter;
  queryClient: QueryClient;
}) => {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <RouterNavigation>
        <Outlet />
      </RouterNavigation>
    ),
    notFoundComponent: NotFoundPage,
  });

  const requireSession = async (context: RouterContext, href: string) => {
    const session = await getSessionCached(context.auth);

    if (!session) {
      throw redirect({ to: '/sign-in', search: { redirect: href } });
    }

    return session;
  };

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: async ({ context }) => {
      const session = await getSessionCached(context.auth);

      if (!session) {
        throw redirect({ to: '/sign-in' });
      }

      if (session.activeOrganizationId) {
        const organizations = await context.auth.organizations.list();
        const active = organizations.find((o) => o.id === session.activeOrganizationId);

        if (active) {
          throw redirect({ to: links.workspace(active.slug) });
        }
      }

      throw redirect({ to: '/workspaces' });
    },
    component: () => null,
  });

  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    validateSearch: (search: Record<string, unknown>) => ({ redirect: searchString(search, 'redirect') }),
    beforeLoad: async ({ context }) => {
      const session = await getSessionCached(context.auth);

      if (session) {
        throw redirect({ to: '/' });
      }
    },
    component: SignInPage,
  });

  const signUpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-up',
    beforeLoad: async ({ context }) => {
      const session = await getSessionCached(context.auth);

      if (session) {
        throw redirect({ to: '/' });
      }
    },
    component: SignUpPage,
  });

  const workspacesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces',
    beforeLoad: async ({ context, location }) => {
      await requireSession(context, location.href);
    },
    component: WorkspacesPage,
  });

  const inviteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/invite/$invitationId',
    beforeLoad: async ({ context, location }) => {
      await requireSession(context, location.href);
    },
    component: InvitePage,
  });

  const devRoutes: AnyRoute[] = isDev()
    ? [createRoute({ getParentRoute: () => rootRoute, path: '/dev/ui', component: UiGallery })]
    : [];

  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$workspaceSlug',
    beforeLoad: async ({ context, params, location }) => {
      const session = await requireSession(context, location.href);
      const organization = await getOrganizationBySlugCached(context.auth, params.workspaceSlug);

      if (!organization) {
        throw redirect({ to: '/workspaces' });
      }

      if (session.activeOrganizationId !== organization.id) {
        await context.auth.organizations.setActive({ organizationId: organization.id });
        rememberActiveOrganization(organization.id);
      }

      return { session, organization };
    },
    component: function WorkspaceLayout() {
      const { session, organization } = workspaceRoute.useRouteContext();

      return (
        <WorkspaceProviders organization={organization} user={session.user}>
          <StudioShell>
            <Outlet />
          </StudioShell>
        </WorkspaceProviders>
      );
    },
  });

  const workspaceIndexRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: '/',
    beforeLoad: ({ params }) => {
      throw redirect({ to: links.page(params.workspaceSlug, config.defaultPage) });
    },
    component: () => null,
  });

  const pages = config.registries.pages;
  const pageRoutes = buildPageRoutes(pages, workspaceRoute, (page, node) => {
    const title = pageTitle(pages, page.path);

    return (
      <ErrorBoundary title={title ? `${title} failed to render` : undefined}>
        <PageGate page={page} title={title}>
          {node}
        </PageGate>
      </ErrorBoundary>
    );
  });

  const workspaceNotFoundRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: '$',
    component: WorkspaceNotFoundPage,
  });

  const routeTree = rootRoute.addChildren([
    indexRoute,
    signInRoute,
    signUpRoute,
    workspacesRoute,
    inviteRoute,
    ...devRoutes,
    workspaceRoute.addChildren([workspaceIndexRoute, ...pageRoutes, workspaceNotFoundRoute]),
  ]);

  return createRouter({
    routeTree,
    context: { auth, config, queryClient },
    defaultPreload: false,
    defaultErrorComponent: RouteErrorPage,
    ...(config.basePath && config.basePath !== '/' ? { basepath: config.basePath } : {}),
  });
};

export type StudioRouter = ReturnType<typeof createStudioRouter>;
