import { localDate } from '@devias/core';
import { CURRENCY } from '@devias/mod-invoicing/manifest';
import { addPaymentToInvoice, invoiceLabel, loadInvoiceState, openInvoice } from '@devias/mod-invoicing/server';
import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest';
import { deactivateLink, invoicePaymentOf, linkKey } from '../invoices';

/**
 * Add what a customer paid through an invoice's payment link, once Stripe reports the Checkout session paid. The
 * workflow that comes with the module runs it for each event, and runs repeat when they are retried or taken over by
 * another server, so it is safe to run again: a payment already added with its reference is not added again. Money
 * that arrives for an invoice with nothing left to pay is not added: owners and admins are told, once, to refund it
 * in Stripe.
 */
export const handleCheckoutEventAction = defineActionHandler({
  id: ids.actions.handle_checkout_event,
  input: z.object({ event: z.record(z.string(), z.unknown()) }),
  run: async ({ event }, ctx) => {
    const payment = invoicePaymentOf(event);

    // Not paid yet (a bank debit still clearing), or not from one of our invoice links: nothing to record.
    if (!payment) {
      return { recorded: false, reason: 'Not a paid session from an invoice link' };
    }

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
      return { recorded: false, reason: 'Already recorded', invoice_id: invoice.id };
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
        key: `stripe.unowed:${invoice.id}:${reference}`,
        target,
        to: { roles: ['owner', 'admin'] },
      });

      return { recorded: false, reason: 'Nothing was owed', invoice_id: invoice.id };
    }

    const result = await addPaymentToInvoice(ctx.engine, {
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

    return { recorded: true, invoice_id: invoice.id, status: result.status };
  },
});
