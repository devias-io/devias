import { WebhookRejected } from '@devias/server';
import { hmacSha256, signatureMatches, timestampFresh } from '../http';

/** How old a webhook delivery may be before it is refused as a replay. */
const TOLERANCE_SECONDS = 5 * 60;

/** Svix signatures: `v1,<base64>` entries over `<id>.<timestamp>.<body>`, keyed by the base64 part of `whsec_…`. */
export const verifySvix = (headers: Headers, body: string, secret: string): { id: string } => {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');

  if (!id || !timestamp || !signature) {
    throw new WebhookRejected('Missing Svix signature headers');
  }

  if (!timestampFresh(Number(timestamp), TOLERANCE_SECONDS)) {
    throw new WebhookRejected('Webhook timestamp is too old');
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = hmacSha256(key, `${id}.${timestamp}.${body}`);
  const given = signature
    .split(' ')
    .map((entry) => entry.trim().split(',', 2))
    .filter(([version]) => version === 'v1')
    .map(([, value]) => Buffer.from(value ?? '', 'base64'));

  if (!given.some((candidate) => signatureMatches(expected, candidate))) {
    throw new WebhookRejected('Webhook signature does not match');
  }

  return { id };
};
