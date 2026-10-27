import { num, round2 } from '@devias/core';

/** What one line is worth: quantity times unit price, to the cent. */
export const lineTotal = (item: Record<string, unknown>): number => round2(num(item.quantity) * num(item.unit_price));

/** What a list of lines adds up to; the studio's offer and the server's actions share it, so both agree to the cent. */
export const itemsTotal = (items: readonly Record<string, unknown>[]): number =>
  round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
