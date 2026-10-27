import { isDeletable, type ObjectMetadata, type RecordData, type Workflow } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { toast } from 'sonner';
import { isOpenRun, useRecordWorkflowRuns, useRunWorkflow, useWorkflows } from '../hooks/use-workflows';

/**
 * The manual workflows of an object, as menu items that run one on this record. They are a component of their own so
 * that the runs about the record are asked for when the menu is opened, not for every row of a table that draws one.
 */
function WorkflowItems({
  workflows,
  object,
  record,
}: {
  workflows: Workflow[];
  object: ObjectMetadata;
  record: RecordData;
}) {
  const runWorkflow = useRunWorkflow();
  // A workflow already working on this record is not run again until it is done.
  const running = useRecordWorkflowRuns(record.id);
  const busy = new Set((running.data?.items ?? []).filter(isOpenRun).map((run) => run.workflowId));

  return workflows.map((workflow) => (
    <DropdownMenuItem
      key={workflow.id}
      disabled={runWorkflow.isPending || busy.has(workflow.id)}
      onClick={() =>
        runWorkflow.mutate({
          id: workflow.id,
          name: workflow.title,
          object: object.nameSingular,
          recordId: record.id,
        })
      }
    >
      <Icon
        name={busy.has(workflow.id) ? 'loader-circle' : 'play'}
        className={busy.has(workflow.id) ? 'animate-spin' : undefined}
      />{' '}
      {workflow.title}
    </DropdownMenuItem>
  ));
}

/**
 * The ⋯ menu of a record: copy its link, run the object's manual workflows, delete it. The record page draws it in every
 * shell, a table draws it on each row, the trigger in the style of the place. Nothing to offer on a read-only object
 * without workflows, so then it draws nothing; Delete only shows while the record passes the object's `deleteWhen` rule.
 * `href` is the record's own address, for Copy link where the page is not the record's.
 */
export function RecordMenu({
  object,
  record,
  onDelete,
  label = 'Record actions',
  href,
  triggerProps,
}: {
  object: ObjectMetadata;
  record: RecordData;
  onDelete: () => void;
  label?: string;
  href?: string;
  triggerProps?: { variant?: 'outline' | 'ghost'; size?: 'icon' | 'icon-sm'; className?: string };
}) {
  // Manual workflows on this object show up here; members may run them.
  const workflows = useWorkflows();
  const manual = (workflows.data ?? []).filter(
    (w) => w.enabled && w.trigger.kind === 'manual' && w.trigger.objectId === object.id,
  );

  // Delete is offered while the object takes writes and the record passes the object's delete rule.
  const deletable = !object.readOnly && isDeletable(object, record);

  if (object.readOnly && manual.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={triggerProps?.variant ?? 'outline'}
            size={triggerProps?.size ?? 'icon'}
            aria-label={label}
            title="Actions"
            {...(triggerProps?.className ? { className: triggerProps.className } : {})}
          />
        }
      >
        <Icon name="more-horizontal" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard
              ?.writeText(href ? new URL(href, window.location.origin).href : window.location.href)
              .then(() => toast.success('Link copied'))
              .catch(() => toast.error('Could not copy'));
          }}
        >
          <Icon name="link" /> Copy link
        </DropdownMenuItem>
        <WorkflowItems workflows={manual} object={object} record={record} />
        {manual.length > 0 || deletable ? <DropdownMenuSeparator /> : null}
        {deletable ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Icon name="trash-2" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
