import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/**
 * The sidebar: three sections, each opening onto the things inside it. Sections are headings only (they go
 * nowhere themselves); the rows under them are what people open.
 */
export const navItems = [
  defineNavItem({
    id: ids.nav.contacts_group,
    label: 'Prospects',
    icon: 'users',
    target: { kind: 'group' },
  }),
  defineNavItem({
    id: ids.nav.people,
    label: 'People',
    target: { kind: 'object', objectId: ids.objects.person },
    parentId: ids.nav.contacts_group,
  }),
  defineNavItem({
    id: ids.nav.companies,
    label: 'Companies',
    target: { kind: 'object', objectId: ids.objects.company },
    parentId: ids.nav.contacts_group,
  }),
  defineNavItem({
    id: ids.nav.sales_group,
    label: 'Sales',
    icon: 'target',
    target: { kind: 'group' },
  }),
  defineNavItem({
    id: ids.nav.deals,
    label: 'Deals',
    target: { kind: 'object', objectId: ids.objects.deal, viewId: ids.views.deal.pipeline },
    parentId: ids.nav.sales_group,
  }),
  defineNavItem({
    id: ids.nav.forecast,
    label: 'Forecast',
    target: { kind: 'page', pageId: ids.pages.forecast },
    parentId: ids.nav.sales_group,
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
    id: ids.commands.new_deal,
    label: 'New deal',
    icon: 'target',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.deal },
  }),
];
