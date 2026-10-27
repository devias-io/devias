import { CURRENCY } from '@devias/mod-invoicing/manifest';
import { invoiceLabel, loadInvoiceState, openInvoice } from '@devias/mod-invoicing/server';
import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { API, auth, formEncode, NAME, request } from '../http';
import { deactivateLink, INVOICE_METADATA, linkKey, type SavedLink } from '../invoices';

/**
 * A payment link for what is left to pay on a sent invoice: a one-off price for that amount and a link that carries
 * the invoice id, stored on the invoice. Asking again for the same amount gives the same link; a new amount (after a
 * partial payment) replaces it and switches the old one off.
 */
export const createInvoicePaymentLink = defineActionHandler({
  id: ids.actions.create_invoice_payment_link,
  input: z.object({ invoice_id: z.string().min(1) }),
  run: async ({ invoice_id: invoiceId }, ctx) => {
    const invoice = await openInvoice(ctx.engine, invoiceId);
    const label = invoiceLabel(invoice);

    if (invoice.status === 'draft') {
      throw new Error(`Invoice ${label} is still a draft; send it first`);
    }

    if (invoice.status !== 'sent') {
      throw new Error(`Invoice ${label} is ${String(invoice.status)}: nothing to pay`);
    }

    const { balance } = await loadInvoiceState(ctx.engine, invoice);

    if (balance <= 0) {
      throw new Error(`Invoice ${label} has nothing left to pay`);
    }

    const currency = (
      typeof invoice.currency === 'string' && invoice.currency ? invoice.currency : CURRENCY
    ).toLowerCase();
    // Every currency an invoice can be issued in has two decimals, and Stripe counts in cents.
    const amount = Math.round(balance * 100);
    const result = (url: string, reused: boolean) => ({
      invoice_id: invoiceId,
      url,
      amount: balance,
      currency: currency.toUpperCase(),
      reused,
    });

    const saved = await ctx.kv.get<SavedLink>(linkKey(invoiceId));

    if (saved && saved.amount === amount && saved.currency === currency && invoice.payment_url === saved.url) {
      return result(saved.url, true);
    }

    const headers = await auth(ctx);
    const price = await request<{ id: string }>(ctx, NAME, `${API}/prices`, {
      headers,
      form: formEncode({ currency, unit_amount: amount, product_data: { name: `Invoice ${label}` } }),
    });
    const link = await request<{ id: string; url: string }>(ctx, NAME, `${API}/payment_links`, {
      headers,
      form: formEncode({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { [INVOICE_METADATA]: invoiceId },
      }),
    });
    await ctx.kv.set(linkKey(invoiceId), { id: link.id, url: link.url, amount, currency } satisfies SavedLink);
    await ctx.engine.records.update('invoice', invoiceId, { payment_url: link.url });

    if (saved) {
      await deactivateLink(ctx, saved.id).catch((error: unknown) =>
        ctx.logger.warn(`Stripe payment link ${saved.id} for invoice ${label} could not be switched off`, error),
      );
    }

    return result(link.url, false);
  },
});
