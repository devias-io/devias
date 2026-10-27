import { defineBlockComponent, num } from '@devias/core';
import {
  useCreateRecord,
  useDeleteRecords,
  useFields,
  useObject,
  useRecordPage,
  useUpdateRecord,
} from '@devias/studio';
import { Button, cn, Icon, Section, Skeleton, TABLE_CELL, TABLE_HEAD, TABLE_ROW } from '@devias/ui';
import { lineAmount } from '../../lib/totals';
import { ids } from '../../manifest';
import { text } from '../shared';
import { useInvoice } from './use-invoice';
import { Value } from './value';

const LINE_FIELDS = ['description', 'quantity', 'unit_price'];

function TotalRow({
  label,
  value,
  strong,
  spare,
  slot,
}: {
  label: string;
  value: string;
  strong?: boolean;
  spare: boolean;
  slot?: string;
}) {
  return (
    <tr data-slot={slot}>
      <td colSpan={2} />
      <td
        className={cn(TABLE_CELL, 'py-1.5 text-right text-muted-foreground', strong && 'font-medium text-foreground')}
      >
        {label}
      </td>
      <td className={cn(TABLE_CELL, 'py-1.5 text-right tabular-nums', strong && 'font-semibold')}>{value}</td>
      {spare ? <td /> : null}
    </tr>
  );
}

/**
 * The invoice's items and what they add up to. A draft's items are edited in place (every value, add, remove); once the
 * invoice is sent, paid or void they are final.
 */
export const invoiceLinesBlock = defineBlockComponent({
  id: ids.blocks.invoice_lines,
  label: 'Items',
  icon: 'list',
  surfaces: { record: { objectIds: [ids.objects.invoice], frame: false } },
  component: function InvoiceLines() {
    const { record } = useRecordPage();
    const lineObject = useObject('invoice_line');
    const lineFields = useFields(lineObject?.id);
    const { lines, lineItems, totals, paid, balance, money, editable } = useInvoice(record);
    const createLine = useCreateRecord('invoice_line');
    const updateLine = useUpdateRecord('invoice_line');
    const removeLines = useDeleteRecords('invoice_line');
    const busy = createLine.isPending || updateLine.isPending || removeLines.isPending;
    const spare = editable;
    const columns = editable ? 5 : 4;
    const addItem = () =>
      createLine.mutate({
        invoice: record.id,
        description: `Item ${lineItems.length + 1}`,
        quantity: 1,
        unit_price: 0,
      });

    return (
      <Section
        variant="plain"
        title="Items"
        actions={
          editable ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={addItem}>
              <Icon name="plus" />
              Add item
            </Button>
          ) : undefined
        }
      >
        {editable ? (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Click a description, quantity or price to change it.
          </p>
        ) : null}
        {lines.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <table className="w-full text-xs" data-slot="invoice-items">
            <thead>
              <tr className={cn(TABLE_ROW, 'border-t')}>
                <th className={TABLE_HEAD}>Description</th>
                <th className={cn(TABLE_HEAD, 'w-24 text-right')}>Qty</th>
                <th className={cn(TABLE_HEAD, 'w-36 text-right')}>Unit price</th>
                <th className={cn(TABLE_HEAD, 'w-32 text-right')}>Amount</th>
                {spare ? <th className={cn(TABLE_HEAD, 'w-8')} /> : null}
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr className={TABLE_ROW}>
                  <td colSpan={columns} className={cn(TABLE_CELL, 'py-6 text-center text-muted-foreground')}>
                    {editable ? 'No items yet. Add one to bill it.' : 'No items.'}
                  </td>
                </tr>
              ) : (
                lineItems.map((line) => (
                  <tr key={line.id} className={TABLE_ROW} data-line={line.id}>
                    {editable && lineObject ? (
                      LINE_FIELDS.map((name) => (
                        <td key={name} className={cn(TABLE_CELL, 'py-1', name !== 'description' && 'text-right')}>
                          <Value
                            name={name}
                            fields={lineFields}
                            record={line}
                            object={lineObject}
                            editable
                            onCommit={(field, value) =>
                              void updateLine.mutateAsync({ id: line.id, patch: { [field]: value } })
                            }
                          />
                        </td>
                      ))
                    ) : (
                      <>
                        <td className={TABLE_CELL}>{text(line.description) ?? '-'}</td>
                        <td className={cn(TABLE_CELL, 'text-right tabular-nums')}>{num(line.quantity)}</td>
                        <td className={cn(TABLE_CELL, 'text-right tabular-nums')}>{money(num(line.unit_price))}</td>
                      </>
                    )}
                    <td className={cn(TABLE_CELL, 'text-right tabular-nums')}>{money(lineAmount(line))}</td>
                    {spare ? (
                      <td className={cn(TABLE_CELL, 'py-1 text-right')}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Remove item"
                          disabled={busy}
                          onClick={() => removeLines.mutate([line.id])}
                        >
                          <Icon name="x" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <TotalRow label="Subtotal" value={money(totals.subtotal)} spare={spare} />
              {totals.discount_amount > 0 ? (
                <TotalRow label="Discount" value={`−${money(totals.discount_amount)}`} spare={spare} />
              ) : null}
              <TotalRow label="Tax" value={money(totals.tax)} spare={spare} />
              <TotalRow label="Total" value={money(totals.total)} strong spare={spare} />
              <TotalRow label="Amount paid" value={money(paid)} spare={spare} />
              <TotalRow label="Amount due" value={money(balance)} strong spare={spare} slot="amount-due" />
            </tfoot>
          </table>
        )}
      </Section>
    );
  },
});
