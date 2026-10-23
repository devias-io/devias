import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** A group of fields in the aside: a label and an editable value each. */
const aside = (name: string, label: string, fieldIds: string[]) => ({
  name,
  blockId: coreIds.blocks.fields,
  label,
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
      { blockId: coreIds.blocks.title, label: 'Title', config: { fieldId: ids.fields.quote.title } },
      { blockId: ids.blocks.quote_items, label: 'Items' },
      { blockId: coreIds.blocks.comments, label: 'Comments' },
      { blockId: coreIds.blocks.activity, label: 'Activity' },
    ],
    aside: [
      aside('quote', 'Quote', [ids.fields.quote.status, ids.fields.quote.number, ids.fields.quote.valid_until]),
      aside('for', 'For', [ids.fields.quote.deal, ids.fields.quote.company]),
      aside('terms', 'Terms', [ids.fields.quote.notes]),
    ],
    actions: [{ actionId: ids.actions.recalculate_quote }],
  }),
];
