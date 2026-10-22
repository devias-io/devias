import { defineField, defineObject, type InferRecord } from '@devias/core';
import { ids } from './ids';

/** The Fixture's objects: people, companies, opportunities, notes and chores, with their fields and option lists. */

export const OPPORTUNITY_STAGES = [
  { value: 'new', label: 'New', color: 'neutral' },
  { value: 'screening', label: 'Screening', color: 'blue' },
  { value: 'meeting', label: 'Meeting', color: 'purple' },
  { value: 'proposal', label: 'Proposal', color: 'orange' },
  { value: 'customer', label: 'Customer', color: 'green' },
  { value: 'lost', label: 'Lost', color: 'red' },
] as const;

export const INDUSTRIES = [
  { value: 'software', label: 'Software' },
  { value: 'services', label: 'Services' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail', label: 'Retail' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'other', label: 'Other' },
] as const;

export const person = defineObject({
  id: ids.objects.person,
  nameSingular: 'person',
  namePlural: 'people',
  labelSingular: 'Person',
  labelPlural: 'People',
  icon: 'user',
  description: 'A contact you work with.',
  primaryFieldId: ids.fields.person.first_name,
  fields: [
    defineField({
      id: ids.fields.person.first_name,
      name: 'first_name',
      label: 'First name',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.person.last_name,
      name: 'last_name',
      label: 'Last name',
      type: 'text',
      position: 1,
    }),
    defineField({
      id: ids.fields.person.email,
      name: 'email',
      label: 'Email',
      type: 'email',
      isUnique: true,
      position: 2,
    }),
    defineField({ id: ids.fields.person.phone, name: 'phone', label: 'Phone', type: 'phone', position: 3 }),
    defineField({
      id: ids.fields.person.job_title,
      name: 'job_title',
      label: 'Job title',
      type: 'text',
      position: 4,
    }),
    defineField({
      id: ids.fields.person.company,
      name: 'company',
      label: 'Company',
      type: 'relation',
      icon: 'building-2',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.company,
        inverseLabel: 'People',
      },
      position: 5,
    }),
    defineField({ id: ids.fields.person.city, name: 'city', label: 'City', type: 'text', position: 6 }),
    defineField({
      id: ids.fields.person.linkedin,
      name: 'linkedin',
      label: 'LinkedIn',
      type: 'url',
      position: 7,
    }),
  ],
});
export type Person = InferRecord<typeof person>;

export const company = defineObject({
  id: ids.objects.company,
  nameSingular: 'company',
  namePlural: 'companies',
  labelSingular: 'Company',
  labelPlural: 'Companies',
  icon: 'building-2',
  description: 'An organisation you sell to or partner with.',
  primaryFieldId: ids.fields.company.name,
  fields: [
    defineField({
      id: ids.fields.company.name,
      name: 'name',
      label: 'Name',
      type: 'text',
      isRequired: true,
      isUnique: true,
      position: 0,
    }),
    defineField({ id: ids.fields.company.domain, name: 'domain', label: 'Domain', type: 'url', position: 1 }),
    defineField({
      id: ids.fields.company.industry,
      name: 'industry',
      label: 'Industry',
      type: 'select',
      settings: { options: [...INDUSTRIES] },
      position: 2,
    }),
    defineField({
      id: ids.fields.company.employees,
      name: 'employees',
      label: 'Employees',
      type: 'number',
      settings: { precision: 0 },
      position: 3,
    }),
    defineField({
      id: ids.fields.company.annual_revenue,
      name: 'annual_revenue',
      label: 'Annual revenue',
      type: 'money',
      settings: { currencyCode: 'EUR' },
      position: 4,
    }),
    defineField({
      id: ids.fields.company.ideal_customer_profile,
      name: 'ideal_customer_profile',
      label: 'Ideal customer',
      type: 'boolean',
      defaultValue: false,
      position: 5,
    }),
    defineField({ id: ids.fields.company.city, name: 'city', label: 'City', type: 'text', position: 6 }),
  ],
});
export type Company = InferRecord<typeof company>;

