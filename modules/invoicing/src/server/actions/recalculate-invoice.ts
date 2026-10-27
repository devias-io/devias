import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { loadInvoiceState } from '../state';

/** Store what the lines add up to on the invoice, so views, boards and workflows see current totals. */
export const recalculateInvoice = defineActionHandler({
  id: ids.actions.recalculate_invoice,
  input: z.object({ invoice_id: z.string().min(1) }),
  run: async (input, ctx) => {
    const invoice = await ctx.engine.records.get('invoice', input.invoice_id);
    const { totals } = await loadInvoiceState(ctx.engine, invoice);
    const updated = await ctx.engine.records.update('invoice', invoice.id, totals);

    return { id: updated.id, ...totals };
  },
});
