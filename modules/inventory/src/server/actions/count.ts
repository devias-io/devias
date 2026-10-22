import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { roundQuantity } from '../../lib/stock';
import { ids } from '../../manifest/ids';
import { onHandAt } from '../stock';
import { blank, day, today } from './inputs';

/** A stock count: the difference between what was counted and what the moves add up to, recorded as one move. */
export const count = defineActionHandler({
  id: ids.actions.count,
  input: z.object({
    product: z.string().min(1),
    location: z.string().min(1),
    counted: z.coerce.number().min(0),
    counted_on: blank(day),
  }),
  run: async (input, ctx) => {
    const before = await onHandAt(ctx.engine, input.product, input.location);
    const difference = roundQuantity(input.counted - before);

    if (difference === 0) {
      return { before, counted: input.counted, difference, move_id: null };
    }

    const move = await ctx.engine.records.create('stock_move', {
      product: input.product,
      location: input.location,
      direction: difference > 0 ? 'in' : 'out',
      quantity: Math.abs(difference),
      reason: 'count',
      moved_on: input.counted_on ?? today(),
      reference: 'Stock count',
    });

    return { before, counted: input.counted, difference, move_id: move.id };
  },
});
