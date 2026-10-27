import { defineCommandItem, defineNavItem } from '@devias/core';
import { ids } from './ids';

/** An Inventory section in the sidebar (locations and stock moves), and commands to record a move or open them. */
export const navItems = [
  defineNavItem({
    id: ids.nav.inventory,
    label: 'Inventory',
    icon: 'package',
    target: { kind: 'group' },
  }),
  defineNavItem({
    id: ids.nav.locations,
    label: 'Locations',
    target: { kind: 'object', objectId: ids.objects.location, viewId: ids.views.location.all },
    parentId: ids.nav.inventory,
    position: 1,
  }),
  defineNavItem({
    id: ids.nav.stock_moves,
    label: 'Stock moves',
    target: { kind: 'object', objectId: ids.objects.stock_move, viewId: ids.views.stock_move.all },
    parentId: ids.nav.inventory,
    position: 2,
  }),
];

export const commandItems = [
  defineCommandItem({
    id: ids.commands.new_stock_move,
    label: 'New stock move',
    icon: 'package',
    group: 'Create',
    action: { kind: 'create_record', objectId: ids.objects.stock_move },
  }),
  defineCommandItem({
    id: ids.commands.go_to_inventory,
    label: 'Go to inventory',
    icon: 'package',
    group: 'Navigate',
    shortcut: 'g i',
    action: { kind: 'navigate', target: { kind: 'object', objectId: ids.objects.stock_move } },
  }),
];
