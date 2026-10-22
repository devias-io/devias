import { localDate } from '@devias/core';
import { CURRENCY } from '@devias/mod-invoicing/manifest';
import { invoiceLabel, loadInvoiceState, openInvoice, recordInvoicePayment } from '@devias/mod-invoicing/server';
import { defineJobHandler } from '@devias/server';
import { z } from 'zod';
import { deactivateLink, linkKey } from '../invoices';

/**
 * Record what a customer paid through an invoice's payment link, once Stripe reports the Checkout session paid. The
 * job is keyed by the session, and a payment already recorded with its reference is not recorded again, so retries
 * and repeated deliveries record it once. Money that arrives for an invoice with nothing left to pay is not recorded:
 * owners and admins are told, to refund it in Stripe.
 */
export const recordInvoicePaymentJob = defineJobHandler({
  input: z.object({
    invoiceId: z.string().min(1),
    session: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().min(1),
    paymentIntent: z.string().nullable(),
    paymentLink: z.string().nullable(),
    paidAt: z.number().nullable(),
  }),
  run: async (payment, ctx) => {
    const invoice = await openInvoice(ctx.engine, payment.invoiceId);
    const label = invoiceLabel(invoice);
    const reference = payment.paymentIntent ?? payment.session;
    const amount = payment.amount / 100;
    const currency = (
      typeof invoice.currency === 'string' && invoice.currency ? invoice.currency : CURRENCY
    ).toUpperCase();
    const target = { kind: 'record' as const, object: 'invoice', id: invoice.id };

    const recorded = await ctx.engine.records.list({
      object: 'payment',
      filter: {
        and: [
          { field: 'invoice', op: 'eq', value: invoice.id },
          { field: 'reference', op: 'eq', value: reference },
        ],
      },
      limit: 1,
    });

    if (recorded.items.length > 0) {
      return { recorded: false, reason: 'Already recorded', invoiceId: invoice.id };
    }

    if (payment.currency.toUpperCase() !== currency) {
      throw new Error(`Stripe was paid in ${payment.currency.toUpperCase()}, but invoice ${label} is in ${currency}`);
    }

    const { balance } = await loadInvoiceState(ctx.engine, invoice);

    if (invoice.status !== 'sent' || balance <= 0) {
      await ctx.notify({
        title: `Invoice ${label} was paid online, but nothing was owed`,
        body: `${amount.toFixed(2)} ${currency} arrived through Stripe (${reference}) for an invoice that is ${String(invoice.status)}. Refund it in Stripe, or record it by hand.`,
        level: 'warning',
        target,
        to: { roles: ['owner', 'admin'] },
      });

      return { recorded: false, reason: 'Nothing was owed', invoiceId: invoice.id };
    }

    const result = await recordInvoicePayment(ctx.engine, {
      invoice_id: invoice.id,
      amount,
      paid_on: localDate(payment.paidAt === null ? new Date() : new Date(payment.paidAt * 1000)),
      method: 'card',
      reference,
    });

    if (result.status === 'paid' && payment.paymentLink) {
      // Paid in full: the link must not take the money twice.
      const link = payment.paymentLink;
      await deactivateLink(ctx, link).catch((error: unknown) =>
        ctx.logger.warn(`Stripe payment link ${link} for invoice ${label} could not be switched off`, error),
      );
      await ctx.kv.delete(linkKey(invoice.id));
    }

    await ctx.notify({
      title: `Invoice ${label} was paid online`,
      body: `${amount.toFixed(2)} ${currency} through Stripe${result.status === 'paid' ? '; it is paid in full' : ''}.`,
      level: 'success',
      key: `stripe.paid:${invoice.id}:${reference}`,
      target,
      to: { roles: ['owner', 'admin'] },
    });

    return { recorded: true, ...result };
  },
});
