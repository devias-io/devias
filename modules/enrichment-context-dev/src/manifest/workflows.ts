import { defineWorkflow } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids } from './ids';

/**
 * Two ways to run the action. Looking a person up costs credits, so the one that runs on its own starts switched off:
 * the workspace turns it on when it wants every new person looked up.
 */
export const workflows = [
  defineWorkflow({
    id: ids.workflows.enrich_person,
    title: 'Enrich this person',
    description: "Fill in what is missing on a person from Context.dev. Run it from the person's Actions menu.",
    trigger: { kind: 'manual', objectId: crm.objects.person },
    steps: [
      {
        id: ids.steps.enrich_person,
        kind: 'action',
        actionId: ids.actions.enrich_person,
        input: { person_id: '{{record.id}}' },
      },
    ],
  }),
  defineWorkflow({
    id: ids.workflows.enrich_new_people,
    title: 'Enrich new people',
    description:
      'Look up every person added to the CRM and fill in what is missing. Imported people are not looked up. Each match costs 20 Context.dev credits.',
    enabled: false,
    trigger: { kind: 'record_event', objectId: crm.objects.person, types: ['record.created'] },
    steps: [
      {
        id: ids.steps.enrich_new_person,
        kind: 'action',
        actionId: ids.actions.enrich_person,
        input: { person_id: '{{record.id}}' },
      },
    ],
  }),
];
