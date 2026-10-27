import { defineModule } from '@devias/core';
import { actions } from './actions';
import { connections } from './connections';
import { ids } from './ids';
import { variables } from './variables';
import { workflows } from './workflows';

/**
 * Pure manifest: Context.dev as a source of facts about the people in the CRM, named `enrichment-<service>` as
 * payment and email providers are `payment-<service>` and `email-<service>`. The API key a workspace connects, the
 * score it asks of a match, the action that fills in a person, and the two workflows that run it. The server side
 * (`./server`) implements the action.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.1.0',
  label: 'Enrichment via Context.dev',
  description: 'Fill in the job title, location and profiles of CRM people from Context.dev.',
  icon: 'sparkles',
  logo: './logo.svg',
  website: 'https://context.dev',
  connections,
  variables,
  actions,
  workflows,
});

export { ids } from './ids';
