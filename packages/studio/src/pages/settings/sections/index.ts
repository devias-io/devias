import type { SettingsSectionDefinition } from '@devias/core';
import { apiKeysSection } from './api-keys';
import { appearanceSection } from './appearance';
import { dataModelSection } from './data-model';
import { diagnosticsSection } from './diagnostics';
import { generalSection } from './general';
import { integrationsSection } from './integrations';
import { membersSection } from './members';
import { modulesSection } from './modules';
import { navigationSection } from './navigation';
import { profileSection } from './profile';
import { viewsSection } from './views';

export const builtinSettingsSections: SettingsSectionDefinition[] = [
  profileSection,
  appearanceSection,
  integrationsSection,
  generalSection,
  membersSection,
  modulesSection,
  navigationSection,
  dataModelSection,
  viewsSection,
  apiKeysSection,
  diagnosticsSection,
];

export { ModuleConnections, moduleIcon } from './module-runtime';
export { PlanDiffViewer } from './modules';
export {
  apiKeysSection,
  appearanceSection,
  dataModelSection,
  diagnosticsSection,
  generalSection,
  integrationsSection,
  membersSection,
  modulesSection,
  navigationSection,
  profileSection,
  viewsSection,
};
