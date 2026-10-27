import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** A group of fields in the aside: a label and an editable value each. */
const aside = (name: string, label: string, fieldIds: string[]) => ({
  name,
  label,
  blockId: coreIds.blocks.fields,
  config: { fieldIds },
});

/**
 * The quote page, one flow in the `split` shape like the deal's: its title, its items with the total, then the
 * conversation, with the quote's terms beside.
 */
export const layouts = [
  defineLayout({
    id: ids.layouts.quote.default,
    objectId: ids.objects.quote,
    label: 'Quote',
    isDefault: true,
    shell: 'split',
    main: [
      { name: 'title', label: 'Title', blockId: coreIds.blocks.title, config: { fieldId: ids.fields.quote.title } },
      { name: 'quote_items', label: 'Items', blockId: ids.blocks.quote_items },
      { name: 'comments', label: 'Comments', blockId: coreIds.blocks.comments },
      { name: 'activity', label: 'Activity', blockId: coreIds.blocks.activity },
    ],
    aside: [
      aside('quote', 'Quote', [ids.fields.quote.status, ids.fields.quote.number, ids.fields.quote.valid_until]),
      aside('for', 'For', [ids.fields.quote.deal, ids.fields.quote.company]),
      aside('terms', 'Terms', [ids.fields.quote.notes]),
    ],
    actions: [{ actionId: ids.actions.recalculate_quote }],
  }),
];
