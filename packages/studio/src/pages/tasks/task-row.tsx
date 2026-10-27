import type { TaskSummary } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import { AssigneeAvatar, useAssignees } from '../../components/assignee';
import { DueChip } from '../../components/due-chip';
import { PriorityIcon, StatusIcon } from '../../components/task-icons';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';

/** The small facts after a title: subtasks done, due date, priority and who has it. */
export function TaskFacts({ task }: { task: TaskSummary }) {
  const { card } = useAssignees();
  const { total, open } = task.subtasks;

  return (
    <>
      {total > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Subtasks done">
          <Icon name="list-checks" className="size-3" />
          {total - open}/{total}
        </span>
      ) : null}
      {task.work === 'working' ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          title="An agent is on it"
        >
          <Icon name="loader-circle" className="size-3 animate-spin" />
        </span>
      ) : null}
      <DueChip date={task.dueDate} status={task.status} />
      {task.priority !== 'none' ? <PriorityIcon priority={task.priority} /> : null}
      <AssigneeAvatar card={card(task.assignee)} />
    </>
  );
}

/** One task as a row of the list: its status, its title and the facts, opening the task. */
export function TaskRow({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-slot="task-row"
      data-status={task.status}
      className="flex h-10 w-full items-center gap-3 px-4 text-left text-xs transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      onClick={onOpen}
    >
      <StatusIcon status={task.status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-medium',
          (task.status === 'done' || task.status === 'canceled') && 'text-muted-foreground line-through',
        )}
      >
        {task.title || UNTITLED_RECORD_LABEL}
      </span>
      <TaskFacts task={task} />
    </button>
  );
}
