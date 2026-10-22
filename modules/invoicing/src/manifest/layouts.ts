import { coreIds, defineLayout } from '@devias/core';
import { ids } from './ids';

/** The invoice page: the header block, a row of figures, then two lanes. */
export const layouts = [
  defineLayout({
    id: ids.layouts.invoice.default,
    objectId: ids.objects.invoice,
    label: 'Invoice',
    isDefault: true,
    shell: 'tabs',
    // The header block draws the page header: the number, its status, the customer and what the status allows.
    header: { blockId: ids.blocks.invoice_header },
    tabs: [
      {
        name: 'overview',
        label: 'Overview',
        blocks: [
          { blockId: ids.blocks.invoice_figures },
          // Two lanes: the items, the payments and the activity, and the details beside them.
          { blockId: ids.blocks.invoice_lines, column: 1, columnSpan: 8 },
          {
            blockId: ids.blocks.invoice_payments,
            label: 'Payments',
            column: 1,
            columnSpan: 8,
          },
          { blockId: coreIds.blocks.activity, label: 'Activity', column: 1, columnSpan: 8 },
          { blockId: ids.blocks.invoice_details, column: 9, columnSpan: 4 },
        ],
      },
      // The notes, in a tab of their own: alone in it, the block needs no heading.
      { name: 'notes', label: 'Notes', blocks: [{ blockId: coreIds.blocks.notes }] },
    ],
  }),
];
