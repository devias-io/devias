import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/** A Products row of its own in the sidebar, and the command that makes one. */
export const navItems = [
  defineNavItem({
    id: ids.nav.products,
    label: 'Products',
    icon: 'package',
    target: { kind: 'object', objectId: ids.objects.product, viewId: ids.views.product.all },
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_product,
    label: 'New product',
    icon: 'package',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.product },
  }),
];
