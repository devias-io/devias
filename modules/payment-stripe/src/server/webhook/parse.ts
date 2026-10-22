import { type WebhookHandler, WebhookRejected } from '@devias/server';
import { invoicePaymentOf, RECORD_PAYMENT_JOB } from '../invoices';
import { verifyStripe } from './verify';

/**
 * Payment events, signed with the endpoint's signing secret, delivered into workflows. A paid Checkout session from
 * an invoice's payment link also queues recording that payment, once per session.
 */
export const stripeWebhook: WebhookHandler = {
  parse: async ({ headers, body }, ctx) => {
    const secret = (await ctx.connection()).values.webhook_secret;

    if (!secret) {
      throw new WebhookRejected('Add the webhook signing secret to the Stripe connection first');
    }

    verifyStripe(headers, body, secret);
    let payload: { id?: unknown; type?: unknown };

    try {
      payload = JSON.parse(body) as { id?: unknown; type?: unknown };
    } catch {
      throw new WebhookRejected('Webhook body is not JSON');
    }

    if (typeof payload.type !== 'string') {
      throw new WebhookRejected('Webhook body has no event type');
    }

    const payment = invoicePaymentOf(payload);

    if (payment) {
      await ctx.jobs.enqueue(RECORD_PAYMENT_JOB, payment, { key: `checkout:${payment.session}` });
    }

    return [{ type: payload.type, ...(typeof payload.id === 'string' ? { externalId: payload.id } : {}), payload }];
  },
};
