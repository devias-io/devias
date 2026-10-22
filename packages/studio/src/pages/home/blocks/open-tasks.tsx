import { coreIds, defineBlockComponent, plural } from '@devias/core';
import { Highlight, InsightCard, InsightMetric, InsightText, Skeleton } from '@devias/ui';
import { useTaskCounts } from '../../../hooks/use-tasks';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';

/** Open tasks, how many are the person's, how many are due this week, and how many are overdue. */
function OpenTasksCard() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const counts = useTaskCounts();
  const data = counts.data;

  return (
    <InsightCard
      icon="check-square"
      title="Tasks"
      meta="This week"
      footer={
        <navigation.Link href={links.tasks(slug)} className="transition-colors hover:text-foreground">
          See open tasks
        </navigation.Link>
      }
    >
      {data ? (
        <InsightText>
          <Highlight>{plural(data.open, 'open task', 'open tasks')}</Highlight>,{' '}
          <Highlight>{data.mine} yours</Highlight>, <Highlight>{data.dueThisWeek} due</Highlight> this week.
        </InsightText>
      ) : (
        <Skeleton className="h-6 w-3/4" />
      )}
      <InsightMetric label={data?.overdue === 1 ? 'task is overdue' : 'tasks are overdue'}>
        {data?.overdue ?? '–'}
      </InsightMetric>
    </InsightCard>
  );
}

export const openTasksBlock = defineBlockComponent({
  id: coreIds.blocks.open_tasks,
  label: 'Tasks',
  icon: 'check-square',
  surfaces: { home: { order: 25 } },
  component: OpenTasksCard,
});
