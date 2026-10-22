import { describe, expect, it } from 'vitest';
import { stripeWebhook } from '../../src/server/webhook/parse';
import { contextWith, fakeFetch, stripeSignature } from '../helpers';

describe('stripeWebhook', () => {
  it('verifies Stripe-Signature on webhooks', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    const ctx = contextWith(
      { secret_key: 'sk', webhook_secret: 'whsec_abc' },
      fakeFetch(() => ({})),
    );
    const parse = async (signature: string) =>
      stripeWebhook.parse({ headers: new Headers({ 'stripe-signature': signature }), body }, ctx);
    expect(await parse(stripeSignature('whsec_abc', body))).toEqual([
      { type: 'invoice.paid', externalId: 'evt_1', payload: JSON.parse(body) },
    ]);
    await expect(parse(stripeSignature('whsec_other', body))).rejects.toThrow('signature does not match');
    await expect(parse(stripeSignature('whsec_abc', body, 1))).rejects.toThrow('too old');
    await expect(parse('nonsense')).rejects.toThrow('malformed');
  });

  it('queues recording a paid Checkout session from an invoice link, once per session', async () => {
    const ctx = contextWith(
      { secret_key: 'sk', webhook_secret: 'whsec_abc' },
      fakeFetch(() => ({})),
    );
    const deliver = async (event: unknown) => {
      const body = JSON.stringify(event);

      return stripeWebhook.parse(
        { headers: new Headers({ 'stripe-signature': stripeSignature('whsec_abc', body) }), body },
        ctx,
      );
    };
    const session = (extra: Record<string, unknown>) => ({
      id: 'evt_2',
      type: 'checkout.session.completed',
      created: 1_790_000_000,
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'paid',
          amount_total: 12_050,
          currency: 'eur',
          payment_intent: 'pi_1',
          payment_link: 'plink_1',
          metadata: { devias_invoice: 'inv_1' },
          ...extra,
        },
      },
    });
    await deliver(session({}));
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      'record_invoice_payment',
      {
        invoiceId: 'inv_1',
        session: 'cs_1',
        amount: 12_050,
        currency: 'eur',
        paymentIntent: 'pi_1',
        paymentLink: 'plink_1',
        paidAt: 1_790_000_000,
      },
      { key: 'checkout:cs_1' },
    );
    // Not paid yet (a bank debit still clearing), or not from an invoice link: nothing to record.
    await deliver(session({ payment_status: 'unpaid' }));
    await deliver(session({ metadata: {} }));
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(1);
    // The slower method went through later.
    await deliver({ ...session({ payment_status: 'unpaid' }), type: 'checkout.session.async_payment_succeeded' });
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(2);
  });
});
