import { defineModuleStudio } from '@devias/core';
import { manifest } from '../manifest';
import { dealQuotesBlock } from './blocks/deal-quotes';
import { quoteItemsBlock } from './blocks/quote-items';

/**
 * The quotes module in the studio: the items of a quote, edited in place, and the block that shows a deal's quotes and
 * starts the next one.
 */
export const quotes = defineModuleStudio(manifest, { blocks: [quoteItemsBlock, dealQuotesBlock] });

export default quotes;
