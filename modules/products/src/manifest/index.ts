import { defineModule } from '@devias/core';
import { blocks } from './blocks';
import { layouts } from './layouts';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { views } from './views';

/**
 * Pure manifest: no React, no server code. What you sell: products, and their prices (one time or recurring), each
 * product with a default one. It depends on no other module; the ones that sell or count products depend on it.
 */
export const manifest = defineModule({
  id: 'products',
  version: '0.1.0',
  name: 'Products',
  description: 'Your products and their prices, one time or recurring.',
  icon: 'package',
  publisher: { id: 'devias', name: 'Devias', url: 'https://devias.io' },
  objects,
  views,
  layouts,
  navItems,
  commandItems,
  blocks,
});

export { ids } from './ids';

export {
  INTERVALS,
  type Interval,
  PRICE_TYPES,
  PRODUCT_KINDS,
  type Price,
  type Product,
  TAX_BEHAVIORS,
  UNITS,
} from './objects';
