import { defineBlockComponent, num } from '@devias/core';
import { formatDate, useRecordPage } from '@devias/studio';
import { cn, Skeleton, TABLE_CELL, TABLE_HEAD, TABLE_ROW } from '@devias/ui';
import { ids, PAYMENT_METHODS } from '../../manifest';
import { text } from '../shared';
import { useInvoice } from './use-invoice';

const methodLabel = (value: unknown): string =>
  PAYMENT_METHODS.find((method) => method.value === value)?.label ?? text(value) ?? '-';

/** The payments recorded against the invoice: when, how, the reference and the amount. */
export const invoicePaymentsBlock = defineBlockComponent({
  id: ids.blocks.invoice_payments,
  label: 'Payments',
  icon: 'banknote',
  surfaces: { record: { objectIds: [ids.objects.invoice] } },
  component: function InvoicePayments() {
    const { record } = useRecordPage();
    const { payments, paymentItems, money, editable } = useInvoice(record);

    if (payments.isPending) {
      return <Skeleton className="h-12 w-full" />;
    }

    if (paymentItems.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          {editable ? 'Payments can be recorded once the invoice is sent.' : 'No payments yet.'}
        </p>
      );
    }

    return (
      <table className="w-full text-xs" data-slot="invoice-payments">
        <thead>
          <tr className={cn(TABLE_ROW, 'border-t')}>
            <th className={TABLE_HEAD}>Paid on</th>
            <th className={TABLE_HEAD}>Method</th>
            <th className={TABLE_HEAD}>Reference</th>
            <th className={cn(TABLE_HEAD, 'text-right')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {paymentItems.map((payment) => (
            <tr key={payment.id} className={TABLE_ROW}>
              <td className={cn(TABLE_CELL, 'tabular-nums')}>{formatDate(text(payment.paid_on)) || '-'}</td>
              <td className={TABLE_CELL}>{methodLabel(payment.method)}</td>
              <td className={cn(TABLE_CELL, 'text-muted-foreground')}>{text(payment.reference) ?? '-'}</td>
              <td className={cn(TABLE_CELL, 'text-right tabular-nums')}>{money(num(payment.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
});
