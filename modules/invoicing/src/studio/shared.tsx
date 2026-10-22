import { type Filter, imageFieldOf, type Query } from '@devias/core';
import { useNavigation, useRecords, useRelatedLabels, useSchema } from '@devias/studio';
import { Skeleton } from '@devias/ui';
import type { ReactNode } from 'react';
import { CURRENCY, INVOICE_STATUSES } from '../manifest';

/** Helpers shared by the module's blocks and pages. */

export const money = (value: number, currency: string = CURRENCY): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);

/** The currency an invoice is issued in. */
export const currencyOf = (invoice: Record<string, unknown>): string =>
  typeof invoice.currency === 'string' && invoice.currency ? invoice.currency : CURRENCY;

export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export const statusOf = (value: unknown) => INVOICE_STATUSES.find((status) => status.value === value);

/** Invoices that are out with the customer and not settled. */
export const sentFilter: Filter = { field: 'status', op: 'eq', value: 'sent' };

export const linesQuery = (invoiceId: string): Query => ({
  object: 'invoice_line',
  filter: { field: 'invoice', op: 'eq', value: invoiceId },
  sort: [{ field: 'created_at', direction: 'asc' }],
  limit: 200,
});

export const paymentsQuery = (invoiceId: string): Query => ({
  object: 'payment',
  filter: { field: 'invoice', op: 'eq', value: invoiceId },
  sort: [{ field: 'paid_on', direction: 'desc' }],
  limit: 200,
});

/** A card footer link. */
export function SeeMore({ href, children }: { href: string; children: ReactNode }) {
  const navigation = useNavigation();

  return (
    <navigation.Link href={href} className="transition-colors hover:text-foreground">
      {children}
    </navigation.Link>
  );
}

export const Loading = () => <Skeleton className="h-6 w-3/4" />;

/**
 * The customers of some invoices, ready to show: each one's name, and its logo (the company's picture field, when the
 * object has one) with the object's icon standing in until there is one.
 */
export function useCustomers(ids: readonly (string | null | undefined)[]) {
  const { index } = useSchema();
  const labels = useRelatedLabels('company', ids);
  const companyObject = index.objectsByName.get('company');
  const pictureField = companyObject ? imageFieldOf(index, companyObject)?.name : undefined;
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const pictures = useRecords(
    pictureField && wanted.length > 0
      ? {
          object: 'company',
          select: [pictureField],
          filter: { field: 'id', op: 'in', value: wanted },
          limit: wanted.length,
        }
      : null,
  );
  const logos = new Map((pictures.data?.items ?? []).map((item) => [item.id, text(item[pictureField ?? '']) ?? null]));

  return {
    /** Whether the company object has a picture field at all: without one no logo or icon is drawn. */
    showsLogos: Boolean(pictureField),
    icon: (companyObject?.icon as string | undefined) ?? 'building-2',
    nameOf: (id: string) => labels.get(id) ?? '—',
    logoOf: (id: string) => logos.get(id) ?? null,
  };
}
