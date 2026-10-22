import {
  ACTIONS,
  ANY_EVENT,
  coreIds,
  type InstalledModule,
  type RecordEventType,
  type SchemaIndex,
  type TASK_EVENT_TYPES,
  TASK_STATUS_OPTIONS,
  TRIGGER_RECORD_ID,
  type Workflow,
  type WorkflowHealth,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowStepInput,
  type WorkflowTrigger,
  type WorkflowTriggerKind,
} from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  type IconName,
  pillTabClassName,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
} from '@devias/ui';
import { format, isToday, isYesterday } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../hooks/use-mutations';
import {
  useDeleteWorkflow,
  useRetryWorkflowRun,
  useSaveWorkflow,
  useWorkflowActivity,
  useWorkflowRuns,
  useWorkflows,
} from '../../hooks/use-workflows';
import { type ActivityRange, activityRange } from '../../lib/activity-range';
import { ago, due } from '../../lib/time';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { WorkflowActivityCard } from './workflow-activity';

// ---------------------------------------------------------------------------------------------
// Words: how triggers, steps and runs read in the studio. Shared with the editor.
// ---------------------------------------------------------------------------------------------

export const EVENT_LABEL: Record<RecordEventType, string> = {
  'record.created': 'created',
  'record.updated': 'updated',
  'record.deleted': 'deleted',
};

export const TRIGGER_KINDS: {
  value: WorkflowTriggerKind;
  label: string;
  /** On a workflow card, above its name. */
  short: string;
  icon: IconName;
  hint: string;
}[] = [
  {
    value: 'record_event',
    label: 'When a record changes',
    short: 'Record change',
    icon: 'zap',
    hint: 'Runs as records are created, updated or deleted.',
  },
  {
    value: 'manual',
    label: 'When someone runs it',
    short: 'Run by hand',
    icon: 'play',
    hint: 'Appears in the Actions menu of a record.',
  },
  {
    value: 'schedule',
    label: 'On a schedule',
    short: 'Schedule',
    icon: 'clock',
    hint: 'Runs at an interval, once per matching record.',
  },
  {
    value: 'task_event',
    label: 'When a task changes',
    short: 'Task change',
    icon: 'check-square',
    hint: 'Runs as tasks are created, assigned, commented on or move to a status.',
  },
  {
    value: 'event',
    label: 'When a module sends an event',
    short: 'Module event',
    icon: 'plug',
    hint: 'Runs when an outside service posts a webhook to a module, such as a payment received by a payment provider.',
  },
];

/**
 * What "+" offers. Every step runs an action or branches: updating the record and creating one are the usual actions,
 * with forms of their own; "Run an action" picks any other, core's or an installed module's.
 */
export type StepPreset = 'update' | 'create' | 'action' | 'branch';

export const STEP_PRESETS: { value: StepPreset; label: string; icon: IconName }[] = [
  { value: 'update', label: 'Update the record', icon: 'pencil' },
  { value: 'create', label: 'Create a record', icon: 'plus' },
  { value: 'action', label: 'Run an action', icon: 'zap' },
  { value: 'branch', label: 'If / else', icon: 'arrow-up-down' },
];

/** Which preset a step looks like. */
export const presetOf = (step: WorkflowStepInput): StepPreset => {
  if (step.kind === 'branch') {
    return 'branch';
  }

  if (step.actionId === coreIds.actions.update_record && step.input.id === TRIGGER_RECORD_ID) {
    return 'update';
  }

  if (step.actionId === coreIds.actions.create_record) {
    return 'create';
  }

  return 'action';
};

export const stepPreset = (preset: StepPreset) =>
  STEP_PRESETS.find((option) => option.value === preset) ?? (STEP_PRESETS[0] as (typeof STEP_PRESETS)[number]);

/** How a past run names a step that had no name: core's action summary, or the module action's id. */
const ranStepLabel = (step: WorkflowRunStep): string => {
  if (step.kind === 'branch') {
    return stepPreset('branch').label;
  }

  const core = ACTIONS.find((spec) => spec.id === step.actionId);

  return core?.summary ?? step.actionId ?? 'Step';
};

/** "invoice.paid or invoice.payment_failed", or "any event". */
export const describeEventTypes = (types: string[]): string =>
  types.includes(ANY_EVENT) ? 'any event' : joinWords(types);

