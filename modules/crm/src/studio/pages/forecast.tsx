import { definePageComponent, primaryFieldOf, QUERY_MAX_LIMIT, type Query, type RecordData } from '@devias/core';
import { recordLabel, useNavigateTo, useNavigation, useRecords, useSchema, useSetBreadcrumbs } from '@devias/studio';
import {
  EmptyState,
  Page,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@devias/ui';
import { useMemo } from 'react';
import { ids } from '../../manifest';
import { OPEN_STAGES } from '../shared';

/** The open pipeline weighted by probability: per stage, then the deals in one stage. */

const amountOf = (record: RecordData) => (typeof record.amount === 'number' ? record.amount : 0);
/** `probability` is a 0-100 percent; deals without one count fully. */
const weightedOf = (record: RecordData) =>
  amountOf(record) * (typeof record.probability === 'number' ? record.probability / 100 : 1);
const sum = (records: RecordData[], of: (record: RecordData) => number) =>
  records.reduce((total, record) => total + of(record), 0);

/** "Based on the first 200 of 340 open deals." when the totals cover only part of them. */
function PartialNote({ shown, total }: { shown: number; total: number | undefined }) {
  if (total === undefined || total <= shown) {
    return null;
  }

  return (
    <p className="mb-3 text-xs text-muted-foreground">
      Based on the first {shown} of {total} open deals.
    </p>
  );
}

/** Formats amounts in the currency of the deal's `amount` field. */
const useMoney = () => {
  const { index } = useSchema();

  return useMemo(() => {
    const deal = index.objectsById.get(ids.objects.deal);
    const amountField = (deal ? index.fieldsByObjectId.get(deal.id) : undefined)?.find(
      (field) => field.name === 'amount',
    );
    const currency = (amountField?.settings as { currencyCode?: string } | undefined)?.currencyCode ?? 'EUR';
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });

    return (value: number) => format.format(value);
  }, [index]);
};

const useOpenDeals = (stages: string[]) =>
  useRecords(
    useMemo<Query>(
      () => ({
        object: 'deal',
        filter: { field: 'stage', op: 'in', value: stages },
        sort: [{ field: 'close_date', direction: 'asc' }],
        // Weighting is per deal, which aggregates cannot do: sum the first page and say when it is partial.
        limit: QUERY_MAX_LIMIT,
        count: true,
      }),
      [stages],
    ),
  );

const OPEN_STAGE_VALUES = OPEN_STAGES.map((stage) => stage.value);

function ForecastPage() {
  const nav = useNavigateTo();
  const money = useMoney();
  const deals = useOpenDeals(OPEN_STAGE_VALUES);
  useSetBreadcrumbs([{ label: 'Forecast' }]);
  const items = deals.data?.items ?? [];
  const rows = OPEN_STAGES.map((stage) => {
    const inStage = items.filter((item) => item.stage === stage.value);

    return { stage, count: inStage.length, amount: sum(inStage, amountOf), weighted: sum(inStage, weightedOf) };
  });

  return (
    <Page>
      <PageHeader title="Forecast" description="Open deals by stage, weighted by their probability." />
      <PartialNote shown={items.length} total={deals.data?.totalCount} />
      {deals.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState icon="trending-up" title="No open deals" description="Open deals show up here." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Deals</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Weighted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ stage, count, amount, weighted }) => (
              <TableRow
                key={stage.value}
                className="cursor-pointer"
                onClick={() => nav.toPage(`forecast/${stage.value}`)}
              >
                <TableCell className="font-medium">{stage.label}</TableCell>
                <TableCell className="text-right">{count}</TableCell>
                <TableCell className="text-right">{money(amount)}</TableCell>
                <TableCell className="text-right">{money(weighted)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{items.length}</TableCell>
              <TableCell className="text-right">{money(sum(items, amountOf))}</TableCell>
              <TableCell className="text-right">{money(sum(items, weightedOf))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </Page>
  );
}

function ForecastStagePage() {
  const { params } = useNavigation();
  const { index } = useSchema();
  const nav = useNavigateTo();
  const money = useMoney();
  const stage = OPEN_STAGES.find((s) => s.value === params.stage);
  const stages = useMemo(() => (stage ? [stage.value] : []), [stage]);
  const deals = useOpenDeals(stages);
  useSetBreadcrumbs([
    { label: 'Forecast', href: nav.href.page('forecast') },
    { label: stage?.label ?? params.stage ?? '' },
  ]);
  const deal = index.objectsById.get(ids.objects.deal);

  if (!stage || !deal) {
    return <EmptyState icon="circle-help" title="Unknown stage" description={`No open stage "${params.stage}".`} />;
  }

  const primaryField = primaryFieldOf(index, deal);
  const items = deals.data?.items ?? [];

  return (
    <Page>
      <PageHeader title={stage.label} description={`Open deals in ${stage.label}, by close date.`} />
      <PartialNote shown={items.length} total={deals.data?.totalCount} />
      {deals.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <EmptyState icon="target" title={`No deals in ${stage.label}`} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deal</TableHead>
              <TableHead>Close date</TableHead>
              <TableHead className="text-right">Probability</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Weighted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((record) => (
              <TableRow
                key={record.id}
                className="cursor-pointer"
                onClick={() => nav.toRecord(deal.nameSingular, record.id)}
              >
                <TableCell className="font-medium">{recordLabel(record, primaryField)}</TableCell>
                <TableCell>{typeof record.close_date === 'string' ? record.close_date.slice(0, 10) : '–'}</TableCell>
                <TableCell className="text-right">
                  {typeof record.probability === 'number' ? `${record.probability}%` : '–'}
                </TableCell>
                <TableCell className="text-right">{money(amountOf(record))}</TableCell>
                <TableCell className="text-right">{money(weightedOf(record))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}

export const forecastPages = [
  definePageComponent({ id: ids.pages.forecast, path: 'forecast', component: ForecastPage }),
  definePageComponent({ path: 'forecast/$stage', component: ForecastStagePage }),
];
