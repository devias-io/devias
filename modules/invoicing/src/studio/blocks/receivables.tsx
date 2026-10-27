import { defineBlockComponent, localDate, num, plural, type Query, round2 } from '@devias/core';
import { links, useRecords, useWorkspace } from '@devias/studio';
import { Highlight, InsightCard, InsightMetric, InsightText } from '@devias/ui';
import { useMemo } from 'react';
import { isOverdue } from '../../lib/totals';
import { ids } from '../../manifest';
import { Loading, money, SeeMore, sentFilter } from '../shared';

/** Home block: the sent invoices, what they add up to and how many are past their due date. */
function ReceivablesCard() {
  const { slug } = useWorkspace();
  const today = useMemo(() => localDate(new Date()), []);
  const query = useMemo<Query>(
    () => ({ object: 'invoice', select: ['total', 'due_date', 'status'], filter: sentFilter, limit: 200, count: true }),
    [],
  );
  const result = useRecords(query);
  const items = result.data?.items ?? [];
  const count = result.data?.totalCount ?? items.length;
  const outstanding = round2(items.reduce((sum, item) => sum + num(item.total), 0));
  const overdue = items.filter((item) => isOverdue(item, today)).length;

  return (
    <InsightCard
      icon="receipt"
      title="Receivables"
      footer={
        <SeeMore href={links.object(slug, 'invoice', ids.views.invoice.outstanding)}>See outstanding invoices</SeeMore>
      }
    >
      {result.isPending ? (
        <Loading />
      ) : count === 0 ? (
        <InsightText>
          Nothing outstanding. <Highlight>Send an invoice</Highlight> to start tracking what is owed.
        </InsightText>
      ) : (
        <InsightText>
          <Highlight>{plural(count, 'invoice is', 'invoices are')}</Highlight> out with customers, worth{' '}
          <Highlight>{money(outstanding)}</Highlight>.
        </InsightText>
      )}
      <InsightMetric label={overdue === 1 ? 'invoice is overdue' : 'invoices are overdue'}>
        {result.isPending ? '–' : overdue}
      </InsightMetric>
    </InsightCard>
  );
}

export const receivablesBlock = defineBlockComponent({
  id: ids.blocks.receivables,
  label: 'Receivables',
  icon: 'receipt',
  requires: { objectIds: [ids.objects.invoice] },
  surfaces: { home: { order: 30 } },
  component: ReceivablesCard,
});
