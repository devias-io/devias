import { coreIds, defineBlockComponent, formatRecordCount } from '@devias/core';
import { Highlight, Icon, InsightCard, InsightText, Skeleton } from '@devias/ui';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { plural, useRecordCounts } from './records';

const ROWS = 3;

/** How many records each object has, the biggest first, each linking to its object. */
function RecordCountsCard() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const { counts, loading, total } = useRecordCounts();
  const rows = [...counts].sort((a, b) => b.count - a.count).slice(0, ROWS);

  return (
    <InsightCard
      icon="database"
      title="Your data"
      footer={
        rows[0] ? (
          <navigation.Link
            href={links.object(slug, rows[0].object.nameSingular)}
            className="transition-colors hover:text-foreground"
          >
            Open {rows[0].object.labelPlural.toLowerCase()}
          </navigation.Link>
        ) : (
          <navigation.Link href={links.settings(slug, 'modules')} className="transition-colors hover:text-foreground">
            Install a module
          </navigation.Link>
        )
      }
    >
      {loading ? (
        <Skeleton className="h-6 w-3/4" />
      ) : total === 0 ? (
        <InsightText>
          No records yet. Open an object and <Highlight>add the first one</Highlight>.
        </InsightText>
      ) : (
        <InsightText>
          You have <Highlight>{plural(total, 'record', 'records')}</Highlight> across{' '}
          <Highlight>{plural(counts.length, 'object', 'objects')}</Highlight>.
        </InsightText>
      )}
      {loading ? null : (
        <ul className="mt-auto flex min-h-0 flex-col overflow-hidden pt-6 text-xs">
          {rows.map(({ object, count }) => (
            <li key={object.id}>
              <navigation.Link
                href={links.object(slug, object.nameSingular)}
                className="flex h-8 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon name={object.icon ?? 'box'} className="size-3.5 shrink-0" />
                <span className="truncate">{object.labelPlural}</span>
                <span className="ms-auto text-foreground tabular-nums">{formatRecordCount(count)}</span>
              </navigation.Link>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

export const recordCountsBlock = defineBlockComponent({
  id: coreIds.blocks.record_counts,
  label: 'Your data',
  icon: 'database',
  surfaces: { home: { order: 60 } },
  component: RecordCountsCard,
});
