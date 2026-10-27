import { defineModule } from '@devias/core';
import { blocks } from './blocks';
import { layouts } from './layouts';
import { commandItems, navItems } from './navigation';
import { chore, company, note, opportunity, person } from './objects';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. Imported by the studio (through the module), the server (to install it
 * in new workspaces) and the CLI.
 */
export const manifest = defineModule({
  id: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
  version: '0.2.0',
  label: 'Fixture',
  description: 'People, companies, opportunities, notes and chores.',
  icon: 'contact',
  objects: [person, company, opportunity, note, chore],
  views,
  layouts,
  navItems,
  commandItems,
  blocks,
});

export { ids } from './ids';

export {
  type Chore,
  type Company,
  chore,
  company,
  INDUSTRIES,
  type Note,
  note,
  OPPORTUNITY_STAGES,
  type Opportunity,
  opportunity,
  type Person,
  person,
} from './objects';