/** What a task event is called in a sentence, by the action it records. */
export const TASK_EVENT_LABEL: Record<(typeof TASK_EVENT_TYPES)[number], string> = {
  created: 'created',
  updated: 'changed',
  status_changed: 'moved to a status',
  assigned: 'assigned',
  commented: 'commented on',
  run_failed: 'failed by an agent',
};

export const triggerKind = (kind: WorkflowTriggerKind) =>
  TRIGGER_KINDS.find((k) => k.value === kind) ?? {
    value: kind,
    label: kind,
    short: kind,
    icon: 'circle' as IconName,
    hint: '',
  };

/** "a deal", "an invoice". */
const withArticle = (noun: string): string => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

const joinWords = (words: string[]): string =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;

/** "Every hour", "Every 2 days", "Every 15 minutes". */
export const describeInterval = (minutes: number): string => {
  if (minutes % 1440 === 0) {
    return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
  }

  if (minutes % 60 === 0) {
    return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  }

  return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`;
};

type ModuleLabel = Pick<InstalledModule, 'moduleId' | 'name'>;

const moduleLabel = (modules: ModuleLabel[], id: string | undefined): string | undefined => {
  const module = modules.find((candidate) => candidate.moduleId === id);

  return module ? module.name : id;
};

/** One line saying when a workflow runs, in the words of the data model (and of the installed modules). */
export const describeTrigger = (trigger: WorkflowTrigger, index: SchemaIndex, modules: ModuleLabel[] = []): string => {
  const label = (objectId: string) => index.objectsById.get(objectId)?.labelSingular.toLowerCase() ?? objectId;

  switch (trigger.kind) {
    case 'event':
      return `When ${moduleLabel(modules, trigger.moduleId) ?? 'a module'} sends ${describeEventTypes(trigger.types)}`;
    case 'record_event': {
      const fields = (trigger.fieldIds ?? []).map((fieldId) => index.fieldsById.get(fieldId)?.label ?? fieldId);
      let text = `When ${withArticle(label(trigger.objectId))} is ${joinWords(trigger.types.map((type) => EVENT_LABEL[type]))}`;

      if (fields.length > 0) {
        text += ` and ${joinWords(fields)} changes`;
      }

      if (trigger.condition) {
        text += ', if it matches a condition';
      }

      return text;
    }
    case 'task_event': {
      let text = `When a task is ${joinWords(trigger.types.map((type) => TASK_EVENT_LABEL[type]))}`;

      if (trigger.statuses && trigger.types.includes('status_changed')) {
        text += ` (${joinWords(trigger.statuses.map((status) => TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label.toLowerCase() ?? status))})`;
      }

      if (trigger.condition) {
        text += ', if it matches a condition';
      }

      return text;
    }
    case 'manual':
      return `Run by hand on ${withArticle(label(trigger.objectId))}`;
    case 'schedule': {
      let text = describeInterval(trigger.everyMinutes);

      if (trigger.objectId) {
        text += ` for each ${label(trigger.objectId)}${trigger.condition ? ' matching a condition' : ''}`;
      }

      return text;
    }
    default:
      return '';
  }
};

const describeRun = (run: WorkflowRun, index: SchemaIndex, modules: ModuleLabel[] = []): string => {
  const object = run.trigger.objectId
    ? (index.objectsById.get(run.trigger.objectId)?.labelSingular ?? run.trigger.objectId)
    : undefined;

  switch (run.trigger.kind) {
    case 'record_event':
      return `${object ?? 'Record'} ${EVENT_LABEL[run.trigger.eventType as RecordEventType] ?? 'changed'}`;
    case 'task_event':
      return `Task ${TASK_EVENT_LABEL[run.trigger.eventType as keyof typeof TASK_EVENT_LABEL] ?? 'changed'}`;
    case 'event':
      return `${moduleLabel(modules, run.trigger.moduleId) ?? 'A module'} sent ${run.trigger.eventType ?? 'an event'}`;
    case 'manual':
      return object ? `Run by hand on ${withArticle(object.toLowerCase())}` : 'Run by hand';
    case 'schedule':
      return object ? `Scheduled, for ${withArticle(object.toLowerCase())}` : 'Scheduled';
    default:
      return '';
  }
};

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

const STATUS: Record<WorkflowRunStep['status'] | WorkflowRun['status'], { label: string; dot: string }> = {
  succeeded: { label: 'Succeeded', dot: 'bg-success' },
  failed: { label: 'Failed', dot: 'bg-destructive' },
  skipped: { label: 'Skipped', dot: 'border border-muted-foreground bg-card' },
};

/** Why a step did what it did: its error, the reason it was skipped, or the lane a branch took. */
const stepReason = (step: WorkflowRunStep): string | undefined => {
  const output = step.output && typeof step.output === 'object' ? (step.output as Record<string, unknown>) : undefined;

  if (step.error) {
    return step.error;
  }

  if (output && 'reason' in output) {
    return String(output.reason);
  }

  if (step.kind === 'branch' && output && 'matched' in output) {
    return `took the ${output.matched ? 'Yes' : 'No'} lane`;
  }

  return undefined;
};

/** "<1s", "1.2s", "2m 5s": how long a run took. */
const duration = (run: WorkflowRun): string => {
  const ms = Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());

  if (ms < 1000) {
    return '<1s';
  }

  const seconds = ms / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

/** The heading of a day's runs: "Today", "Yesterday", "Mon 12 Oct". */
const dayLabel = (date: Date): string =>
  isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'EEE d MMM');

/** One run: how it went, what started it and how long it took; opened, what every step did. */
function RunRow({
  run,
  workflow,
  index,
  modules,
}: {
  run: WorkflowRun;
  workflow: Workflow;
  index: SchemaIndex;
  modules: ModuleLabel[];
}) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const retry = useRetryWorkflowRun();
  const [open, setOpen] = useState(false);
  const failed = run.status === 'failed';
  const object = run.trigger.objectId ? index.objectsById.get(run.trigger.objectId) : undefined;
  const steps = `${run.steps.length} ${run.steps.length === 1 ? 'step' : 'steps'}`;

  return (
    <li className="border-b border-border last:border-b-0" data-slot="workflow-run" data-status={run.status}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-background-hover/50"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          name={failed ? 'circle-x' : 'circle-check'}
          weight="fill"
          aria-label={STATUS[run.status].label}
          className={cn('mt-0.5 size-4 shrink-0', failed ? 'text-destructive' : 'text-success')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{describeRun(run, index, modules)}</span>
          <span
            className={cn('mt-0.5 block text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}
            title={run.error ?? undefined}
          >
            {failed && run.error ? <span className="line-clamp-2">{run.error}</span> : `${steps} · ${duration(run)}`}
          </span>
        </span>
        <time
          dateTime={run.finishedAt}
          title={format(new Date(run.finishedAt), 'PPpp')}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {format(new Date(run.finishedAt), 'HH:mm')}
        </time>
        <Icon
          name="chevron-down"
          className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-4 px-5 pb-4 pl-12">
          <ol className="flex flex-col gap-3 border-l border-border pl-4">
            {run.steps.map((step, i) => {
              const reason = stepReason(step);

              return (
                <li key={step.id} className="relative text-xs">
                  <span
                    className={cn(
                      'absolute top-1.5 -left-[1.3125rem] size-2 rounded-full ring-2 ring-card',
                      STATUS[step.status].dot,
                    )}
                  />
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 font-medium">{step.label ?? ranStepLabel(step)}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {STATUS[step.status].label}
                    </span>
                  </div>
                  {reason ? (
                    <p
                      className={cn(
                        'mt-0.5 pl-4 text-xs break-words',
                        step.error ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {reason}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {run.steps.length === 0 ? <li className="text-xs text-muted-foreground">No steps ran.</li> : null}
          </ol>
          {(object && run.trigger.recordId) || failed ? (
            <div className="flex flex-wrap gap-2">
              {object && run.trigger.recordId ? (
                <navigation.Link
                  href={links.record(slug, object.nameSingular, run.trigger.recordId)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <Icon name="external-link" className="size-3.5" />
                  Open the {object.labelSingular.toLowerCase()}
                </navigation.Link>
              ) : null}
              {failed ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ workflow, runId: run.id })}
                >
                  <Icon name="rotate-ccw" /> Retry
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** One figure of the strip under a workflow's title: what it counts, then the number. */
function SheetStat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-5 py-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-xs font-medium tabular-nums', tone === 'bad' && 'text-destructive')}>{value}</dd>
    </div>
  );
}

/** A workflow's run history, beside the list: what started each run, how it went and what every step did. */
function WorkflowRunsSheet({
  workflow,
  health,
  period,
  open,
  onOpenChange,
}: {
  workflow: Workflow | null;
  health: WorkflowHealth | undefined;
  period: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { index, schema } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const runs = useWorkflowRuns(workflow?.id ?? null);
  const [only, setOnly] = useState<'all' | 'failed'>('all');
  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const failedCount = items.filter((run) => run.status === 'failed').length;
  // Back to every run when a failed-only view has nothing left to show.
  const shown = only === 'failed' && failedCount > 0 ? items.filter((run) => run.status === 'failed') : items;
  const days = shown.reduce<{ key: string; label: string; runs: WorkflowRun[] }[]>((groups, run) => {
    const date = new Date(run.finishedAt);
    const key = format(date, 'yyyy-MM-dd');
    const last = groups[groups.length - 1];

    if (last?.key === key) {
      last.runs.push(run);
    } else {
      groups.push({ key, label: dayLabel(date), runs: [run] });
    }

    return groups;
  }, []);
  const kind = workflow ? triggerKind(workflow.trigger.kind) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg" data-slot="workflow-runs">
        {workflow && kind ? (
          <>
            <SheetHeader className="gap-0 border-b border-border p-0">
              <div className="flex items-start gap-3 p-5 pr-12">
                <Icon name={kind.icon} className="mt-1.5 size-[18px] shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <SheetTitle className="text-sm leading-7 font-medium">{workflow.title}</SheetTitle>
                  <SheetDescription className="mt-0.5">
                    {describeTrigger(workflow.trigger, index, schema.modules)}
                  </SheetDescription>
                </div>
              </div>
              <dl className="grid grid-cols-3 divide-x divide-border border-t border-border">
                <SheetStat label={`Runs, ${period.toLowerCase()}`} value={String(health?.runs ?? 0)} />
                <SheetStat
                  label="Failed"
                  value={String(health?.failed ?? 0)}
                  tone={(health?.failed ?? 0) > 0 ? 'bad' : undefined}
                />
                <SheetStat label="Last run" value={workflow.lastRunAt ? ago(workflow.lastRunAt) : 'Never'} />
              </dl>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {runs.isPending ? (
                <p className="p-5 text-xs text-muted-foreground">Loading runs…</p>
              ) : items.length === 0 ? (
                <p className="p-5 text-xs text-muted-foreground">
                  No runs yet. {workflow.enabled ? 'It runs when its trigger fires.' : 'It is off.'}
                </p>
              ) : (
                <>
                  {failedCount > 0 ? (
                    <fieldset className="flex items-center gap-1 px-5 py-3">
                      <legend className="sr-only">Show</legend>
                      {(
                        [
                          ['all', 'All', items.length],
                          ['failed', 'Failed', failedCount],
                        ] as const
                      ).map(([value, label, count]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={only === value}
                          data-active={only === value || undefined}
                          className={pillTabClassName}
                          onClick={() => setOnly(value)}
                        >
                          {label}{' '}
                          <span
                            className={cn(
                              'tabular-nums',
                              value === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            {count}
                          </span>
                        </button>
                      ))}
                    </fieldset>
                  ) : null}
                  {days.map((day) => (
                    <section key={day.key} className="shrink-0">
                      <h3 className="border-y border-border bg-muted/40 px-5 py-1.5 text-xs font-medium text-muted-foreground first:border-t-0">
                        {day.label}
                      </h3>
                      <ul aria-label={`${workflow.title} runs, ${day.label}`}>
                        {day.runs.map((run) => (
                          <RunRow key={run.id} run={run} workflow={workflow} index={index} modules={schema.modules} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </>
              )}
              {runs.hasNextPage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="my-3 shrink-0 self-center"
                  disabled={runs.isFetchingNextPage}
                  onClick={() => void runs.fetchNextPage()}
                >
                  Load more
                </Button>
              ) : null}
            </div>
            <SheetFooter className="flex-row justify-end border-t border-border p-4">
              <Button variant="outline" onClick={() => navigation.navigate(links.workflowEditor(slug, workflow.id))}>
                <Icon name="pencil" /> Edit workflow
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

/** How the last run went, and for a schedule when the next one is due. */
function LastRun({ workflow, health }: { workflow: Workflow; health: WorkflowHealth | undefined }) {
  const failed = health?.lastStatus === 'failed';
  const next =
    workflow.enabled && workflow.trigger.kind === 'schedule' && workflow.nextRunAt
      ? `next ${due(workflow.nextRunAt)}`
      : null;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {!workflow.lastRunAt ? (
        <span className="text-muted-foreground">Never run</span>
      ) : failed ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-destructive" title={health?.lastError}>
          <Icon name="circle-x" weight="fill" className="size-3.5 shrink-0" />
          <span className="truncate">Failed {ago(workflow.lastRunAt)}</span>
        </span>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate">Ran {ago(workflow.lastRunAt)}</span>
        </span>
      )}
      {next ? <span className="truncate text-muted-foreground">· {next}</span> : null}
    </div>
  );
}

/** The table's columns from `md` up: the workflow, when it runs, its last run, its runs, the switch, the actions. */
const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto_auto] md:grid-cols-[minmax(13rem,22rem)_minmax(0,1fr)_minmax(10rem,17rem)_6.5rem_2.5rem_6rem]';

/** One workflow as a thin row. Its name opens the editor from anywhere on the row; the controls sit over that. */
function WorkflowRow({
  workflow,
  health,
  onOpenRuns,
  onDelete,
}: {
  workflow: Workflow;
  health: WorkflowHealth | undefined;
  onOpenRuns: () => void;
  onDelete: () => void;
}) {
  const { index, schema } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const save = useSaveWorkflow();
  const kind = triggerKind(workflow.trigger.kind);
  const editorHref = links.workflowEditor(slug, workflow.id);
  const when = describeTrigger(workflow.trigger, index, schema.modules);
  const toggle = async (enabled: boolean) => {
    try {
      await save.mutateAsync({ id: workflow.id, input: { title: workflow.title, enabled } });
      toast.success(enabled ? `${workflow.title} is on` : `${workflow.title} is off`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <li
      className={cn(
        'group/row relative grid min-h-12 items-center gap-x-4 border-b border-border px-4 py-2 text-xs last:border-b-0 hover:bg-background-hover/50',
        COLUMNS,
      )}
      data-slot="workflow-row"
      data-workflow={workflow.id}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon name={kind.icon} className="size-[18px] shrink-0 text-muted-foreground" />
        <navigation.Link
          href={editorHref}
          className={cn(
            'block min-w-0 truncate font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:underline',
            !workflow.enabled && 'text-muted-foreground',
          )}
        >
          {workflow.title}
        </navigation.Link>
      </div>
      <p className="hidden min-w-0 truncate text-muted-foreground md:block" title={when}>
        {when}
      </p>
      <div className="hidden md:block">
        <LastRun workflow={workflow} health={health} />
      </div>
      <div className="hidden text-muted-foreground tabular-nums md:block">{health ? health.runs : '–'}</div>
      <div className="relative z-10 flex justify-end">
        <Switch
          size="sm"
          aria-label={`${workflow.title} enabled`}
          checked={workflow.enabled}
          disabled={save.isPending}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      </div>
      <div className="relative z-10 flex items-center justify-end gap-1">
        <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={onOpenRuns}>
          Runs
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${workflow.title}`}
                className="text-muted-foreground"
              />
            }
          >
            <Icon name="more-horizontal" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => navigation.navigate(editorHref)}>
              <Icon name="pencil" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Icon name="trash-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** The first-run view: no workflows yet, and the four things one can start from, each a way into the editor. */
