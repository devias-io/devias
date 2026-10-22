import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';
import { addPayment } from './actions/add-payment';
import { recalculateInvoice } from './actions/recalculate-invoice';

/**
 * Server side of invoicing: the two actions the manifest declares (each a REST route, an agent tool and a
 * workflow step) and a health route. Records themselves go through core's actions. Loaded through
 * `@devias/mod-invoicing/server`, which also shares what payment provider modules need: reading an invoice's
 * balance and recording a payment against it.
 */
export const invoicing = defineModuleServer(manifest, {
  actions: [recalculateInvoice, addPayment],
  routes: (router) => {
    router.get('/health', (c) => c.json({ ok: true, module: 'invoicing' }));
  },
});

export default invoicing;
export { invoiceLabel, openInvoice, type PaymentInput, recordInvoicePayment } from './payments';
export { type InvoiceState, loadInvoiceState } from './state';
