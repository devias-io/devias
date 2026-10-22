import { defineBlockComponent, round2 } from '@devias/core';
import {
  formatDate,
  links,
  OptionBadge,
  RecordImage,
  useCreateRecord,
  useNavigation,
  useRecordPage,
  useWorkspace,
} from '@devias/studio';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Icon,
  type IconName,
} from '@devias/ui';
import { useState } from 'react';
import { balanceOf } from '../../lib/totals';
import { ids } from '../../manifest';
import { InvoicePreviewDialog } from '../pdf/invoice-preview';
import { statusOf, text, useCustomers } from '../shared';
import { type PaymentInput, RecordPaymentDialog } from './record-payment-dialog';
import { useInvoice, usePatchInvoice } from './use-invoice';

const PAST_DUE = { value: 'past_due', label: 'Past due', color: 'red' };

/**
 * The invoice's header: the number with its status, the customer and when it was issued, and what the status allows:
 * a draft can be sent or edited in the composer, a sent invoice can be voided or paid; a paid or void one is final.
 * Delete is the page's own menu, and the invoice's `deleteWhen` rule only offers it on a draft.
 */
export const invoiceHeaderBlock = defineBlockComponent({
  id: ids.blocks.invoice_header,
  label: 'Invoice header',
  icon: 'receipt',
  surfaces: { record: { objectIds: [ids.objects.invoice], frame: false, header: true } },
  component: function InvoiceHeader() {
    const { record } = useRecordPage();
    const { slug } = useWorkspace();
    const navigation = useNavigation();
    const invoice = useInvoice(record);
    const { lines, payments, lineItems, paymentItems, totals, balance, status, editable, today, overdue } = invoice;
    const { patch, pending } = usePatchInvoice(record);
    const createPayment = useCreateRecord('payment');
    const [paying, setPaying] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [confirmVoid, setConfirmVoid] = useState(false);
    const busy = pending || createPayment.isPending;
    const number = text(record.number) ?? record.id;
    const companyId = text(record.company);
    const customers = useCustomers([companyId]);
    const statusOption = statusOf(status);
    const send = () =>
      void patch({ ...totals, status: 'sent', ...(text(record.issue_date) ? {} : { issue_date: today }) });
    const recordPayment = async (input: PaymentInput) => {
      await createPayment.mutateAsync({
        invoice: record.id,
        amount: round2(input.amount),
        paid_on: input.paid_on,
        method: input.method,
        ...(input.reference ? { reference: input.reference } : {}),
      });
      const paid = invoice.paid;
      const settled = balanceOf(totals.total, round2(paid + input.amount)) <= 0;
      await patch({ ...totals, ...(settled ? { status: 'paid', payment_url: null } : {}) });
      setPaying(false);
    };

    return (
      <div
        className="flex flex-wrap items-start justify-between gap-4"
        data-slot="invoice-header"
        data-status={String(status)}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate font-heading text-heading">{number}</h1>
            {statusOption ? <OptionBadge option={statusOption} /> : null}
            {overdue ? <OptionBadge option={PAST_DUE} /> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {companyId ? (
              <navigation.Link
                href={links.record(slug, 'company', companyId)}
                className="inline-flex min-w-0 items-center gap-2 hover:text-foreground hover:underline"
              >
                {customers.showsLogos ? (
                  <RecordImage src={customers.logoOf(companyId)} icon={customers.icon as IconName} />
                ) : null}
                <span className="truncate">{customers.nameOf(companyId)}</span>
              </navigation.Link>
            ) : (
              <span>No customer yet</span>
            )}
            <span aria-hidden>·</span>
            <span>{text(record.issue_date) ? `Issued ${formatDate(text(record.issue_date))}` : 'Not issued yet'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-action="preview"
            disabled={lines.isPending || payments.isPending}
            onClick={() => setPreviewing(true)}
          >
            <Icon name="file-text" />
            Preview PDF
          </Button>
          {editable ? (
            <>
              <Button
                variant="outline"
                data-action="open-composer"
                onClick={() => navigation.navigate(links.page(slug, `billing/${record.id}/edit`))}
              >
                <Icon name="pencil" />
                Edit in composer
              </Button>
              <Button
                data-action="send"
                disabled={busy || lineItems.length === 0}
                title={lineItems.length === 0 ? 'Add an item first' : undefined}
                onClick={send}
              >
                <Icon name="mail" />
                Send invoice
              </Button>
            </>
          ) : status === 'sent' ? (
            <>
              <Button variant="outline" data-action="void" disabled={busy} onClick={() => setConfirmVoid(true)}>
                Void invoice
              </Button>
              <Button data-action="record-payment" disabled={busy || balance <= 0} onClick={() => setPaying(true)}>
                <Icon name="dollar-sign" />
                Record payment
              </Button>
            </>
          ) : null}
        </div>

        {previewing ? (
          <InvoicePreviewDialog
            invoice={record}
            lines={lineItems}
            payments={paymentItems}
            onClose={() => setPreviewing(false)}
          />
        ) : null}

        {paying ? (
          <RecordPaymentDialog
            open
            balance={balance}
            busy={busy}
            onOpenChange={(open) => {
              if (!open) {
                setPaying(false);
              }
            }}
            onSubmit={recordPayment}
          />
        ) : null}

        <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Void {number}?</AlertDialogTitle>
              <AlertDialogDescription>
                The invoice stays on record as void and cannot be paid or edited afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  setConfirmVoid(false);
                  await patch({ ...totals, status: 'void' });
                }}
              >
                Void invoice
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
});
