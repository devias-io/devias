import { defineBlockComponent, type Filter, plural, startOfWeek } from '@devias/core';
import { links, useWorkspace } from '@devias/studio';
import { Highlight, InsightCard, InsightMetric, InsightText } from '@devias/ui';
import { useMemo } from 'react';
import { ids } from '../../manifest';
import { countQuery, Loading, SeeMore, useCount } from '../shared';

/** Home block: the people, companies and deals added since Monday. */
function NewThisWeekCard() {
  const { slug } = useWorkspace();
  const queries = useMemo(() => {
    const since: Filter = { field: 'created_at', op: 'gte', value: startOfWeek(new Date()).toISOString() };

    return [countQuery('person', since), countQuery('company', since), countQuery('deal', since)] as const;
  }, []);
  const people = useCount(queries[0]);
  const companies = useCount(queries[1]);
  const deals = useCount(queries[2]);
  const loading = people === undefined || companies === undefined || deals === undefined;

  return (
    <InsightCard
      icon="users"
      title="New this week"
      meta="Since Monday"
      footer={<SeeMore href={links.object(slug, 'person')}>See people</SeeMore>}
    >
      {loading ? (
        <Loading />
      ) : (
        <InsightText>
          The team added <Highlight>{plural(people, 'person', 'people')}</Highlight>,{' '}
          <Highlight>{plural(companies, 'company', 'companies')}</Highlight> and{' '}
          <Highlight>{plural(deals, 'deal', 'deals')}</Highlight>.
        </InsightText>
      )}
      <InsightMetric label="new records">{loading ? '–' : people + companies + deals}</InsightMetric>
    </InsightCard>
  );
}

export const newThisWeekBlock = defineBlockComponent({
  id: ids.blocks.new_this_week,
  label: 'New this week',
  icon: 'sparkles',
  requires: { objectIds: [ids.objects.person, ids.objects.company, ids.objects.deal] },
  surfaces: { home: { order: 40 } },
  component: NewThisWeekCard,
});
