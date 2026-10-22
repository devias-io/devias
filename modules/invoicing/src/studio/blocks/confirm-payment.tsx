import {
  type ApprovalBlockProps,
  defineBlockComponent,
  localDate,
  namespacedToolName,
  num,
  round2,
} from '@devias/core';
import { links, useNavigation, useRecord, useRecords, useWorkspace } from '@devias/studio';
import { Button, buttonVariants, cn, Skeleton } from '@devias/ui';
import { useMemo } from 'react';
import { balanceOf, discountOfInvoice, paidOf, totalsOf } from '../../lib/totals';
import { ids, manifest, PAYMENT_METHODS } from '../../manifest';
import { currencyOf, linesQuery, money, paymentsQuery, text } from '../shared';

/** The tool the agent calls to record a payment: `invoicing__add_payment`. */
const RECORD_PAYMENT_TOOL = namespacedToolName(manifest.id, 'add_payment');

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `2026-10-24` as "24 Oct 2026". */
const dateOf = (value: string): string => {
  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

/**
 * What approving would do to the invoice, worked out the way the server does it (the invoice's lines and payments, not
 * the totals stored on it, which may be stale): how much is owed now, what this payment is, and what is left after.
 */
function useOutcome(invoiceId: string, amount: number | undefined) {
  const invoice = useRecord('invoice', invoiceId);
  const lines = useRecords(linesQuery(invoiceId));
  const payments = useRecords(paymentsQuery(invoiceId));
  const companyId = text(invoice.data?.company) ?? undefined;
  const company = useRecord('company', companyId);

  return useMemo(() => {
    const record = invoice.data;

    // Wait for the customer's name too, so it does not pop in after the amount.
    if (!record || !lines.data || !payments.data || company.isLoading) {
      return { loading: !invoice.isError, invoice: record };
    }

    const total = totalsOf(lines.data.items, record.tax_rate, discountOfInvoice(record)).total;
    const owed = balanceOf(total, paidOf(payments.data.items));
    const paying = round2(amount ?? owed);

    return {
      loading: false,
      invoice: record,
      customer: text(company.data?.name),
      owed,
      paying,
      after: round2(owed - paying),
    };
  }, [invoice.data, invoice.isError, lines.data, payments.data, company.data, company.isLoading, amount]);
}

/**
 * The card that asks the person to approve the agent recording a payment: what is paid, by whom, against which
 * invoice, and what is left to pay, with the invoice one click away. It cannot be answered while the invoice cannot
 * take the payment (a draft or void one), since the server would refuse it.
 */
function ConfirmPayment({ call, busy, approve, reject }: ApprovalBlockProps) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const input = isPlain(call.input) ? call.input : {};
  const invoiceId = text(input.invoice_id) ?? '';
  const amount = typeof input.amount === 'number' ? input.amount : undefined;
  const outcome = useOutcome(invoiceId, amount);
  const invoice = outcome.invoice;
  const label = text(invoice?.number) ?? invoiceId;
  const status = text(invoice?.status);
  const refusal =
    status === 'draft'
      ? 'This invoice is still a draft. Send it first.'
      : status === 'void'
        ? 'This invoice is void and takes no payments.'
        : outcome.owed !== undefined && outcome.owed <= 0
          ? 'Nothing is left to pay on this invoice.'
          : null;
  const currency = invoice ? currencyOf(invoice) : undefined;
  const method = PAYMENT_METHODS.find((m) => m.value === input.method)?.label ?? 'Bank transfer';
  const paidOn = dateOf(text(input.paid_on) ?? localDate(new Date()));
  const reference = text(input.reference);
  const ready = !outcome.loading && !refusal && outcome.paying !== undefined;
  // The line under the sentence: how it is paid and what it leaves, or why it cannot be.
  const after = num(outcome.after);
  const details = [
    method,
    paidOn,
    reference,
    after <= 0 ? 'settles the invoice' : currency ? `${money(after, currency)} left to pay` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const pill = 'rounded-full px-3.5';

  return (
    <div data-slot="payment-approval" className="flex flex-col gap-3 rounded-lg bg-muted/60 px-4.5 py-4">
      {outcome.loading ? (
        <Skeleton className="h-10 w-3/4" />
      ) : outcome.paying !== undefined && currency ? (
        <p className="text-sm leading-snug">
          Record <span className="font-medium tabular-nums">{money(outcome.paying, currency)}</span>
          {outcome.customer ? (
            <>
              {' '}
              from <span className="font-medium">{outcome.customer}</span>
            </>
          ) : null}{' '}
          on invoice <span className="font-medium">{label}</span>.
        </p>
      ) : (
        <p className="text-muted-foreground">
          The invoice could not be loaded, so what this would record cannot be shown. Open the technical details to see
          what was asked.
        </p>
      )}
      {refusal ? (
        <p className="-mt-1.5 text-destructive">{refusal}</p>
      ) : outcome.paying !== undefined ? (
        <p className="-mt-1.5 text-muted-foreground">{details}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={pill} onClick={approve} disabled={busy || !ready} data-action="approve">
          Approve
        </Button>
        {invoiceId ? (
          <navigation.Link
            href={links.record(slug, 'invoice', invoiceId)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), pill)}
          >
            Review
          </navigation.Link>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className={cn(pill, 'text-muted-foreground')}
          onClick={reject}
          disabled={busy}
          data-action="reject"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Approval widget for the agent recording a payment: shows the amount, the customer, the invoice and what is left. */
export const confirmPaymentBlock = defineBlockComponent({
  id: ids.blocks.confirm_payment,
  label: 'Confirm a payment',
  icon: 'receipt',
  requires: { objectIds: [ids.objects.invoice] },
  surfaces: { approval: { tools: [RECORD_PAYMENT_TOOL] } },
  component: ConfirmPayment,
});
