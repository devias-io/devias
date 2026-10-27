import { isTaskClosed, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, type Task, type TaskPatch } from '@devias/core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import type { ReactNode } from 'react';
import { AssigneeMenu } from '../../components/assignee';
import { EntityLink } from '../../components/entity-link';
import { PriorityIcon, StatusIcon } from '../../components/task-icons';
import { todayLocal } from '../../hooks/use-tasks';
import { ActorName, useActors } from '../../record/activity/shared';

const created = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One line of the properties column: what it is, and a quiet control that changes it. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3" data-slot="task-property">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface Choice {
  value: string;
  label: string;
  icon: ReactNode;
}

const quiet = 'h-8 w-full justify-start gap-2 px-2 font-normal text-foreground hover:bg-muted';

/** A property with a fixed set of choices: the current one on a quiet button, the others in a menu. */
function ChoiceProperty({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const current = choices.find((choice) => choice.value === value) ?? choices[0];

  return (
    <Property label={label}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label={label} disabled={disabled} className={quiet} />}
        >
          {current?.icon}
          <span className="truncate">{current?.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
            {choices.map((choice) => (
              <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                {choice.icon}
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Property>
  );
}

const STATUS_CHOICES: Choice[] = TASK_STATUS_OPTIONS.map((status) => ({
  value: status.value,
  label: status.label,
  icon: <StatusIcon status={status.value} />,
}));

const PRIORITY_CHOICES: Choice[] = TASK_PRIORITY_OPTIONS.map((priority) => ({
  value: priority.value,
  label: priority.label,
  icon: <PriorityIcon priority={priority.value} />,
}));

/**
 * A task's properties, in a quiet column: status, priority, assignee and due date, each changed in place and saved at
 * once, then what it is about, where it sits and who made it.
 */
export function TaskProperties({
  task,
  disabled,
  onChange,
}: {
  task: Task;
  disabled: boolean;
  onChange: (patch: TaskPatch) => void;
}) {
  const actors = useActors();
  const overdue = task.dueDate !== null && task.dueDate < todayLocal() && !isTaskClosed(task.status);
  const about = task.links.filter((link) => link.role === 'about');

  return (
    <div data-slot="task-properties" className="flex flex-col gap-6">
      <div className="flex flex-col">
        <ChoiceProperty
          label="Status"
          value={task.status}
          choices={STATUS_CHOICES}
          disabled={disabled}
          onChange={(status) => onChange({ status: status as Task['status'] })}
        />
        <ChoiceProperty
          label="Priority"
          value={task.priority}
          choices={PRIORITY_CHOICES}
          disabled={disabled}
          onChange={(priority) => onChange({ priority: priority as Task['priority'] })}
        />
        <Property label="Assignee">
          <AssigneeMenu value={task.assignee} disabled={disabled} onChange={(assignee) => onChange({ assignee })} />
        </Property>
        <Property label="Due date">
          <span className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Due date"
              value={task.dueDate ?? ''}
              disabled={disabled}
              className={cn(
                'h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted',
                overdue ? 'text-destructive' : 'text-foreground',
                !task.dueDate && 'text-muted-foreground',
              )}
              onChange={(event) => onChange({ dueDate: event.target.value || null })}
            />
            {task.dueDate && !disabled ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear due date"
                className="text-muted-foreground"
                onClick={() => onChange({ dueDate: null })}
              >
                <Icon name="x" />
              </Button>
            ) : null}
          </span>
        </Property>
      </div>
      {about.length > 0 ? (
        <div className="flex flex-col gap-2" data-slot="task-about">
          <h3 className="text-xs font-medium text-muted-foreground">About</h3>
          <div className="flex flex-wrap gap-1.5">
            {about.map((link) => (
              <EntityLink key={link.link} link={link.link} />
            ))}
          </div>
        </div>
      ) : null}
      {task.parentId ? (
        <div className="flex flex-col gap-2" data-slot="task-parent">
          <h3 className="text-xs font-medium text-muted-foreground">Subtask of</h3>
          <EntityLink link={`task:${task.parentId}`} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Created {created.format(new Date(task.createdAt))} by <ActorName person={actors(task.createdBy)} />
      </p>
    </div>
  );
}
