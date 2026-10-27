import type { SidebarNavGroup } from '@devias/ui';
import { useStudioConfig } from '../../providers/studio-config';
import { useWorkspace } from '../../providers/workspace';
import { isActiveHref, links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

const GROUPS = [
  { id: 'account', title: 'Account' },
  { id: 'workspace', title: 'Workspace' },
  { id: 'data', title: 'Data' },
  { id: 'developer', title: 'Developer' },
] as const;

/** The settings sections as sidebar groups, the open one marked: what the app sidebar shows while in Settings. */
export function useSettingsNavGroups(): SidebarNavGroup[] {
  const config = useStudioConfig();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const sections = [...config.registries.settingsSections.values()];

  return GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    collapsible: false,
    items: sections
      .filter((s) => (s.group ?? 'workspace') === group.id)
      .map((s) => {
        const href = links.settings(slug, s.name);

        return {
          id: s.name,
          label: s.label,
          icon: s.icon ?? 'settings',
          href,
          active: isActiveHref(href, navigation.pathname, {}),
        };
      }),
  })).filter((g) => g.items.length > 0);
}