function WorkflowsEmpty({ onCreate, onStart }: { onCreate: () => void; onStart: (kind: WorkflowTriggerKind) => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl" data-slot="workflows-empty">
      <EmptyState
        icon="workflow"
        title="No workflows yet"
        description="A workflow does something for you whenever its trigger fires, such as creating a task when a deal is won."
        action={
          <Button onClick={onCreate}>
            <Icon name="plus" /> New workflow
          </Button>
        }
      />
      <section className="mt-2">
        <h2 className="pb-2 text-xs font-medium text-muted-foreground">Or start from what sets it off</h2>
        <ul className="flex flex-col gap-0.5 rounded-lg border border-border p-1" aria-label="What starts a workflow">
          {TRIGGER_KINDS.map((kind) => (
            <li key={kind.value}>
              <button
                type="button"
                className="group/kind flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => onStart(kind.value)}
              >
                <Icon name={kind.icon} className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{kind.label}</span>
                  <span className="block text-xs text-muted-foreground">{kind.hint}</span>
                </span>
                <Icon
                  name="chevron-right"
                  className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover/kind:text-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Show = 'all' | 'on' | 'off' | 'failing';

const SHOW: { value: Show; label: string; none: string }[] = [
  { value: 'all', label: 'All', none: 'No workflows yet.' },
  { value: 'on', label: 'On', none: 'Every workflow is off.' },
  { value: 'off', label: 'Off', none: 'Every workflow is on.' },
  { value: 'failing', label: 'Failing', none: 'No workflow failed on its last run.' },
];

/** The body of the Workflows page: the runs over time, then every workflow as a thin row, its runs a click away. */
export function WorkflowsList() {
  const workflows = useWorkflows();
  const remove = useDeleteWorkflow();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const [range, setRange] = useState<ActivityRange>('7d');
  const period = activityRange(range);
  const activity = useWorkflowActivity(period.days);
  const [show, setShow] = useState<Show>('all');
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [runsOf, setRunsOf] = useState<Workflow | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const items = workflows.data ?? [];
  const create = () => navigation.navigate(links.workflowEditor(slug));
  const start = (kind: WorkflowTriggerKind) => navigation.navigate(links.workflowEditor(slug, undefined, kind));
  const openRuns = (workflow: Workflow) => {
    setRunsOf(workflow);
    setRunsOpen(true);
  };
  const health = new Map((activity.data?.workflows ?? []).map((entry) => [entry.workflowId, entry]));
  const matches = (workflow: Workflow, value: Show) =>
    value === 'all' ||
    (value === 'on' && workflow.enabled) ||
    (value === 'off' && !workflow.enabled) ||
    (value === 'failing' && health.get(workflow.id)?.lastStatus === 'failed');
  const shown = items.filter((workflow) => matches(workflow, show));
  // The sheet shows the workflow as the list has it now, so switching it on or off shows there too.
  const runsWorkflow = runsOf ? (items.find((workflow) => workflow.id === runsOf.id) ?? runsOf) : null;

  return (
    <div
      className={cn(
        'flex flex-col gap-5',
        // Nothing to list: the first-run view sits in the page's gutters.
        workflows.isSuccess && items.length === 0 && 'px-4',
      )}
    >
      {workflows.isError ? (
        <p className="px-4 text-xs text-destructive">{errorMessage(workflows.error)}</p>
      ) : workflows.isPending ? null : items.length === 0 ? (
        <WorkflowsEmpty onCreate={create} onStart={start} />
      ) : (
        <>
          <div className="px-4">
            <WorkflowActivityCard activity={activity.data} range={range} onRangeChange={setRange} />
          </div>
          <fieldset className="flex min-w-0 flex-wrap items-center gap-1 px-4">
            <legend className="sr-only">Show</legend>
            {SHOW.map((option) => {
              const count = items.filter((workflow) => matches(workflow, option.value)).length;
              const selected = show === option.value;

              if (option.value === 'failing' && count === 0 && !selected) {
                return null;
              }

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  data-active={selected || undefined}
                  className={cn(pillTabClassName, 'h-8 px-3.5 text-[13px]')}
                  onClick={() => setShow(option.value)}
                >
                  {option.label}{' '}
                  <span
                    className={cn(
                      'tabular-nums',
                      option.value === 'failing' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </fieldset>
          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              {SHOW.find((option) => option.value === show)?.none}
            </p>
          ) : (
            <div className="border-y border-border" data-slot="workflows-table">
              <div
                className={cn(
                  'hidden h-9 items-center gap-x-4 border-b border-border px-4 text-xs font-medium text-muted-foreground md:grid',
                  COLUMNS,
                )}
              >
                <div>Workflow</div>
                <div>When</div>
                <div>Last run</div>
                <div>Runs ({period.label})</div>
                <div>On</div>
                <div />
              </div>
              <ul aria-label="Workflows">
                {shown.map((workflow) => (
                  <WorkflowRow
                    key={workflow.id}
                    workflow={workflow}
                    health={health.get(workflow.id)}
                    onOpenRuns={() => openRuns(workflow)}
                    onDelete={() => setDeleting(workflow)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <WorkflowRunsSheet
        workflow={runsWorkflow}
        health={runsWorkflow ? health.get(runsWorkflow.id) : undefined}
        period={period.period}
        open={runsOpen}
        onOpenChange={setRunsOpen}
      />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its runs are removed too. Records it created or changed stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const workflow = deleting;
                setDeleting(null);

                if (workflow) {
                  remove.mutate(workflow.id);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
