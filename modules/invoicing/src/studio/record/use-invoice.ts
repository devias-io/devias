import { localDate, type RecordData } from '@devias/core';
import { useRecords, useUpdateRecord } from '@devias/studio';
import { useMemo } from 'react';
import { balanceOf, discountOfInvoice, isOverdue, paidOf, totalsOf } from '../../lib/totals';
import { currencyOf, money as formatMoney, linesQuery, paymentsQuery } from '../shared';

/**
 * What the invoice's blocks share: its lines and payments (each block asks, the query cache answers once), what they
 * add up to, and whether the invoice can still be edited: a draft is, a sent, paid or void invoice is final.
 */
export function useInvoice(record: RecordData) {
  const lines = useRecords(useMemo(() => linesQuery(record.id), [record.id]));
  const payments = useRecords(useMemo(() => paymentsQuery(record.id), [record.id]));
  const lineItems = lines.data?.items ?? [];
  const paymentItems = payments.data?.items ?? [];
  const totals = totalsOf(lineItems, record.tax_rate, discountOfInvoice(record));
  const currency = currencyOf(record);
  const paid = paidOf(paymentItems);
  const today = localDate(new Date());

  return {
    lines,
    payments,
    lineItems,
    paymentItems,
    totals,
    paid,
    balance: balanceOf(totals.total, paid),
    money: (value: number) => formatMoney(value, currency),
    status: record.status,
    editable: record.status === 'draft',
    today,
    overdue: isOverdue(record, today),
  };
}

/** Saves changes to the invoice itself, at once. */
export function usePatchInvoice(record: RecordData) {
  const update = useUpdateRecord('invoice');

  return {
    patch: (changes: Record<string, unknown>) => update.mutateAsync({ id: record.id, patch: changes }),
    pending: update.isPending,
  };
}
