import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/**
 * The sidebar: three sections, each opening onto the things inside it. Sections are headings only (they go
 * nowhere themselves); the rows under them are what people open.
 */
export const navItems = [
  defineNavItem({
    id: ids.nav.contacts_group,
    label: 'Contacts',
    icon: 'users',
    target: { kind: 'group' },
    position: 0,
  }),
  defineNavItem({
    id: ids.nav.people,
    label: 'People',
    target: { kind: 'object', objectId: ids.objects.person },
    parentId: ids.nav.contacts_group,
    position: 0,
  }),
  defineNavItem({
    id: ids.nav.companies,
    label: 'Companies',
    target: { kind: 'object', objectId: ids.objects.company },
    parentId: ids.nav.contacts_group,
    position: 1,
  }),
  defineNavItem({
    id: ids.nav.sales_group,
    label: 'Sales',
    icon: 'target',
    target: { kind: 'group' },
    position: 1,
  }),
  defineNavItem({
    id: ids.blocks.pipeline,
    label: 'Pipeline',
    target: { kind: 'object', objectId: ids.objects.opportunity, viewId: ids.views.opportunity.pipeline },
    parentId: ids.nav.sales_group,
    position: 0,
  }),
  defineNavItem({
    id: ids.nav.opportunities,
    label: 'Opportunities',
    target: { kind: 'object', objectId: ids.objects.opportunity, viewId: ids.views.opportunity.all },
    parentId: ids.nav.sales_group,
    position: 1,
  }),
  defineNavItem({
    id: ids.nav.activity_group,
    label: 'Activity',
    icon: 'check-square',
    target: { kind: 'group' },
    position: 2,
  }),
  defineNavItem({
    id: ids.blocks.chores,
    label: 'Chores',
    target: { kind: 'object', objectId: ids.objects.chore },
    parentId: ids.nav.activity_group,
    position: 0,
  }),
  defineNavItem({
    id: ids.nav.notes,
    label: 'Notes',
    target: { kind: 'object', objectId: ids.objects.note },
    parentId: ids.nav.activity_group,
    position: 1,
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_person,
    label: 'New person',
    icon: 'user-plus',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.person },
  }),
  defineCommandItem({
    id: ids.commands.new_company,
    label: 'New company',
    icon: 'building-2',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.company },
  }),
  defineCommandItem({
    id: ids.commands.new_opportunity,
    label: 'New opportunity',
    icon: 'target',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.opportunity },
  }),
];
