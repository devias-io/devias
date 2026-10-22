import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** The record's history, in a tab of its own. Alone in its tab, a block needs no heading. */
const activityTab = {
  name: 'activity',
  label: 'Activity',
  blocks: [{ blockId: coreIds.blocks.activity }],
};

/** The record's notes, in a tab of their own. Alone in its tab, a block needs no heading. */
const notesTab = {
  name: 'notes',
  label: 'Notes',
  blocks: [{ blockId: coreIds.blocks.notes }],
};

/** A tab listing the records of an object whose relation field points at this one. */
const relatedTab = (name: string, label: string, objectId: string, fieldId: string) => ({
  name,
  label,
  blocks: [{ name, blockId: coreIds.blocks.related_records, config: { objectId, fieldId } }],
});

/** A group of fields in the aside of a `split` page: a label and an editable value each, empty ones behind one line. */
const asideFields = (name: string, label: string, fieldIds: string[]) => ({
  name,
  blockId: coreIds.blocks.fields,
  label,
  config: { fieldIds, collapseEmpty: true },
});

/** A group of a record's fields in the narrow column of the overview: a label and an editable value each. */
const sideDetails = (name: string, label: string, fieldIds: string[]) => ({
  name,
  blockId: coreIds.blocks.fields,
  label,
  column: 9,
  columnSpan: 4,
  config: { fieldIds, collapseEmpty: true },
});

/**
 * A person's first tab, in two columns: the wide one holds their figures, open deals, what happened lately and their
 * colleagues; the narrow one beside it their details, in three groups edited in place, then their company.
 */
const personOverviewTab = {
  name: 'overview',
  label: 'Overview',
  blocks: [
    { blockId: ids.blocks.overview, column: 1, columnSpan: 8, config: { part: 'main' } },
    sideDetails('contact', 'Contact', [
      ids.fields.person.email,
      ids.fields.person.phone,
      ids.fields.person.linkedin,
      ids.fields.person.twitter,
      ids.fields.person.github,
      ids.fields.person.website,
    ]),
    sideDetails('profile', 'Profile', [
      ids.fields.person.first_name,
      ids.fields.person.last_name,
      ids.fields.person.job_title,
      ids.fields.person.company,
      ids.fields.person.seniority,
      ids.fields.person.department,
      ids.fields.person.city,
      ids.fields.person.country,
      ids.fields.person.time_zone,
    ]),
    sideDetails('record', 'Record', [ids.fields.person.owner, ids.fields.person.source, ids.fields.person.stage]),
    { name: 'company', blockId: ids.blocks.overview, column: 9, columnSpan: 4, config: { part: 'side' } },
  ],
};

/**
 * A company's first tab, in the same two columns: the wide one holds its pipeline, open deals, people and what
 * happened lately; the narrow one beside it its details, in three groups edited in place.
 */
const companyOverviewTab = {
  name: 'overview',
  label: 'Overview',
  blocks: [
    { blockId: ids.blocks.overview, column: 1, columnSpan: 8, config: { part: 'main' } },
    sideDetails('contact', 'Contact', [
      ids.fields.company.domain,
      ids.fields.company.linkedin,
      ids.fields.company.email,
      ids.fields.company.phone,
    ]),
    sideDetails('profile', 'Profile', [
      ids.fields.company.name,
      ids.fields.company.logo,
      ids.fields.company.industry,
      ids.fields.company.employees,
      ids.fields.company.annual_revenue,
      ids.fields.company.ideal_customer_profile,
      ids.fields.company.city,
      ids.fields.company.description,
    ]),
    sideDetails('record', 'Record', [ids.fields.company.owner, ids.fields.company.source]),
  ],
};

/**
 * Record layouts for people, companies and deals: a header that says who or what the record is, then an overview,
 * the notes, the activity and the related records, a tab each (a deal is one page, read top to bottom).
 */
export const layouts = [
  defineLayout({
    id: ids.layouts.person.default,
    objectId: ids.objects.person,
    label: 'Person',
    isDefault: true,
    shell: 'tabs',
    // The header draws the name itself, so no heading. The details are on the overview.
    header: { blockId: ids.blocks.person_summary },
    tabs: [
      personOverviewTab,
      notesTab,
      activityTab,
      relatedTab('deals', 'Deals', ids.objects.deal, ids.fields.deal.point_of_contact),
    ],
  }),
  defineLayout({
    id: ids.layouts.company.default,
    objectId: ids.objects.company,
    label: 'Company',
    isDefault: true,
    shell: 'tabs',
    // The card draws the name itself, so no heading. The details are on the overview.
    header: { blockId: ids.blocks.company_summary },
    tabs: [
      companyOverviewTab,
      notesTab,
      activityTab,
      relatedTab('people', 'People', ids.objects.person, ids.fields.person.company),
      relatedTab('deals', 'Deals', ids.objects.deal, ids.fields.deal.company),
    ],
  }),
  defineLayout({
    id: ids.layouts.deal.default,
    objectId: ids.objects.deal,
    label: 'Deal',
    isDefault: true,
    // One page read top to bottom, not tabs: where the deal stands, then the conversation; who it is with and its terms sit beside. Other modules add
    // their own sections (the Quotes module puts its quotes after the stage) without this layout naming them.
    shell: 'split',
    main: [
      { blockId: coreIds.blocks.title, label: 'Name', config: { fieldId: ids.fields.deal.name } },
      { blockId: ids.blocks.deal_stage, label: 'Stage' },
      { blockId: coreIds.blocks.notes, label: 'Notes' },
      { blockId: coreIds.blocks.activity, label: 'Activity' },
    ],
    aside: [
      asideFields('people', 'People', [ids.fields.deal.company, ids.fields.deal.point_of_contact]),
      asideFields('deal', 'Deal', [
        ids.fields.deal.amount,
        ids.fields.deal.probability,
        ids.fields.deal.close_date,
        ids.fields.deal.rating,
      ]),
      asideFields('record', 'Record', [ids.fields.deal.owner, ids.fields.deal.source, ids.fields.deal.lost_reason]),
    ],
  }),
];
