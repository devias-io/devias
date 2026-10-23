import { defineModule } from '@devias/core';
import { agents } from './agents';
import { blocks } from './blocks';
import { layouts } from './layouts';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { pages } from './pages';
import { skills } from './skills';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. Imported by the studio (through the module), the server (to install it
 * in new workspaces) and the CLI.
 */
export const manifest = defineModule({
  id: 'crm',
  version: '0.1.0',
  name: 'CRM',
  description: 'People, companies and deals.',
  icon: 'contact',
  publisher: { id: 'devias', name: 'Devias', url: 'https://devias.io' },
  objects,
  views,
  layouts,
  navItems,
  commandItems,
  blocks,
  pages,
  agents,
  skills,
});

export { ids } from './ids';

export {
  CONTACT_STAGES,
  type Company,
  DEAL_STAGES,
  DEPARTMENTS,
  type Deal,
  INDUSTRIES,
  LOST_REASONS,
  type Person,
  SENIORITIES,
  SOURCES,
} from './objects';
