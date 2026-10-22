import { type WebhookHandler, WebhookRejected } from '@devias/server';
import { verifySvix } from './verify';

/** What happened to sent emails, signed by Svix, delivered into workflows. */
export const resendWebhook: WebhookHandler = {
  parse: async ({ headers, body }, ctx) => {
    const secret = (await ctx.connection()).values.webhook_secret;

    if (!secret) {
      throw new WebhookRejected('Add the webhook signing secret to the Resend connection first');
    }

    const { id } = verifySvix(headers, body, secret);
    let payload: { type?: unknown };

    try {
      payload = JSON.parse(body) as { type?: unknown };
    } catch {
      throw new WebhookRejected('Webhook body is not JSON');
    }

    if (typeof payload.type !== 'string') {
      throw new WebhookRejected('Webhook body has no event type');
    }

    return [{ type: payload.type, externalId: id, payload }];
  },
};
