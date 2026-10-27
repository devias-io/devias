import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, type TaskActivityEntry, type TaskChange } from '@devias/core';
import type { IconName } from '@devias/ui';
import { type ReactNode, useMemo } from 'react';
import { useAssignees } from '../../components/assignee';
import { StatusIcon } from '../../components/task-icons';
import { type DescribeEntry, Timeline } from '../../components/timeline';
import { useCommentOnTask, useTaskActivity } from '../../hooks/use-tasks';
import { dayOf } from '../../lib/task-words';

const statusLabel = (value: unknown): string =>
  TASK_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? String(value);

const priorityLabel = (value: unknown): string =>
  TASK_PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? String(value);

/** What one change says, as the rest of a sentence about who made it: "moved it to Done". */
function ChangeWords({ change }: { change: TaskChange }) {
  const { card } = useAssignees();

  switch (change.field) {
    case 'status':
      return (
        <span className="inline-flex items-center gap-1.5">
          moved it from {statusLabel(change.from)} to <StatusIcon status={String(change.to)} className="size-3.5" />
          {statusLabel(change.to)}
        </span>
      );
    case 'priority':
      return <>set the priority to {priorityLabel(change.to)}</>;
    case 'assignee':
      return change.to ? <>assigned it to {card(String(change.to))?.name ?? 'someone'}</> : <>unassigned it</>;
    case 'dueDate':
      return change.to ? <>set the due date to {dayOf(String(change.to))}</> : <>removed the due date</>;
    case 'title':
      return <>renamed it to “{String(change.to)}”</>;
    case 'description':
      return <>edited the description</>;
    case 'parent':
      return change.to ? <>made it a subtask</> : <>made it a top-level task</>;
    case 'about':
      return <>changed what it is about</>;
    default:
      return <>changed it</>;
  }
}

/** What a task's entries say, as the rest of a sentence about who made them. */
const describeEntry: DescribeEntry<TaskActivityEntry> = (entry) => {
  const changes = (entry.data?.changes as TaskChange[] | undefined) ?? [];
  let words: ReactNode;

  if (entry.kind === 'created') {
    words = <>created this task</>;
  } else if (entry.kind === 'changed') {
    words = changes.map((change, i) => (
      <span key={`${change.field}-${i}`}>
        {i > 0 ? ' · ' : ''}
        <ChangeWords change={change} />
      </span>
    ));
  } else if (entry.kind === 'run') {
    words = runWords(entry);
  } else {
    words = <>reviewed this task</>;
  }

  const icon: IconName = entry.kind === 'created' ? 'plus' : entry.kind === 'run' ? 'bot' : 'pencil';

  return { icon, words };
};

const RUN_OUTCOME: Record<string, string> = {
  started: 'started working on this task',
  in_review: 'handed this task in for review',
  failed: 'could not finish this task',
  stopped: 'was stopped on this task',
  retried: 'sent this task back to the agent',
};

const runWords = (entry: TaskActivityEntry): string => {
  const outcome = String(entry.data?.outcome ?? '');
  const words = RUN_OUTCOME[outcome] ?? 'worked on this task';

  return entry.body && outcome !== 'started' ? `${words}: ${entry.body}` : words;
};

/** What happened to a task and what was said about it, oldest first, with a box to say something. */
export function TaskTimeline({ taskId, readOnly = false }: { taskId: string; readOnly?: boolean }) {
  const query = useTaskActivity(taskId);
  const comment = useCommentOnTask(taskId);
  const entries = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return (
    <Timeline
      slot="task-timeline"
      newestFirst={entries}
      loading={query.isPending}
      hasMore={Boolean(query.hasNextPage)}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      describe={describeEntry}
      onComment={(markdown, sent) => comment.mutate(markdown, { onSuccess: sent })}
      commenting={comment.isPending}
      readOnly={readOnly}
    />
  );
}
