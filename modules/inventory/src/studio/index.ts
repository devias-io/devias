import { defineModuleStudio } from '@devias/core';
import { manifest } from '../manifest';
import { lowStockBlock } from './blocks/low-stock';
import { productStockBlock } from './blocks/product-stock';

/** Inventory as a module: its manifest, the Stock block on product pages and the Low stock block on Home. */
export const inventory = defineModuleStudio(manifest, {
  blocks: [productStockBlock, lowStockBlock],
});

export default inventory;