export const opportunity = defineObject({
  id: ids.objects.opportunity,
  nameSingular: 'opportunity',
  namePlural: 'opportunities',
  labelSingular: 'Opportunity',
  labelPlural: 'Opportunities',
  icon: 'target',
  description: 'A deal in your pipeline.',
  primaryFieldId: ids.fields.opportunity.name,
  fields: [
    defineField({
      id: ids.fields.opportunity.name,
      name: 'name',
      label: 'Name',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.opportunity.stage,
      name: 'stage',
      label: 'Stage',
      type: 'select',
      settings: { options: [...OPPORTUNITY_STAGES] },
      defaultValue: 'new',
      isRequired: true,
      position: 1,
    }),
    defineField({
      id: ids.fields.opportunity.amount,
      name: 'amount',
      label: 'Amount',
      type: 'money',
      settings: { currencyCode: 'EUR' },
      position: 2,
    }),
    defineField({
      id: ids.fields.opportunity.close_date,
      name: 'close_date',
      label: 'Close date',
      type: 'date',
      position: 3,
    }),
    defineField({
      id: ids.fields.opportunity.probability,
      name: 'probability',
      label: 'Probability',
      type: 'number',
      settings: { precision: 0, format: 'percent' },
      position: 4,
    }),
    defineField({
      id: ids.fields.opportunity.rating,
      name: 'rating',
      label: 'Rating',
      type: 'rating',
      position: 5,
    }),
    defineField({
      id: ids.fields.opportunity.company,
      name: 'company',
      label: 'Company',
      type: 'relation',
      icon: 'building-2',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.company,
        inverseLabel: 'Opportunities',
      },
      position: 6,
    }),
    defineField({
      id: ids.fields.opportunity.point_of_contact,
      name: 'point_of_contact',
      label: 'Point of contact',
      type: 'relation',
      icon: 'user',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.person,
        inverseLabel: 'Opportunities',
      },
      position: 7,
    }),
  ],
});
export type Opportunity = InferRecord<typeof opportunity>;

export const note = defineObject({
  id: ids.objects.note,
  nameSingular: 'note',
  namePlural: 'notes',
  labelSingular: 'Note',
  labelPlural: 'Notes',
  icon: 'sticky-note',
  description: 'Free-form notes attached to people and companies.',
  primaryFieldId: ids.fields.note.title,
  fields: [
    defineField({
      id: ids.fields.note.title,
      name: 'title',
      label: 'Title',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.note.body,
      name: 'body',
      label: 'Body',
      type: 'text',
      settings: { multiline: true },
      position: 1,
    }),
    defineField({
      id: ids.fields.note.person,
      name: 'person',
      label: 'Person',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.person,
        inverseLabel: 'Notes',
      },
      position: 2,
    }),
    defineField({
      id: ids.fields.note.company,
      name: 'company',
      label: 'Company',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.company,
        inverseLabel: 'Notes',
      },
      position: 3,
    }),
  ],
});
export type Note = InferRecord<typeof note>;

export const chore = defineObject({
  id: ids.objects.chore,
  nameSingular: 'chore',
  namePlural: 'chores',
  labelSingular: 'Chore',
  labelPlural: 'Chores',
  icon: 'check-square',
  description: 'Things to do, optionally linked to a deal or a person.',
  primaryFieldId: ids.fields.chore.title,
  fields: [
    defineField({
      id: ids.fields.chore.title,
      name: 'title',
      label: 'Title',
      type: 'text',
      isRequired: true,
      position: 0,
    }),
    defineField({
      id: ids.fields.chore.due_date,
      name: 'due_date',
      label: 'Due date',
      type: 'date',
      position: 1,
    }),
    defineField({
      id: ids.fields.chore.done,
      name: 'done',
      label: 'Done',
      type: 'boolean',
      defaultValue: false,
      position: 2,
    }),
    defineField({
      id: ids.fields.chore.assignee,
      name: 'assignee',
      label: 'Assignee',
      type: 'text',
      position: 3,
    }),
    defineField({
      id: ids.fields.chore.opportunity,
      name: 'opportunity',
      label: 'Opportunity',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.opportunity,
        inverseLabel: 'Chores',
      },
      position: 4,
    }),
    defineField({
      id: ids.fields.chore.person,
      name: 'person',
      label: 'Person',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: ids.objects.person,
        inverseLabel: 'Chores',
      },
      position: 5,
    }),
  ],
});
export type Chore = InferRecord<typeof chore>;
