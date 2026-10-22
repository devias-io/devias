import { defineBlockComponent, plural, type Query } from '@devias/core';
import { links, useRecords, useSchema, useWorkspace } from '@devias/studio';
import { Highlight, InsightCard, InsightText, MiniBars } from '@devias/ui';
import { useMemo } from 'react';
import { ids } from '../../manifest';
import { Loading, OPEN_STAGES, SeeMore } from '../shared';

/** Home block: the open pipeline, its total and the deals per stage. */
function PipelineCard() {
  const { slug } = useWorkspace();
  const { index } = useSchema();
  const query = useMemo<Query>(
    () => ({
      object: 'deal',
      select: ['stage', 'amount'],
      filter: { field: 'stage', op: 'in', value: OPEN_STAGES.map((stage) => stage.value) },
      limit: 200,
      count: true,
    }),
    [],
  );
  const result = useRecords(query);
  const items = result.data?.items ?? [];
  const count = result.data?.totalCount ?? items.length;
  const total = items.reduce((sum, item) => sum + (typeof item.amount === 'number' ? item.amount : 0), 0);
  const deal = index.objectsById.get(ids.objects.deal);
  const amountField = (deal ? index.fieldsByObjectId.get(deal.id) : undefined)?.find(
    (field) => field.name === 'amount',
  );
  const currency = (amountField?.settings as { currencyCode?: string } | undefined)?.currencyCode ?? 'EUR';
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });

  return (
    <InsightCard
      icon="target"
      title="Pipeline"
      footer={<SeeMore href={links.object(slug, 'deal', ids.views.deal.pipeline)}>See pipeline</SeeMore>}
    >
      {result.isPending ? (
        <Loading />
      ) : count === 0 ? (
        <InsightText>
          No open deals yet. <Highlight>Add a deal</Highlight> to start the pipeline.
        </InsightText>
      ) : (
        <InsightText>
          You have <Highlight>{plural(count, 'open deal', 'open deals')}</Highlight> worth{' '}
          <Highlight>{money.format(total)}</Highlight>.
        </InsightText>
      )}
      <MiniBars
        values={OPEN_STAGES.map((stage) => items.filter((item) => item.stage === stage.value).length)}
        labels={OPEN_STAGES.map((stage) => stage.label)}
        aria-label="Open deals by stage"
      />
    </InsightCard>
  );
}

export const pipelineBlock = defineBlockComponent({
  id: ids.blocks.pipeline,
  label: 'Pipeline',
  icon: 'trending-up',
  requires: { objectIds: [ids.objects.deal] },
  // The chart needs the room.
  surfaces: { home: { order: 10, layout: { minH: 6 } } },
  component: PipelineCard,
});
