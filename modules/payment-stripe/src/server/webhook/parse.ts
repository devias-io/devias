import { type WebhookHandler, WebhookRejected } from '@devias/server';
import { verifyStripe } from './verify';

/**
 * Payment events, signed with the endpoint's signing secret, delivered into workflows. The workflow that comes with the
 * module records a paid Checkout session from an invoice's payment link; the webhook only stores what Stripe sent.
 */
export const webhook: WebhookHandler = {
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

    return [{ type: payload.type, ...(typeof payload.id === 'string' ? { externalId: payload.id } : {}), payload }];
  },
};
