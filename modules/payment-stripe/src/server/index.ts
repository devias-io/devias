import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';
import { createInvoicePaymentLink } from './actions/create-invoice-payment-link';
import { testStripe } from './connection-test';
import { RECORD_PAYMENT_JOB } from './invoices';
import { recordInvoicePaymentJob } from './jobs/record-invoice-payment';
import { stripeWebhook } from './webhook/parse';

/**
 * Server side of the Stripe payment provider: the invoice payment link, the connection test, the webhook, and the job
 * that records invoice payments. Loaded through `@devias/mod-payment-stripe/server`.
 */
export const paymentStripe = defineModuleServer(manifest, {
  actions: [createInvoicePaymentLink],
  jobs: { [RECORD_PAYMENT_JOB]: recordInvoicePaymentJob },
  connections: { default: { test: testStripe } },
  webhook: stripeWebhook,
});

export default paymentStripe;
