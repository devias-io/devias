import { coreIds, defineBlockComponent, linkHref, type ObjectMetadata, type RecordData } from '@devias/core';
import { Button, Icon, Section } from '@devias/ui';
import { useMemo } from 'react';
import { useNewTask, useTasksAbout } from '../../hooks/use-tasks';
import { TaskRow } from '../../pages/tasks/task-row';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

/** The open tasks that are about a record, most urgent first, with a way to add one about it. */
export function RecordTasksSection({ object, record }: { object: ObjectMetadata; record: RecordData }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const newTask = useNewTask();
  const target = useMemo(
    () => ({ kind: 'record' as const, object: object.nameSingular, id: record.id }),
    [object.nameSingular, record.id],
  );
  const tasks = useTasksAbout(target);
  const items = tasks.data?.items ?? [];

  return (
    <Section
      variant="plain"
      title="Tasks"
      actions={
        <Button variant="ghost" size="sm" onClick={() => void newTask({ about: [linkHref(target)] })}>
          <Icon name="plus" /> New task about this
        </Button>
      }
    >
      {items.length > 0 ? (
        <ul data-slot="record-tasks" className="-mx-4 divide-y divide-border/60">
          {items.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} onOpen={() => navigation.navigate(links.task(slug, task.id))} />
            </li>
          ))}
        </ul>
      ) : tasks.isPending ? null : (
        <p className="text-xs text-muted-foreground">No open tasks about this.</p>
      )}
    </Section>
  );
}

/** Open tasks about the record, on every record page's overview, unless its layout places them. */
export const tasksBlock = defineBlockComponent({
  id: coreIds.blocks.tasks,
  label: 'Tasks',
  icon: 'check-square',
  surfaces: { record: { placement: 'overview', frame: false } },
  component: ({ record, object }) => (record && object ? <RecordTasksSection object={object} record={record} /> : null),
});
