import type { StructureNode } from '@devias/core';
import { BrandMark, type SidebarLinkProps, SidebarNav, type SidebarNavGroup, SidebarNavItems } from '@devias/ui';
import { useMemo } from 'react';
import { useSettingsNavGroups } from '../pages/settings/nav';
import { useSchema } from '../providers/schema';
import { useStudioConfig } from '../providers/studio-config';
import { useWorkspace } from '../providers/workspace';
import { useAvailablePages } from '../registries';
import { isActiveHref, links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { SidebarToggle } from './sidebar-toggle';
import { resolvePinned, resolveStructure } from './structure';
import { WorkspaceSwitcher } from './workspace-switcher';

/** The brand mark in the brand color, without its tile, at the start of the sidebar header. */

/** A link that leaves the studio: an address opens the mail app, a page opens in a new tab. */
const OutsideLink = ({ href, className, children, onClick }: SidebarLinkProps) => (
  <a
    href={href}
    className={className}
    onClick={onClick}
    {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noreferrer' } : {})}
  >
    {children}
  </a>
);

/** Settings sits at the bottom rather than among the destinations. */
const SETTINGS_PAGE = 'settings';

/**
 * Built-in sidebar: logo, workspace + collapse toggle on top (a collapsed rail stacks the toggle over the logo), the
 * pinned nav items (Home, Workflows, Agents), the structure-driven groups, with settings at the bottom. Panels such as the agent are toggled from the top bar.
 */
export function StudioSidebar({ structure }: { structure: StructureNode }) {
  const { index } = useSchema();
  const { slug, organization } = useWorkspace();
  const navigation = useNavigation();
  // Only this workspace's pages: a module that is not installed here keeps its pages out of the sidebar.
  const availablePages = useAvailablePages();
  const groups = useMemo<SidebarNavGroup[]>(
    () =>
      resolveStructure(structure, {
        index,
        pages: availablePages,
        slug,
        pathname: navigation.pathname,
        search: navigation.search,
      }),
    [structure, index, availablePages, slug, navigation.pathname, navigation.search],
  );
  // Pinned nav items (Home, Workflows, Agents) stay above the sections whatever the workspace arranged.
  const pinnedItems = resolvePinned({
    index,
    pages: availablePages,
    slug,
    pathname: navigation.pathname,
    search: navigation.search,
  });
  const settings = availablePages.get(SETTINGS_PAGE);
  const settingsHref = links.page(slug, SETTINGS_PAGE);
  const { contact } = useStudioConfig();
  const settingsGroups = useSettingsNavGroups();
  // In Settings the sidebar is the settings menu: the same header, a way back to the app on top, the sections below.
  const inSettings = isActiveHref(settingsHref, navigation.pathname, {});

  return (
    <SidebarNav
      groups={inSettings ? settingsGroups : groups}
      linkComponent={navigation.Link}
      // Same height as the top bar, so the first rows line up across the window.
      headerClassName="flex min-h-[var(--topbar-h)] items-center gap-1 group-data-[sidebar=collapsed]/shell:flex-col group-data-[sidebar=collapsed]/shell:justify-start group-data-[sidebar=collapsed]/shell:gap-3 group-data-[sidebar=collapsed]/shell:pt-2.5"
      header={
        <>
          <div className="shrink-0 pl-1.5 group-data-[sidebar=collapsed]/shell:order-2 group-data-[sidebar=collapsed]/shell:pl-0">
            <navigation.Link
              href={links.workspace(slug)}
              title={organization.name}
              className="flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <BrandMark tile={false} className="size-5.5" />
            </navigation.Link>
          </div>
          <div className="min-w-0 flex-1 group-data-[sidebar=collapsed]/shell:hidden">
            <WorkspaceSwitcher />
          </div>
          <SidebarToggle className="group-data-[sidebar=collapsed]/shell:order-1" />
        </>
      }
      pinned={
        inSettings ? (
          <SidebarNavItems
            items={[{ id: 'back', label: 'Back to app', icon: 'arrow-left', href: links.workspace(slug) }]}
            linkComponent={navigation.Link}
          />
        ) : pinnedItems.length > 0 ? (
          <SidebarNavItems items={pinnedItems} linkComponent={navigation.Link} />
        ) : undefined
      }
      footer={
        <div className="flex flex-col gap-0.5">
          {contact ? (
            <SidebarNavItems
              items={[
                {
                  id: 'contact',
                  label: contact.label ?? 'Get in touch',
                  icon: contact.icon ?? 'mail',
                  href: contact.href,
                },
              ]}
              linkComponent={OutsideLink}
            />
          ) : null}
          {!inSettings && settings ? (
            <SidebarNavItems
              items={[
                {
                  id: `page-${SETTINGS_PAGE}`,
                  label: settings.label ?? 'Settings',
                  icon: settings.icon ?? 'settings',
                  href: settingsHref,
                  active: isActiveHref(settingsHref, navigation.pathname, {}),
                },
              ]}
              linkComponent={navigation.Link}
            />
          ) : null}
        </div>
      }
    />
  );
}
