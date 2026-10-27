import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** Record layouts for people, companies and opportunities. */
export const layouts = [
  defineLayout({
    id: ids.layouts.person.default,
    objectId: ids.objects.person,
    label: 'Person',
    isDefault: true,
    shell: 'tabs',
    tabs: [
      {
        name: 'overview',
        label: 'Overview',
        blocks: [
          // The card draws the name itself, so no heading.
          { name: 'summary', blockId: ids.blocks.person_summary, columnSpan: 4 },
          {
            name: 'details',
            label: 'Details',
            blockId: coreIds.blocks.fields,
            config: {
              fieldIds: [
                ids.fields.person.first_name,
                ids.fields.person.last_name,
                ids.fields.person.email,
                ids.fields.person.phone,
                ids.fields.person.job_title,
                ids.fields.person.company,
                ids.fields.person.city,
                ids.fields.person.linkedin,
              ],
            },
            columnSpan: 8,
          },
          {
            name: 'opportunities',
            label: 'Opportunities',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.opportunity, fieldId: ids.fields.opportunity.point_of_contact },
            columnSpan: 12,
          },
          {
            name: 'chores',
            label: 'Chores',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.chore, fieldId: ids.fields.chore.person },
            columnSpan: 6,
          },
          {
            name: 'notes',
            label: 'Notes',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.note, fieldId: ids.fields.note.person },
            columnSpan: 6,
          },
        ],
      },
    ],
  }),
  defineLayout({
    id: ids.layouts.company.default,
    objectId: ids.objects.company,
    label: 'Company',
    isDefault: true,
    shell: 'tabs',
    tabs: [
      {
        name: 'overview',
        label: 'Overview',
        blocks: [
          {
            name: 'details',
            label: 'Details',
            blockId: coreIds.blocks.fields,
            config: {
              fieldIds: [
                ids.fields.company.name,
                ids.fields.company.domain,
                ids.fields.company.industry,
                ids.fields.company.employees,
                ids.fields.company.annual_revenue,
                ids.fields.company.ideal_customer_profile,
                ids.fields.company.city,
              ],
            },
            columnSpan: 12,
          },
          {
            name: 'people',
            label: 'People',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.person, fieldId: ids.fields.person.company },
            columnSpan: 6,
          },
          {
            name: 'opportunities',
            label: 'Opportunities',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.opportunity, fieldId: ids.fields.opportunity.company },
            columnSpan: 6,
          },
          {
            name: 'notes',
            label: 'Notes',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.note, fieldId: ids.fields.note.company },
            columnSpan: 12,
          },
        ],
      },
    ],
  }),
  defineLayout({
    id: ids.layouts.opportunity.default,
    objectId: ids.objects.opportunity,
    label: 'Opportunity',
    isDefault: true,
    shell: 'tabs',
    tabs: [
      {
        name: 'overview',
        label: 'Overview',
        blocks: [
          {
            name: 'details',
            label: 'Details',
            blockId: coreIds.blocks.fields,
            config: {
              fieldIds: [
                ids.fields.opportunity.name,
                ids.fields.opportunity.stage,
                ids.fields.opportunity.amount,
                ids.fields.opportunity.close_date,
                ids.fields.opportunity.probability,
                ids.fields.opportunity.rating,
                ids.fields.opportunity.company,
                ids.fields.opportunity.point_of_contact,
              ],
            },
            columnSpan: 12,
          },
          {
            name: 'chores',
            label: 'Chores',
            blockId: coreIds.blocks.related_records,
            config: { objectId: ids.objects.chore, fieldId: ids.fields.chore.opportunity },
            columnSpan: 12,
          },
        ],
      },
    ],
  }),
];
