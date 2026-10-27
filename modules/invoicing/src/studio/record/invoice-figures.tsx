import { defineBlockComponent, plural } from '@devias/core';
import { formatDate, useRecordPage } from '@devias/studio';
import { Figure, Figures } from '@devias/ui';
import { ids } from '../../manifest';
import { text } from '../shared';
import { useInvoice } from './use-invoice';

/**
 * A row of figures: what is left to pay (with a bar of what is paid), the total, what is paid and when it is due.
 */
export const invoiceFiguresBlock = defineBlockComponent({
  id: ids.blocks.invoice_figures,
  label: 'Invoice figures',
  icon: 'chart-no-axes-column',
  surfaces: { record: { objectIds: [ids.objects.invoice], frame: false } },
  component: function InvoiceFigures() {
    const { record } = useRecordPage();
    const { lineItems, paymentItems, totals, paid, balance, money, status, today, overdue } = useInvoice(record);
    const dueDate = text(record.due_date);
    const dueIn = dueDate ? Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000) : null;
    const dueNote =
      dueIn === null
        ? 'No due date'
        : dueIn < 0
          ? `${-dueIn} ${dueIn === -1 ? 'day' : 'days'} overdue`
          : dueIn === 0
            ? 'Due today'
            : `In ${dueIn} ${dueIn === 1 ? 'day' : 'days'}`;
    const lastPayment =
      paymentItems
        .map((payment) => text(payment.paid_on))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    const headline =
      status === 'sent'
        ? {
            label: 'Amount due',
            amount: balance,
            note: dueDate ? `Due ${formatDate(dueDate)}` : 'Due on receipt',
          }
        : status === 'paid'
          ? {
              label: 'Paid in full',
              amount: totals.total,
              note: lastPayment ? `Paid ${formatDate(lastPayment)}` : 'Paid',
            }
          : status === 'void'
            ? { label: 'Total', amount: totals.total, note: 'Void' }
            : { label: 'Draft total', amount: totals.total, note: 'Not sent yet' };

    return (
      <div data-slot="invoice-figures" data-status={String(status)}>
        <Figures>
          <Figure
            label={headline.label}
            value={<span data-slot="headline-amount">{money(headline.amount)}</span>}
            hint={
              status === 'sent' && paid > 0 ? (
                <span className="flex flex-col gap-1.5" data-slot="paid-bar">
                  <span aria-hidden className="flex h-1.5 w-full gap-0.5">
                    <span className="rounded-full bg-brand-strong" style={{ flexGrow: paid }} />
                    <span className="rounded-full bg-border" style={{ flexGrow: Math.max(balance, 0) }} />
                  </span>
                  <span>
                    {money(paid)} of {money(totals.total)} paid
                  </span>
                </span>
              ) : (
                headline.note
              )
            }
          />
          <Figure label="Total" value={money(totals.total)} hint={plural(lineItems.length, 'item', 'items')} />
          <Figure label="Paid" value={money(paid)} hint={plural(paymentItems.length, 'payment', 'payments')} />
          <Figure
            label="Due date"
            value={dueDate ? formatDate(dueDate) : '—'}
            hint={status === 'sent' || status === 'draft' ? dueNote : undefined}
            alert={overdue}
          />
        </Figures>
      </div>
    );
  },
});
