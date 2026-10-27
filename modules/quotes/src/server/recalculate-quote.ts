import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { itemsTotal } from '../lib/totals';
import { ids } from '../manifest/ids';

/** Store what a quote's items add up to, so views, boards and workflows see the current total. */
export const recalculateQuote = defineActionHandler({
  id: ids.actions.recalculate_quote,
  input: z.object({ quote_id: z.string().min(1) }),
  run: async (input, ctx) => {
    const quote = await ctx.engine.records.get('quote', input.quote_id);
    const items = await ctx.engine.records.list({
      object: 'quote_item',
      filter: { field: 'quote', op: 'eq', value: quote.id },
      limit: 200,
    });
    const total = itemsTotal(items.items);
    const updated = await ctx.engine.records.update('quote', quote.id, { total });

    return { id: updated.id, total, items: items.items.length };
  },
});
