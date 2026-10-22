import { defineModule } from '@devias/core';
import { actions } from './actions';
import { connections } from './connections';
import { STRIPE_EVENTS } from './events';

/**
 * Pure manifest: Stripe as a payment provider. Customers pay Invoicing's invoices
 * online through a Stripe payment link, and the payment is recorded on the invoice once Stripe reports it. The API
 * key a workspace connects, the one action, and the payment events Stripe's webhook delivers; the server side
 * (`./server`) implements them.
 */
export const manifest = defineModule({
  id: 'payment-stripe',
  version: '0.1.0',
  name: 'Stripe payments',
  description: 'Customers pay invoices online by card through Stripe; the payment is recorded on the invoice.',
  icon: 'credit-card',
  logo: './logo.svg',
  website: 'https://stripe.com',
  publisher: { id: 'devias', name: 'Devias', url: 'https://devias.io' },
  connections,
  actions,
  events: STRIPE_EVENTS,
  webhookHelp:
    'In Stripe → Developers → Webhooks, add an endpoint with this URL, choose the checkout.session events (and any other payment events your workflows use), then paste the signing secret into the connection.',
});

export { STRIPE_EVENTS } from './events';
export { ids } from './ids';
