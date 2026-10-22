import { defineModule } from '@devias/core';
import { actions } from './actions';
import { blocks } from './blocks';
import { layouts } from './layouts';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { pages } from './pages';
import { policies } from './policies';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. Imported by the studio (through the module), the server (to offer it
 * in the catalog and run its actions) and the CLI. Invoices relate to the CRM's companies, people and
 * deals, so the CRM must be installed first. The invoice page is a layout of the module's own blocks.
 */
export const manifest = defineModule({
  id: 'invoicing',
  version: '0.1.0',
  name: 'Invoicing',
  description: 'Invoices with lines and payments for the companies and people in the CRM.',
  icon: 'receipt',
  publisher: { id: 'devias', name: 'Devias', url: 'https://devias.io' },
  objects,
  views,
  layouts,
  navItems,
  commandItems,
  blocks,
  pages,
  actions,
  policies,
});

export { PAYMENT_LINK_ACTION } from './actions';
export { ids } from './ids';
export {
  CURRENCIES,
  CURRENCY,
  DISCOUNT_TYPES,
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  PAYMENT_METHOD_VALUES,
  PAYMENT_METHODS,
  type Payment,
  type PaymentMethod,
} from './objects';
