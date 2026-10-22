import type { ViewState } from '@devias/core';

type Columns = ViewState['fields'];

/**
 * Move a shown column to where another shown column is. The shown columns take the places the shown columns held, in
 * their new order, so hidden columns keep their own positions.
 */
export const moveShownColumn = (columns: Columns, activeName: string, overName: string): Columns => {
  const slots = columns.flatMap((column, index) => (column.visible ? [index] : []));
  const order = slots.map((index) => columns[index] as Columns[number]);
  const from = order.findIndex((column) => column.name === activeName);
  const to = order.findIndex((column) => column.name === overName);

  if (from < 0 || to < 0 || from === to) {
    return columns;
  }

  const [moved] = order.splice(from, 1);

  if (!moved) {
    return columns;
  }

  order.splice(to, 0, moved);
  const next = [...columns];
  slots.forEach((slot, position) => {
    const column = order[position];

    if (column) {
      next[slot] = column;
    }
  });

  return next;
};
