import { defineModule } from '@devias/core';
import { actions } from './actions';
import { connections } from './connections';
import { STRIPE_EVENTS } from './events';
import { ids } from './ids';
import { workflows } from './workflows';

/**
 * Pure manifest: Stripe as a payment provider. Customers pay Invoicing's invoices
 * online through a Stripe payment link, and the payment is recorded on the invoice once Stripe reports it. The API
 * key a workspace connects, the two actions, the payment events Stripe's webhook delivers, and the workflow that records
 * a payment when one arrives; the server side (`./server`) implements them.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.1.0',
  label: 'Payments via Stripe',
  description: 'Customers pay invoices online by card through Stripe; the payment is recorded on the invoice.',
  icon: 'credit-card',
  logo: './logo.svg',
  website: 'https://stripe.com',
  connections,
  actions,
  events: STRIPE_EVENTS,
  workflows,
  webhookHelp:
    'In Stripe → Developers → Webhooks, add an endpoint with this URL, choose the checkout.session events (and any other payment events your workflows use), then paste the signing secret into the connection.',
});

export { STRIPE_EVENTS } from './events';
export { ids } from './ids';
