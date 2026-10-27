import { defineModule } from '@devias/core';
import { actions } from './actions';
import { blocks } from './blocks';
import { fields } from './fields';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { policies } from './policies';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. The stock of the products across locations (a warehouse, vans, sites), as
 * a ledger of moves in and out; stock on hand is added up from it, never stored. Moves can name the CRM's suppliers
 * and deals, and it adds stock fields to the products, so Products and the CRM must be installed first.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.1.0',
  label: 'Inventory',
  description: 'Your products and their stock across a warehouse, vans and sites, as moves in and out.',
  icon: 'package',
  objects,
  fields,
  views,
  navItems,
  commandItems,
  blocks,
  actions,
  policies,
});

export { actions } from './actions';
export { ids } from './ids';
export {
  DIRECTIONS,
  type Direction,
  LOCATION_KINDS,
  type Location,
  MOVE_REASONS,
  type StockMove,
} from './objects';

import { ids } from './ids';
