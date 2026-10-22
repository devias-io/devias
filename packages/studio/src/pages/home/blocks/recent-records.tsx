import { coreIds, defineBlockComponent, type ObjectMetadata, primaryFieldOf, type RecordData } from '@devias/core';
import { Icon, InsightCard, InsightText, Skeleton } from '@devias/ui';
import { ago } from '../../../lib/time';
import { recordLabel } from '../../../providers/labels';
import { useSchema } from '../../../providers/schema';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { useRecordsPerObject, useWorkspaceObjects } from './records';

const ROWS = 6;

/** The records changed most recently, whatever their object: the latest few of each, merged. */
function RecentRecordsCard() {
  const { slug } = useWorkspace();
  const { index } = useSchema();
  /** A record without a label (a stock move with no reference) reads as untitled, not as its id. */
  const labelOf = (record: RecordData, object: ObjectMetadata) => {
    const label = recordLabel(record, primaryFieldOf(index, object));

    return label === record.id ? `Untitled ${object.labelSingular.toLowerCase()}` : label;
  };
  const navigation = useNavigation();
  const objects = useWorkspaceObjects();
  const results = useRecordsPerObject(objects, (object) => ({
    object: object.nameSingular,
    sort: [{ field: 'updated_at', direction: 'desc' }],
    limit: ROWS,
  }));
  const loading = results.some((result) => result.isPending);
  const recent = objects
    .flatMap((object, i) => (results[i]?.data?.items ?? []).map((record: RecordData) => ({ object, record })))
    .filter(({ record }) => typeof record.updated_at === 'string')
    .sort((a, b) => String(b.record.updated_at).localeCompare(String(a.record.updated_at)))
    .slice(0, ROWS);

  return (
    <InsightCard icon="clock" title="Recently updated">
      {loading ? (
        <Skeleton className="h-6 w-3/4" />
      ) : recent.length === 0 ? (
        <InsightText>Nothing yet. Records you and your team change show up here.</InsightText>
      ) : (
        <ul className="flex flex-col text-xs">
          {recent.map(({ object, record }) => (
            <li key={`${object.id}:${record.id}`}>
              <navigation.Link
                href={links.record(slug, object.nameSingular, record.id)}
                className="flex h-8 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon name={object.icon ?? 'box'} className="size-3.5 shrink-0" />
                <span className="truncate text-foreground">{labelOf(record, object)}</span>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">{ago(String(record.updated_at))}</span>
              </navigation.Link>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

export const recentRecordsBlock = defineBlockComponent({
  id: coreIds.blocks.recent_records,
  label: 'Recently updated',
  icon: 'clock',
  surfaces: { home: { order: 70 } },
  component: RecentRecordsCard,
});
