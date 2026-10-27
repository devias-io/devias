import { defineModule } from '@devias/core';
import { actions } from './actions';
import { blocks } from './blocks';
import { ids } from './ids';
import { layouts } from './layouts';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. Quotes for the CRM's deals: the document you send a customer, with its
 * items, a number, a validity date and a status. They relate to the CRM's deals and companies, so the CRM must be
 * installed first. The deal page shows them through a block this module places on it.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.1.0',
  label: 'Quotes',
  description: "Quotes for the CRM's deals: the document you send a customer, with its items and total.",
  icon: 'file-text',
  objects,
  views,
  layouts,
  navItems,
  commandItems,
  blocks,
  actions,
});

export { ids } from './ids';

export { QUOTE_STATUSES, type Quote, type QuoteItem } from './objects';
