import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/** A Quotes row of its own in the sidebar, and the command that makes one. */
export const navItems = [
  defineNavItem({
    id: ids.nav.quotes,
    label: 'Quotes',
    icon: 'file-text',
    target: { kind: 'object', objectId: ids.objects.quote, viewId: ids.views.quote.all },
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_quote,
    label: 'New quote',
    icon: 'file-text',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.quote },
  }),
];
