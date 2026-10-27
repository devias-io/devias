import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { stockOnHand as addUp } from '../stock';
import { blank } from './inputs';

/** Stock on hand by product and location, with what is low: see `stockOnHand` in `../stock`. */
export const stockOnHand = defineActionHandler({
  id: ids.actions.stock_on_hand,
  input: z.object({ product: blank(z.string()), location: blank(z.string()) }),
  run: async (input, ctx) => ({ products: await addUp(ctx.engine, input) }),
});
