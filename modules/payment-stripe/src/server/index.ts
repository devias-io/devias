import { defineConnectionHandler, defineModuleServer } from '@devias/server';
import { ids, manifest } from '../manifest';
import { createInvoicePaymentLink } from './actions/create-invoice-payment-link';
import { handleCheckoutEventAction } from './actions/handle-checkout-event';
import { testConnection } from './connection-test';
import { webhook } from './webhook/parse';

/**
 * Server side of the Stripe payment provider: the invoice payment link, the action that records a payment Stripe
 * reported, the connection test, and the webhook. Loaded through `@devias/mod-payment-stripe/server`.
 */
export const server = defineModuleServer(manifest, {
  actions: [createInvoicePaymentLink, handleCheckoutEventAction],
  connections: [defineConnectionHandler({ id: ids.connections.default, test: testConnection })],
  webhook,
});

export default server;
