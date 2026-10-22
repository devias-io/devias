import type { ModuleContext } from '@devias/server';
import { API, auth, NAME, request } from './http';

/**
 * Taking Invoicing's invoices online: a payment link per invoice, carrying the invoice id in its metadata (Stripe
 * copies it onto the Checkout sessions the link starts), so the webhook knows which invoice a payment settles.
 */

/** The metadata key the invoice id travels under. */
export const INVOICE_METADATA = 'devias_invoice';

/** The job that records a payment Stripe reported against its invoice. */
export const RECORD_PAYMENT_JOB = 'record_invoice_payment';

/** What the module keeps per invoice: its current link, to give it again or switch it off. */
export interface SavedLink {
  id: string;
  url: string;
  /** In cents. */
  amount: number;
  currency: string;
}

export const linkKey = (invoiceId: string) => `paymentLink:${invoiceId}`;

/** Switch a payment link off, so nobody pays through it again. */
export const deactivateLink = async (
  ctx: Pick<ModuleContext, 'connection' | 'fetch' | 'reportAuthFailure'>,
  id: string,
) =>
  request(ctx, NAME, `${API}/payment_links/${encodeURIComponent(id)}`, {
    headers: await auth(ctx),
    form: { active: 'false' },
  });

/** A paid Checkout session started by one of our invoice links, as the job records it. */
export interface InvoicePayment {
  invoiceId: string;
  session: string;
  /** In cents. */
  amount: number;
  currency: string;
  paymentIntent: string | null;
  paymentLink: string | null;
  /** When Stripe saw it, in seconds. */
  paidAt: number | null;
}

interface CheckoutSession {
  id?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_intent?: unknown;
  payment_link?: unknown;
  metadata?: Record<string, unknown> | null;
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * The invoice payment a webhook event reports, or null: a Checkout session that is paid (card payments complete
 * paid; slower methods report `async_payment_succeeded` later) and came from an invoice link.
 */
export const invoicePaymentOf = (event: {
  type?: unknown;
  created?: unknown;
  data?: { object?: CheckoutSession };
}): InvoicePayment | null => {
  const session = event.data?.object;
  const paid =
    (event.type === 'checkout.session.completed' && session?.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded';
  const invoiceId = stringOrNull(session?.metadata?.[INVOICE_METADATA]);
  const id = stringOrNull(session?.id);

  if (!paid || !invoiceId || !id || typeof session?.amount_total !== 'number' || typeof session.currency !== 'string') {
    return null;
  }

  return {
    invoiceId,
    session: id,
    amount: session.amount_total,
    currency: session.currency,
    paymentIntent: stringOrNull(session.payment_intent),
    paymentLink: stringOrNull(session.payment_link),
    paidAt: typeof event.created === 'number' ? event.created : null,
  };
};
