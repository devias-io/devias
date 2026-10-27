import { WebhookRejected } from '@devias/server';
import { hmacSha256, signatureMatches, timestampFresh } from '../http';

const TOLERANCE_SECONDS = 5 * 60;

/** `Stripe-Signature: t=<seconds>,v1=<hex>[,v1=<hex>…]` over `<t>.<body>`. */
export const verifyStripe = (headers: Headers, body: string, secret: string): void => {
  const header = headers.get('stripe-signature');

  if (!header) {
    throw new WebhookRejected('Missing Stripe-Signature header');
  }

  const parts = header.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => Buffer.from(value ?? '', 'hex'));

  if (!timestamp || signatures.length === 0) {
    throw new WebhookRejected('Stripe-Signature header is malformed');
  }

  if (!timestampFresh(Number(timestamp), TOLERANCE_SECONDS)) {
    throw new WebhookRejected('Webhook timestamp is too old');
  }

  const expected = hmacSha256(secret, `${timestamp}.${body}`);

  if (!signatures.some((candidate) => signatureMatches(expected, candidate))) {
    throw new WebhookRejected('Webhook signature does not match');
  }
};
