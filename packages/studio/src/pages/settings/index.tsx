import { definePageComponent } from '@devias/core';
import { cn, EmptyState, Page, PageHeader } from '@devias/ui';
import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useStudioConfig } from '../../providers/studio-config';
import { roleSatisfies, useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { ErrorBoundary } from '../../shell/error-boundary';
import { PageSkeleton } from '../../shell/skeletons';

/** Sections of tables and lists that need more room than the centered column of a form. */
const WIDE_SECTIONS = new Set(['data-model', 'modules']);

/** Settings has no sidebar of its own: while it is open the app sidebar shows its sections (see `useSettingsNavGroups`). */
export function SettingsLayout() {
  return (
    <div className="relative h-full min-h-0 overflow-auto">
      <Outlet />
    </div>
  );
}

export function SettingsIndexPage() {
  const config = useStudioConfig();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const first = [...config.registries.settingsSections.values()][0];
  useEffect(() => {
    if (first) {
      navigation.navigate(links.settings(slug, first.name), { replace: true });
    }
  }, [first, navigation, slug]);

  return first ? null : <EmptyState icon="settings" title="No settings sections registered" />;
}

export function SettingsSectionPage() {
  const config = useStudioConfig();
  const { params } = useNavigation();
  const { role, roleStatus, slug } = useWorkspace();
  const section = config.registries.settingsSections.get(params.section ?? '');
  useSetBreadcrumbs([
    { label: 'Settings', href: links.settings(slug) },
    { label: section?.label ?? 'Unknown section' },
  ]);

  if (!section) {
    return <EmptyState icon="circle-help" title="Unknown settings section" description={params.section} />;
  }

  if (section.requiresRole && roleStatus === 'loading') {
    return <PageSkeleton />;
  }

  if (!roleSatisfies(role, section.requiresRole)) {
    return (
      <EmptyState
        icon="lock"
        title={`${section.label} is for ${section.requiresRole}s`}
        description={`Ask a workspace ${section.requiresRole} to make this change or to give you the ${section.requiresRole} role.`}
      />
    );
  }

  const Component = section.component;

  // A page for one item draws its own header, edge to edge, when the section says so.
  if (section.detail && params.item) {
    return (
      <Page fullBleed>
        <ErrorBoundary title={`${section.label} failed to render`}>
          <Component />
        </ErrorBoundary>
      </Page>
    );
  }

  return (
    <Page
      className={cn(
        'mx-auto w-full px-6 pt-8 pb-12 sm:px-10',
        WIDE_SECTIONS.has(section.name) ? 'max-w-6xl' : 'max-w-4xl',
      )}
    >
      <PageHeader title={section.label} />
      <ErrorBoundary title={`${section.label} failed to render`}>
        <Component />
      </ErrorBoundary>
    </Page>
  );
}

export const settingsPages = [
  definePageComponent({
    path: 'settings',
    label: 'Settings',
    icon: 'settings',
    layout: SettingsLayout,
    component: SettingsIndexPage,
  }),
  definePageComponent({ path: 'settings/$section', component: SettingsSectionPage }),
  definePageComponent({ path: 'settings/$section/$item', component: SettingsSectionPage }),
];
