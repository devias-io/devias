import { defineBlock } from '@devias/core';
import { ids } from './ids';

/** The blocks the CRM's studio code registers, as data the server and the agent can see. */
export const blocks = [
  defineBlock({
    id: ids.blocks.person_summary,
    label: 'Person summary',
    description: "A person's avatar, name and contact details.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.company_summary,
    label: 'Company summary',
    description: "A company's logo, name and contact details.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.overview,
    label: 'Overview',
    description: 'Key figures and open deals for a person or a company.',
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.deal_stage,
    label: 'Deal stage',
    description: "A deal's stage, value and next step, with Mark won / Mark lost.",
    surfaces: ['record'],
  }),
  defineBlock({
    id: ids.blocks.pipeline,
    label: 'Pipeline',
    description: 'Open deals: their total value and the count per stage.',
    surfaces: ['home'],
  }),
  defineBlock({
    id: ids.blocks.new_this_week,
    label: 'New this week',
    description: 'People, companies and deals added since Monday.',
    surfaces: ['home'],
  }),
];
