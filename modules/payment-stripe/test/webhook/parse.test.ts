import { describe, expect, it } from 'vitest';
import { webhook } from '../../src/server/webhook/parse';
import { contextWith, fakeFetch, stripeSignature } from '../helpers';

describe('stripeWebhook', () => {
  it('verifies Stripe-Signature on webhooks', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    const ctx = contextWith(
      { secret_key: 'sk', webhook_secret: 'whsec_abc' },
      fakeFetch(() => ({})),
    );
    const parse = async (signature: string) =>
      webhook.parse({ headers: new Headers({ 'stripe-signature': signature }), body }, ctx);
    expect(await parse(stripeSignature('whsec_abc', body))).toEqual([
      { type: 'invoice.paid', externalId: 'evt_1', payload: JSON.parse(body) },
    ]);
    await expect(parse(stripeSignature('whsec_other', body))).rejects.toThrow('signature does not match');
    await expect(parse(stripeSignature('whsec_abc', body, 1))).rejects.toThrow('too old');
    await expect(parse('nonsense')).rejects.toThrow('malformed');
  });
});
