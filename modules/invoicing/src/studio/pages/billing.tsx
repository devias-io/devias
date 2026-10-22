import {
  type AggregateQuery,
  daysBetween,
  definePageComponent,
  type Filter,
  localDate,
  num,
  plural,
  type Query,
  type RecordData,
  round2,
} from '@devias/core';
import {
  links,
  RecordImage,
  useAggregate,
  useNavigation,
  useRecords,
  useSchema,
  useSetBreadcrumbs,
  useWorkspace,
} from '@devias/studio';
import {
  Button,
  ColumnChart,
  type ColumnDatum,
  cn,
  EmptyState,
  Figure,
  Figures,
  Icon,
  type IconName,
  InsightCard,
  Page,
  PageHeader,
  Section,
  Skeleton,
} from '@devias/ui';
import { useMemo } from 'react';
import { isOverdue } from '../../lib/totals';
import { ids } from '../../manifest';
import { InvoiceComposerPage } from '../composer/invoice-composer';
import { money, sentFilter, text, useCustomers } from '../shared';

/**
 * Billing, centered like Home. A row of stat cards leads (outstanding in black, the one emphasis, then overdue and
 * collected). Then what is analysed, in two white cards: the money that came in month by month, and how late what is
 * open is. Then the invoices to act on as plain sections of rows, as a record page names its parts: overdue, open and recently paid.
 */

const invoiceQuery = (filter: Filter, sort: Query['sort'], limit: number): Query => ({
  object: 'invoice',
  filter,
  sort,
  limit,
});

const sum = (records: readonly RecordData[], field: string) =>
  round2(records.reduce((total, record) => total + num(record[field]), 0));

const COLLECTED_DAYS = 30;
const MONTHS = 6;

/** Whole days from one `YYYY-MM-DD` to another; both read as UTC midnight, so the difference is whole days. */
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monthTick = new Intl.DateTimeFormat(undefined, { month: 'short' });

/** The buckets open invoices fall in: not yet due, then how many days late, with the bar's colour for each. */
const AGE = [
  { label: 'Not yet due', max: 0, fill: 'bg-muted-foreground/30' },
  { label: '1–30 days late', max: 30, fill: 'bg-destructive/35' },
  { label: '31–60 days late', max: 60, fill: 'bg-destructive/55' },
  { label: '61–90 days late', max: 90, fill: 'bg-destructive/75' },
  { label: 'More than 90 days late', max: Number.POSITIVE_INFINITY, fill: 'bg-destructive' },
] as const;

/** Where an open invoice falls: 0 for one not yet due (or with no due date), then 1 to 4 by how late it is. */
const bucketOf = (invoice: RecordData, today: string): number => {
  const due = text(invoice.due_date);
  const late = due ? daysBetween(due, today) : 0;

  if (late <= 0) {
    return 0;
  }

  return AGE.findIndex((bucket, index) => index > 0 && late <= bucket.max);
};

/** "12 days overdue", "Due in 9 days", "Due 5 Nov": when an open invoice is due, in words. */
const dueWords = (due: string | null, today: string): { text: string; late: boolean } => {
  if (!due) {
    return { text: 'No due date', late: false };
  }

  const days = daysBetween(today, due);

  if (days < 0) {
    return { text: days === -1 ? '1 day overdue' : `${-days} days overdue`, late: true };
  }

  if (days === 0) {
    return { text: 'Due today', late: false };
  }

  if (days <= 30) {
    return { text: days === 1 ? 'Due tomorrow' : `Due in ${days} days`, late: false };
  }

  return { text: `Due ${shortDay.format(new Date(`${due}T00:00:00`))}`, late: false };
};

/** The link in a section's heading row: all the invoices, as quiet grey text with an arrow. */
function ViewAll() {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();

  return (
    <Link
      href={links.object(slug, 'invoice')}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4"
    >
      View all
      <Icon name="arrow-right" className="size-3.5" />
    </Link>
  );
}

