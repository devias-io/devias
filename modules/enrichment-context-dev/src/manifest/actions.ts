import { defineAction } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { ids } from './ids';

/** The action workflows, the API and the agent can call; `../server` implements it. */
export const actions = [
  defineAction({
    id: ids.actions.enrich_person,
    name: 'enrich_person',
    label: 'Enrich a person with Context.dev',
    icon: 'sparkles',
    description:
      'Look a CRM person up on Context.dev by their email (or their first and last name and a company or city) and fill in what is empty: job title, city, country, LinkedIn, X, GitHub and website, and the company when it is already in the CRM. Never overwrites what is there. A match costs 20 Context.dev credits, so a person looked up in the last 30 days is not looked up again unless `force` is set.',
    input: [
      { name: 'person_id', label: 'Person', type: 'record', objectId: crm.objects.person, required: true },
      {
        name: 'force',
        label: 'Look up again',
        type: 'boolean',
        help: 'Look the person up even if they were looked up recently.',
      },
    ],
    output: [
      { name: 'enriched', type: 'boolean', description: 'True when the person was updated.' },
      { name: 'reason', description: 'Why nothing was filled in, when nothing was.' },
      { name: 'score', type: 'number', description: "Context.dev's confidence in the match, from 0 to 100." },
      { name: 'fields', type: 'json', description: 'The names of the fields that were filled in.' },
    ],
  }),
];
