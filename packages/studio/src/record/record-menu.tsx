import { isDeletable, type ObjectMetadata, type RecordData } from '@devias/core';
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
import { useRunWorkflow, useWorkflows } from '../hooks/use-workflows';

/**
 * The ⋯ menu of a record page: copy its link, run the object's manual workflows, delete it. Every shell draws it, the
 * trigger in its own style. Nothing to offer on a read-only object without workflows, so then it draws nothing; Delete only shows while the
 * record passes the object's `deleteWhen` rule.
 */
export function RecordMenu({
  object,
  record,
  onDelete,
  label = 'Record actions',
  triggerProps,
}: {
  object: ObjectMetadata;
  record: RecordData;
  onDelete: () => void;
  label?: string;
  triggerProps?: { variant?: 'outline' | 'ghost'; size?: 'icon' | 'icon-sm'; className?: string };
}) {
  // Manual workflows on this object show up here; members may run them.
  const workflows = useWorkflows();
  const runWorkflow = useRunWorkflow();
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
              ?.writeText(window.location.href)
              .then(() => toast.success('Link copied'))
              .catch(() => toast.error('Could not copy'));
          }}
        >
          <Icon name="link" /> Copy link
        </DropdownMenuItem>
        {manual.map((workflow) => (
          <DropdownMenuItem
            key={workflow.id}
            disabled={runWorkflow.isPending}
            onClick={() =>
              runWorkflow.mutate({
                id: workflow.id,
                name: workflow.title,
                object: object.nameSingular,
                recordId: record.id,
              })
            }
          >
            <Icon name="play" /> {workflow.title}
          </DropdownMenuItem>
        ))}
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