/** A table of invoices: the number, the customer, when it is due (or was paid) and what it comes to. */
function InvoiceRows({
  records,
  when,
  empty,
  today,
}: {
  records: RecordData[] | undefined;
  when: 'due' | 'paid';
  empty: string;
  today: string;
}) {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();
  const companyIds = (records ?? []).map((record) => text(record.company));
  const customers = useCustomers(companyIds);

  if (!records) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (records.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <div data-slot="invoice-rows">
      <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 text-xs font-medium text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_7rem]">
        <span>Invoice</span>
        <span className="hidden md:block">Customer</span>
        <span className="hidden md:block">{when === 'due' ? 'Due' : 'Paid'}</span>
        <span className="text-right">Amount</span>
      </div>
      <ul>
        {records.map((record) => {
          const company = text(record.company);
          const due = when === 'due' ? dueWords(text(record.due_date), today) : null;
          const paid = record.updated_at ? shortDay.format(new Date(String(record.updated_at))) : '—';

          return (
            <li key={record.id} className="not-last:border-b not-last:border-subtle-border">
              <Link
                href={links.record(slug, 'invoice', record.id)}
                className="-mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-sm px-3 py-2.5 text-xs transition-colors hover:bg-muted/70 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_7rem]"
              >
                <span className="truncate font-medium">{text(record.number) ?? record.id}</span>
                <span className="hidden min-w-0 items-center gap-2 text-muted-foreground md:flex">
                  {company && customers.showsLogos ? (
                    <RecordImage src={customers.logoOf(company)} icon={customers.icon as IconName} />
                  ) : null}
                  <span className="truncate">{company ? customers.nameOf(company) : '—'}</span>
                </span>
                <span className="hidden min-w-0 md:block">
                  {due?.late ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2.5 text-xs font-medium text-destructive">
                      {due.text}
                    </span>
                  ) : (
                    <span className="block truncate text-muted-foreground">{due ? due.text : `Paid ${paid}`}</span>
                  )}
                </span>
                <span className="text-right tabular-nums">{money(num(record.total))}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What is owed, as one bar split by how late it is, with each bucket and its amount under it. */
function AgeBar({ totals, outstanding }: { totals: number[]; outstanding: number }) {
  const summary = AGE.map((bucket, position) => `${bucket.label} ${money(totals[position] ?? 0)}`).join(', ');

  return (
    <div className="flex flex-col gap-5" data-slot="age">
      {outstanding > 0 ? (
        <div
          role="img"
          aria-label={`Open invoices by age, ${money(outstanding)}: ${summary}`}
          className="flex h-2 gap-0.5"
        >
          {AGE.map((bucket, position) =>
            (totals[position] ?? 0) > 0 ? (
              <span
                key={bucket.label}
                className={cn('min-w-1.5 rounded-full', bucket.fill)}
                style={{ flexGrow: totals[position] }}
              />
            ) : null,
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing is owed right now.</p>
      )}
      <dl className="flex flex-col gap-2.5">
        {AGE.map((bucket, position) => {
          const amount = totals[position] ?? 0;

          return (
            <div key={bucket.label} className="flex items-center gap-2 text-xs" data-bucket={position}>
              <span className={cn('size-2 shrink-0 rounded-full', bucket.fill)} />
              <dt className="text-muted-foreground">{bucket.label}</dt>
              <dd className={cn('ms-auto tabular-nums', amount === 0 && 'text-muted-foreground')}>{money(amount)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function BillingPage() {
  const { index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  useSetBreadcrumbs([{ label: 'Billing' }]);
  const today = useMemo(() => localDate(new Date()), []);
  // The first day of the oldest month the chart shows, and the first day of the last 30 days.
  const months = useMemo(() => {
    const now = new Date();

    return Array.from({ length: MONTHS }, (_, offset) => {
      const first = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - offset), 1);

      return { key: localDate(first).slice(0, 7), name: monthName.format(first), tick: monthTick.format(first) };
    });
  }, []);
  const since30 = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - (COLLECTED_DAYS - 1));

    return localDate(date);
  }, []);
  const [sentQuery, overdueQuery, openQuery, paidQuery] = useMemo<[Query, Query, Query, Query]>(
    () => [
      { object: 'invoice', select: ['total', 'due_date', 'status'], filter: sentFilter, limit: 200, count: true },
      invoiceQuery(
        { and: [sentFilter, { field: 'due_date', op: 'lt', value: today }] },
        [{ field: 'due_date', direction: 'asc' }],
        10,
      ),
      invoiceQuery(
        {
          and: [
            sentFilter,
            {
              or: [
                { field: 'due_date', op: 'gte', value: today },
                { field: 'due_date', op: 'is_empty', value: null },
              ],
            },
          ],
        },
        [{ field: 'due_date', direction: 'asc' }],
        5,
      ),
      invoiceQuery({ field: 'status', op: 'eq', value: 'paid' }, [{ field: 'updated_at', direction: 'desc' }], 5),
    ],
    [today],
  );
  // What was paid on each day since the chart starts, summed in the database: the chart and the 30-day figure both
  // read from it, exact however many payments there are.
  const paymentsQuery = useMemo<AggregateQuery>(
    () => ({
      object: 'payment',
      filter: { field: 'paid_on', op: 'gte', value: `${months[0]?.key ?? today.slice(0, 7)}-01` },
      groupBy: 'paid_on',
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'amount' }],
      limit: 500,
    }),
    [months, today],
  );
  const sent = useRecords(sentQuery);
  const overdue = useRecords(overdueQuery);
  const open = useRecords(openQuery);
  const paid = useRecords(paidQuery);
  const payments = useAggregate(paymentsQuery);

  const sentItems = sent.data?.items ?? [];
  const overdueItems = sentItems.filter((item) => isOverdue(item, today));
  const outstanding = sum(sentItems, 'total');
  const ageTotals = useMemo(() => {
    const totals: number[] = AGE.map(() => 0);

    for (const invoice of sentItems) {
      const bucket = bucketOf(invoice, today);
      totals[bucket] = round2((totals[bucket] ?? 0) + num(invoice.total));
    }

    return totals;
  }, [sentItems, today]);
  const { byMonth, last30, last30Count } = useMemo(() => {
    const byMonth = new Map<string, number>();
    let last30 = 0;
    let last30Count = 0;

    for (const group of payments.data?.groups ?? []) {
      const total = group.values['sum.amount'];

      if (typeof group.key !== 'string' || typeof total !== 'number') {
        continue;
      }

      byMonth.set(group.key.slice(0, 7), (byMonth.get(group.key.slice(0, 7)) ?? 0) + total);

      if (group.key >= since30) {
        last30 += total;
        last30Count += group.count;
      }
    }

    return { byMonth, last30: round2(last30), last30Count };
  }, [payments.data, since30]);
  const columns = useMemo<ColumnDatum[]>(
    () =>
      months.map((month) => ({
        label: month.name,
        tick: month.tick,
        values: [round2(byMonth.get(month.key) ?? 0)],
      })),
    [months, byMonth],
  );
  const collectedInRange = round2([...byMonth.values()].reduce((total, value) => total + value, 0));

  if (!index.objectsById.has(ids.objects.invoice)) {
    return (
      <EmptyState icon="receipt" title="Invoices are not installed" description="Apply the Invoicing module first." />
    );
  }

  return (
    <Page className="mx-auto w-full max-w-[90rem] px-6 pt-8 pb-16 sm:px-10">
      <PageHeader
        title="Billing"
        description="Invoices out with customers, and what was settled recently."
        actions={
          <Button onClick={() => navigation.navigate(links.page(slug, 'billing/new'))}>
            <Icon name="plus" className="size-4" /> New invoice
          </Button>
        }
      />
      <div className="@container flex flex-col gap-6 pt-2" data-slot="billing">
        <Figures columns={3} tiles>
          <Figure
            label="Outstanding"
            value={sent.isPending ? '–' : money(outstanding)}
            hint={sent.isPending ? undefined : plural(sent.data?.totalCount ?? sentItems.length, 'invoice', 'invoices')}
          />
          <Figure
            label="Overdue"
            value={sent.isPending ? '–' : money(sum(overdueItems, 'total'))}
            hint={sent.isPending ? undefined : plural(overdueItems.length, 'invoice', 'invoices')}
            alert={overdueItems.length > 0}
          />
          <Figure
            label={`Collected, last ${COLLECTED_DAYS} days`}
            value={payments.isPending ? '–' : money(last30)}
            hint={payments.isPending ? undefined : plural(last30Count, 'payment', 'payments')}
          />
        </Figures>

        <div className="grid gap-4 @3xl:grid-cols-2" data-slot="billing-analysis">
          <InsightCard
            icon="trending-up"
            title="Money in"
            meta={payments.isPending ? undefined : money(collectedInRange)}
          >
            <div className="h-40">
              {payments.isPending ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ColumnChart
                  data={columns}
                  series={[{ label: 'Collected', tone: 'brand' }]}
                  // The chart names the month under the figure itself, so the readout is the amount alone.
                  format={(datum) => money(datum.values[0] ?? 0)}
                  aria-label={`Money in by month, last ${MONTHS} months: ${money(collectedInRange)}`}
                />
              )}
            </div>
          </InsightCard>
          <InsightCard icon="clock" title="Open by age" meta={sent.isPending ? undefined : money(outstanding)}>
            {sent.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <AgeBar totals={ageTotals} outstanding={outstanding} />
            )}
          </InsightCard>
        </div>

        <Section variant="plain" title="Overdue" actions={<ViewAll />}>
          <InvoiceRows records={overdue.data?.items} when="due" empty="Nothing overdue." today={today} />
        </Section>
        <Section variant="plain" title="Open" actions={<ViewAll />}>
          <InvoiceRows records={open.data?.items} when="due" empty="No open invoices." today={today} />
        </Section>
        <Section variant="plain" title="Recently paid" actions={<ViewAll />}>
          <InvoiceRows records={paid.data?.items} when="paid" empty="Nothing paid yet." today={today} />
        </Section>
      </div>
    </Page>
  );
}

export const billingPages = [
  definePageComponent({ id: ids.pages.billing, path: 'billing', component: BillingPage }),
  // The invoices page's New button opens the composer instead of the create dialog.
  definePageComponent({
    id: ids.pages.billing_new,
    path: 'billing/new',
    component: InvoiceComposerPage,
    creates: 'invoice',
  }),
  definePageComponent({ path: 'billing/$invoiceId/edit', component: InvoiceComposerPage }),
];
