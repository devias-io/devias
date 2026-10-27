import type { RecordData, WorkflowRun } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import { isOpenRun, useRecordWorkflowRuns, useRunOutcomes, useWorkflows } from '../hooks/use-workflows';

/** Is a run that waits for a runner only waiting to try a step again? */
const retrying = (run: WorkflowRun): boolean =>
  run.status === 'pending' && run.steps.some((s) => s.status === 'retrying');

/**
 * Says a record is being worked on: a small mark in the page's header while a workflow run about it waits for a
 * runner, is being worked on or waits to try again, and nothing otherwise. It also announces how the runs this person
 * started ended. It reads the runs about the record, so it shows runs started by anyone, by a schedule or by a change.
 */
export function RecordRunStatus({ record, className }: { record: RecordData; className?: string }) {
  const runs = useRecordWorkflowRuns(record.id);
  const workflows = useWorkflows();
  useRunOutcomes(runs.data);
  const open = (runs.data?.items ?? []).filter(isOpenRun);

  if (open.length === 0) {
    return null;
  }

  const titleOf = (run: WorkflowRun) => workflows.data?.find((w) => w.id === run.workflowId)?.title ?? 'A workflow';
  const first = open[0] as WorkflowRun;
  const label =
    open.length > 1
      ? `${open.length} workflows running`
      : retrying(first)
        ? `Will try again: ${titleOf(first)}`
        : first.status === 'running'
          ? `Running ${titleOf(first)}`
          : `Queued: ${titleOf(first)}`;

  return (
    <span
      role="status"
      aria-live="polite"
      data-slot="record-run-status"
      title={open.map(titleOf).join(', ')}
      className={cn(
        'inline-flex max-w-64 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <Icon name="loader-circle" className="size-3.5 shrink-0 animate-spin" />
      <span className="truncate">{label}</span>
    </span>
  );
}
