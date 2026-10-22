import { daysBetween, type Filter, type Query } from '@devias/core';
import { externalHref, useNavigation, useRecords, useSchema } from '@devias/studio';
import { Avatar, AvatarFallback, AvatarImage, cn, Icon, Skeleton } from '@devias/ui';
import type { ReactNode } from 'react';
import { DEAL_STAGES, ids } from '../manifest';

/** Helpers shared by the CRM's blocks and pages. */

/** Stages of deals still in play: everything but won (`customer`) and lost. */
export const OPEN_STAGES = DEAL_STAGES.filter((stage) => stage.value !== 'customer' && stage.value !== 'lost');

export const countQuery = (object: string, filter: Filter): Query => ({ object, filter, limit: 1, count: true });

/** The matching-record count of a `count: true` query (undefined while loading). */
export const useCount = (query: Query): number | undefined => {
  const result = useRecords(query);

  return result.data ? (result.data.totalCount ?? result.data.items.length) : undefined;
};

/** A `YYYY-MM-DD` date as "20 Nov". */
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
export const dayOf = (date: string) => shortDay.format(new Date(`${date}T00:00:00`));

/** "Closes today", "Closes in 10 days", "Was due to close 3 days ago". */
export const closeWords = (date: string, today: string): string => {
  const days = daysBetween(today, date);

  if (days === 0) {
    return 'Closes today';
  }

  if (days > 0) {
    return days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`;
  }

  return days === -1 ? 'Was due to close yesterday' : `Was due to close ${-days} days ago`;
};

/** Deal amounts in the currency of the deal's amount field, without cents. */
export const useMoney = () => {
  const { index } = useSchema();
  const deal = index.objectsById.get(ids.objects.deal);
  const amount = (deal ? index.fieldsByObjectId.get(deal.id) : undefined)?.find((field) => field.name === 'amount');
  const currency = (amount?.settings as { currencyCode?: string } | undefined)?.currencyCode ?? 'EUR';
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });

  return (value: number) => format.format(value);
};

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

/** A fact or a way to reach a record, on the line under its name: quiet text with a small icon, ink when it goes somewhere. */
export const META = 'inline-flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5';
export const META_LINK = `${META} transition-colors hover:text-foreground`;

/** A company's logo, contained in a rounded square; a building stands in until there is one, or when it will not load. */
export function CompanyLogo({ logo, className }: { logo?: string | null; className?: string }) {
  const src = logo?.trim();

  return (
    <Avatar className={cn('rounded-sm after:rounded-sm', className)} data-slot="company-logo">
      {src ? <AvatarImage src={externalHref(src)} alt="" className="rounded-sm bg-white object-contain p-1" /> : null}
      <AvatarFallback className="rounded-sm">
        <Icon name="building-2" className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  );
}
