import { defineModuleStudio } from '@devias/core';
import { manifest } from '../manifest';
import { productDescriptionBlock } from './blocks/product-description';
import { productImagesBlock } from './blocks/product-images';
import { productPricesBlock } from './blocks/product-prices';
import { imagesFieldType } from './fields/images-field';

/** Products as a module: its manifest, the `images` field type and the Images, Prices and Description blocks on product pages. */
export const studio = defineModuleStudio(manifest, {
  fieldTypes: [imagesFieldType],
  blocks: [productImagesBlock, productPricesBlock, productDescriptionBlock],
});

export default studio;
