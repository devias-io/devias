import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/** An Expenses section in the sidebar, and commands to log one or open them. */
export const navItems = [
  defineNavItem({
    id: ids.nav.expenses,
    label: 'Expenses',
    icon: 'wallet',
    target: { kind: 'group' },
    position: 30,
  }),
  defineNavItem({
    id: ids.nav.all_expenses,
    label: 'All expenses',
    target: { kind: 'object', objectId: ids.objects.expense, viewId: ids.views.expense.all },
    parentId: ids.nav.expenses,
  }),
  defineNavItem({
    id: ids.nav.to_approve,
    label: 'To approve',
    target: { kind: 'object', objectId: ids.objects.expense, viewId: ids.views.expense.to_approve },
    parentId: ids.nav.expenses,
  }),
  defineNavItem({
    id: ids.nav.to_reimburse,
    label: 'To reimburse',
    target: { kind: 'object', objectId: ids.objects.expense, viewId: ids.views.expense.to_reimburse },
    parentId: ids.nav.expenses,
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_expense,
    label: 'New expense',
    icon: 'wallet',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.expense },
  }),
  defineCommandItem({
    id: ids.commands.go_to_expenses,
    label: 'Go to expenses',
    icon: 'wallet',
    group: 'Navigate',
    shortcut: 'g e',
    action: { kind: 'navigate', target: { kind: 'object', objectId: ids.objects.expense } },
  }),
];
