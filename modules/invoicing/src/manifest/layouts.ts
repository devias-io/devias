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
    header: { name: 'invoice_header', blockId: ids.blocks.invoice_header },
    tabs: [
      {
        name: 'overview',
        label: 'Overview',
        blocks: [
          { name: 'invoice_figures', blockId: ids.blocks.invoice_figures },
          // Two lanes: the items, the payments and the activity, and the details beside them.
          { name: 'invoice_lines', blockId: ids.blocks.invoice_lines, column: 1, columnSpan: 8 },
          {
            name: 'invoice_payments',
            label: 'Payments',
            blockId: ids.blocks.invoice_payments,
            column: 1,
            columnSpan: 8,
          },
          { name: 'activity', label: 'Activity', blockId: coreIds.blocks.activity, column: 1, columnSpan: 8 },
          { name: 'invoice_details', blockId: ids.blocks.invoice_details, column: 9, columnSpan: 4 },
        ],
      },
      // The comments, in a tab of their own: alone in it, the block needs no heading.
      { name: 'comments', label: 'Comments', blocks: [{ name: 'comments', blockId: coreIds.blocks.comments }] },
    ],
  }),
];
