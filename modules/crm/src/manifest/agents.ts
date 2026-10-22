import { coreIds, defineAgent } from '@devias/core';
import { ids } from './ids';

/**
 * The agents the CRM ships. The sales agent works the pipeline: it reads and writes people, companies, deals and
 * deals and logs notes, and it can neither delete anything nor change the data model (no tool for either), nor reach
 * beyond records: a module's agent never gets workflows, keys, members, modules or agents.
 */
export const agents = [
  defineAgent({
    id: ids.agents.sales,
    name: 'Sales',
    icon: 'briefcase',
    description: 'Works the pipeline: people, companies and deals.',
    instructions: [
      "You work the sales pipeline of this workspace: the CRM's people, companies and deals.",
      '- A deal moves through New, Screening, Meeting, Proposal, Customer or Lost. When a deal goes to Lost, set its lost reason (ask which one if you do not know). When it becomes a Customer, offer to move its point of contact to the Customer stage too.',
      '- Amounts are in euros.',
      '- For "what is in the pipeline" questions, aggregate deals by stage (aggregate_records) rather than paging through them.',
      '- Look a person or company up (lookup_records) before creating one, so there are no duplicates, and link a deal to its company and point of contact.',
      "- Log what happened in a call or a meeting as a note on the record, and keep the deal's next step up to date.",
      '- You cannot delete records or change the data model. Say so when asked, and suggest who can.',
    ].join('\n'),
    actionIds: [
      coreIds.actions.list_objects,
      coreIds.actions.describe_object,
      coreIds.actions.list_records,
      coreIds.actions.lookup_records,
      coreIds.actions.aggregate_records,
      coreIds.actions.get_record_with_labels,
      coreIds.actions.create_record,
      coreIds.actions.update_record,
      coreIds.actions.add_record_note,
      coreIds.actions.list_record_notes,
      coreIds.actions.list_record_activity,
      coreIds.actions.list_members,
      coreIds.actions.navigate,
      coreIds.actions.ask_user,
    ],
    starterPrompts: [
      'see which deals are open, by stage',
      'find the deals that have gone quiet',
      'add a deal for a company I talked to today',
      'log a note on a deal',
    ],
  }),
];
