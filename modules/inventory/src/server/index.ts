import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';
import { count } from './actions/count';
import { stockOnHand } from './actions/stock-on-hand';
import { transfer } from './actions/transfer';

/**
 * Server side of inventory: stock on hand added up from the moves, transfers between locations and stock counts
 * (each a REST route, an agent tool and a workflow step). Loaded through `@devias/mod-inventory/server`.
 */
export const inventory = defineModuleServer(manifest, {
  actions: [stockOnHand, transfer, count],
});

export default inventory;
export { onHandAt, type ProductStock, stockOnHand } from './stock';
