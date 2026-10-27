import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { blank, day, today } from './inputs';

/** Out of one location and into another, as two moves with the same date and reference. */
export const transfer = defineActionHandler({
  id: ids.actions.transfer,
  input: z.object({
    product: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    quantity: z.coerce.number().positive(),
    moved_on: blank(day),
    reference: blank(z.string()),
  }),
  run: async (input, ctx) => {
    if (input.from === input.to) {
      throw new Error('Pick two different locations');
    }

    const move = (direction: 'in' | 'out', location: string) =>
      ctx.engine.records.create('stock_move', {
        product: input.product,
        location,
        direction,
        quantity: input.quantity,
        reason: 'transfer',
        moved_on: input.moved_on ?? today(),
        ...(input.reference ? { reference: input.reference } : {}),
      });
    const out = await move('out', input.from);
    const into = await move('in', input.to);

    return { out: out.id, in: into.id };
  },
});
