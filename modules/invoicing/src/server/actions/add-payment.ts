import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { PAYMENT_METHOD_VALUES } from '../../manifest';
import { ids } from '../../manifest/ids';
import { addPaymentToInvoice } from '../payments';

/** Template-rendered inputs arrive as strings and a blank field as ''; treat blanks as absent. */
const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

/** Add a payment against a sent invoice: see `addPaymentToInvoice`. */
export const addPayment = defineActionHandler({
  id: ids.actions.add_payment,
  input: z.object({
    invoice_id: z.string().min(1),
    amount: blank(z.coerce.number().positive()),
    paid_on: blank(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')),
    method: blank(z.enum(PAYMENT_METHOD_VALUES)),
    reference: blank(z.string()),
  }),
  run: (input, ctx) => addPaymentToInvoice(ctx.engine, input),
});
