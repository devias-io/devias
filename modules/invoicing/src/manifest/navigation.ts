import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/**
 * A Billing section with three rows: the overview (the Billing page: what is outstanding, overdue and collected), the
 * invoices table and the payments table. Lines are reached from an invoice. Plus two palette commands.
 */
export const navItems = [
  defineNavItem({
    id: ids.nav.billing_group,
    label: 'Billing',
    icon: 'dollar-sign',
    target: { kind: 'group' },
  }),
  defineNavItem({
    id: ids.nav.overview,
    label: 'Overview',
    target: { kind: 'page', pageId: ids.pages.billing },
    parentId: ids.nav.billing_group,
  }),
  defineNavItem({
    id: ids.nav.invoices,
    label: 'Invoices',
    target: { kind: 'object', objectId: ids.objects.invoice },
    parentId: ids.nav.billing_group,
  }),
  defineNavItem({
    id: ids.nav.payments,
    label: 'Payments',
    target: { kind: 'object', objectId: ids.objects.payment },
    parentId: ids.nav.billing_group,
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_invoice,
    label: 'New invoice',
    icon: 'receipt',
    group: 'Create',
    action: { kind: 'navigate', target: { kind: 'page', pageId: ids.pages.billing_new } },
  }),
  defineCommandItem({
    id: ids.commands.go_to_billing,
    label: 'Go to billing',
    icon: 'dollar-sign',
    group: 'Navigate',
    shortcut: 'g b',
    action: { kind: 'navigate', target: { kind: 'page', pageId: ids.pages.billing } },
  }),
];
