import {
  ACTIONS,
  type ActionField,
  ANY_EVENT,
  CONNECTION_ID_INPUT,
  coreIds,
  type FieldMetadata,
  fieldIdOf,
  fieldNameOf,
  fieldOf,
  findStep,
  flattenSteps,
  keyOfId,
  mapFilterFields,
  ownerOfId,
  type RecordEventType,
  type SchemaIndex,
  stepLimitsProblem,
  TASK_EVENT_TYPES,
  TASK_FILTER_FIELDS,
  TASK_STATUS_OPTIONS,
  type TaskStatus,
  TRIGGER_RECORD_ID,
  triggerObjectIdOf,
  WORKFLOW_SCHEDULE_MAX_MINUTES,
  type Workflow,
  type WorkflowInput,
  type WorkflowStepInput,
  type WorkflowTrigger,
  type WorkflowTriggerKind,
  workflowCanRun,
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
  BrandMark,
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Icon,
  type IconName,
  Input,
  Label,
  OptionSelect,
  Separator,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@devias/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { optionsOf } from '../../fields/shared';
import { connectionName, type RuntimeModule, useRuntimeModules } from '../../hooks/use-module-connections';
import { errorMessage } from '../../hooks/use-mutations';
import { useSaveWorkflow, useWorkflows } from '../../hooks/use-workflows';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useSchema } from '../../providers/schema';
import { roleSatisfies, useWorkspace } from '../../providers/workspace';
import { getFieldType, useFieldTypes } from '../../registries';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { PageSkeleton } from '../../shell/skeletons';
import { chipsOf, describeCondition, type FilterChip, filterOfChips } from '../../views/filters';
import { AddFilterButton, FilterBar } from '../../views/toolbar/filter-bar';
import { moduleIcon } from '../settings/sections/module-runtime';
import {
  type CanvasSelection,
  type CanvasStepView,
  NODE_TONE,
  type StepKindOption,
  WorkflowCanvas,
} from './workflow-canvas';
import {
  describeTrigger,
  EVENT_LABEL,
  presetOf,
  STEP_PRESETS,
  type StepPreset,
  stepPreset,
  TASK_EVENT_LABEL,
  TRIGGER_KINDS,
  triggerKind,
} from './workflow-list';
import { type InsertAt, insertStep, removeStep, replaceStep } from './workflow-tree';

/**
 * The workflow editor: a screen of its own under Workflows (`/workflows/new` and `/workflows/:id`). The canvas draws the flow, the panel beside it edits the selected node, and the
 * whole thing takes the viewport over, like the invoice composer.
 */

let stepCounter = 0;
const newStepId = () => {
  stepCounter += 1;

  return `step-${Date.now().toString(36)}-${stepCounter}`;
};

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

const TEMPLATE = /\{\{[^}]*\}\}/;

/** Text from an input to the value a field expects; templates stay text. */
const parseValue = (field: FieldMetadata | undefined, text: string): unknown => {
  if (TEMPLATE.test(text)) {
    return text;
  }

  const trimmed = text.trim();

  if (trimmed === '') {
    return null;
  }

  switch (field?.type) {
    case 'number':
    case 'money':
    case 'rating': {
      const number = Number(trimmed);

      return Number.isFinite(number) ? number : text;
    }
    case 'multi_select':
      return trimmed
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    case 'json':
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    default:
      return text;
  }
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }

  return JSON.stringify(value);
};

/** Field → value rows for a step; the value can be a literal or a `{{template}}`. */
function ValuesEditor({
  fields,
  values,
  onChange,
}: {
  fields: FieldMetadata[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const used = new Set(Object.keys(values));
  const remaining = fields.filter((field) => !used.has(field.name));
  const set = (name: string, value: unknown) => onChange({ ...values, [name]: value });
  const remove = (name: string) => {
    const next = { ...values };
    delete next[name];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {Object.entries(values).map(([name, value]) => {
        const field = fields.find((candidate) => candidate.name === name);
        const options = field ? optionsOf(field.settings) : [];
        const templated = typeof value === 'string' && TEMPLATE.test(value);

        return (
          <div key={name} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-muted-foreground" title={name}>
                {field?.label ?? name}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${field?.label ?? name}`}
                className="-my-1 -mr-1 text-muted-foreground"
                onClick={() => remove(name)}
              >
                <Icon name="x" />
              </Button>
            </div>
            {field?.type === 'boolean' && !templated ? (
              <OptionSelect
                className="w-full"
                aria-label={`${field.label} value`}
                value={value === true ? 'true' : value === false ? 'false' : ''}
                onValueChange={(next) => set(name, next === '' ? null : next === 'true')}
                options={[
                  { value: '', label: 'Empty' },
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ]}
              />
            ) : field?.type === 'select' && options.length > 0 && !templated ? (
              <OptionSelect
                className="w-full"
                aria-label={`${field.label} value`}
                value={typeof value === 'string' ? value : ''}
                onValueChange={(next) => set(name, next === '' ? null : next)}
                options={[{ value: '', label: 'Empty' }, ...options.map((o) => ({ value: o.value, label: o.label }))]}
              />
            ) : (
              <Input
                aria-label={`${field?.label ?? name} value`}
                placeholder="Value or {{record.field}}"
                value={displayValue(value)}
                onChange={(e) => set(name, parseValue(field, e.target.value))}
              />
            )}
          </div>
        );
      })}
      {remaining.length > 0 ? (
        <OptionSelect
          className="w-full"
          aria-label="Add a field"
          placeholder={Object.keys(values).length === 0 ? 'Pick a field to set…' : 'Set another field…'}
          value={null}
          onValueChange={(name) => set(name, null)}
          options={remaining.map((field) => ({ value: field.name, label: field.label }))}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Action input: one control per field the action declares
// ---------------------------------------------------------------------------------------------

/** Text from an input to the value an action field expects; templates and empty values pass through. */
const parseActionValue = (field: ActionField, text: string): unknown => {
  if (text === '') {
    return undefined;
  }

  if (TEMPLATE.test(text)) {
    return text;
  }

  switch (field.type) {
    case 'number': {
      const number = Number(text.trim());

      return Number.isFinite(number) && text.trim() !== '' ? number : text;
    }
    case 'json':
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    default:
      return text;
  }
};

const displayActionValue = (field: ActionField, value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return field.type === 'json' ? JSON.stringify(value, null, 2) : JSON.stringify(value);
};

function ActionInputEditor({
  fields,
  input,
  onChange,
}: {
  fields: ActionField[];
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const set = (key: string, value: unknown) => {
    const next = { ...input };

    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }

    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3" data-slot="action-input">
      {fields.map((field) => {
        const id = `step-input-${field.name}`;
        const value = input[field.name];
        const templated = typeof value === 'string' && TEMPLATE.test(value);
        const label = (
          <FieldLabel htmlFor={id}>
            {field.label}
            {field.required ? null : <span className="ml-1 text-xs text-muted-foreground">optional</span>}
          </FieldLabel>
        );
        const help = field.help ? <FieldDescription>{field.help}</FieldDescription> : null;

        if (field.type === 'boolean' && !templated) {
          return (
            <Field key={field.name}>
              {label}
              <OptionSelect
                id={id}
                className="w-full"
                value={value === true ? 'true' : value === false ? 'false' : ''}
                onValueChange={(next) => set(field.name, next === '' ? undefined : next === 'true')}
                options={[
                  { value: '', label: 'Empty' },
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ]}
              />
              {help}
            </Field>
          );
        }

        if (field.type === 'long_text' || field.type === 'json') {
          return (
            <Field key={field.name}>
              {label}
              <Textarea
                id={id}
                rows={field.type === 'json' ? 3 : 4}
                className={field.type === 'json' ? 'font-mono text-xs' : undefined}
                placeholder={
                  field.placeholder ?? (field.type === 'json' ? '{"key": "{{record.id}}"}' : 'Text or {{record.field}}')
                }
                value={displayActionValue(field, value)}
                onChange={(e) => set(field.name, parseActionValue(field, e.target.value))}
              />
              {help}
            </Field>
          );
        }

        return (
          <Field key={field.name}>
            {label}
            <Input
              id={id}
              placeholder={
                field.placeholder ?? (field.type === 'record' ? '{{record.id}}' : 'Value or {{record.field}}')
              }
              value={displayActionValue(field, value)}
              onChange={(e) => set(field.name, parseActionValue(field, e.target.value))}
            />
            {help}
          </Field>
        );
      })}
    </div>
  );
}

/** Core's actions a step may run: those a workflow's own permissions allow. */
const RUNNABLE_ACTIONS = ACTIONS.filter((spec) => workflowCanRun(spec));

/** A core action's input as JSON (templates welcome), checked when it loses focus. */
function JsonInputEditor({
  keys,
  input,
  onChange,
}: {
  keys: string[];
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(input, null, 2));
  const [invalid, setInvalid] = useState(false);
  const commit = (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value || '{}');

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }

      setInvalid(false);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor="step-input">Input</FieldLabel>
      <Textarea
        id="step-input"
        className="min-h-28 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
      {invalid ? <FieldError>Write the input as a JSON object.</FieldError> : null}
      <FieldDescription>
        Keys: {keys.join(', ') || 'none'}. Values may use templates such as{' '}
        <code className="font-mono text-xs">{'{{record.id}}'}</code>.
      </FieldDescription>
    </Field>
  );
}

const DEFAULT_CONNECTION = '__default';

/**
 * Which of a module's connections an action step uses. A workflow acts for no one, so it uses a workspace
 * connection: the module's own choice by default, or the one picked here (stored as the step's `connectionId`).
 */
function ConnectionPicker({
  step,
  item,
  onChange,
}: {
  step: Extract<WorkflowStepInput, { kind: 'action' }>;
  item: RuntimeModule;
  onChange: (step: WorkflowStepInput) => void;
}) {
  const workspace = item.connections.filter((connection) => connection.visibility === 'workspace');
  const chosen = step.input[CONNECTION_ID_INPUT];
  const pick = (value: string) => {
    const { [CONNECTION_ID_INPUT]: _, ...input } = step.input;
    onChange({ ...step, input: value === DEFAULT_CONNECTION ? input : { ...input, [CONNECTION_ID_INPUT]: value } });
  };

  return (
    <Field>
      <FieldLabel htmlFor="step-connection">Connection</FieldLabel>
      <OptionSelect
        id="step-connection"
        className="w-full"
        value={typeof chosen === 'string' ? chosen : DEFAULT_CONNECTION}
        onValueChange={pick}
        options={[
          { value: DEFAULT_CONNECTION, label: "The workspace's" },
          ...workspace.map((connection) => ({ value: connection.id, label: connectionName(connection) })),
        ]}
      />
      {workspace.length === 0 ? (
        <FieldDescription className="text-warning">
          Connect {item.module.name} for the workspace (Settings → Modules) before this runs.
        </FieldDescription>
      ) : workspace.some((connection) => connection.status === 'auth_failed') ? (
        <FieldDescription className="text-warning">
          {item.module.name} refused a connection; reconnect it in Settings → Modules.
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * A "Run an action" step: one picker for every action a workflow may run, core's and the installed modules', then
 * the fields a module declares for its action, or a core action's input as JSON.
 */
function ActionStepFields({
  step,
  modules,
  onChange,
}: {
  step: Extract<WorkflowStepInput, { kind: 'action' }>;
  modules: RuntimeModule[];
  onChange: (step: WorkflowStepInput) => void;
}) {
  const withActions = modules.filter((item) => item.module.actions.length > 0);
  const options = [
    ...RUNNABLE_ACTIONS.map((spec) => ({ value: spec.id, label: spec.summary, icon: 'zap' as IconName })),
    ...withActions.flatMap((item) =>
      item.module.actions.map((action) => ({
        value: action.id,
        label: `${action.label} · ${item.module.name}`,
        icon: moduleIcon(item.module),
      })),
    ),
  ];
  const core = ACTIONS.find((spec) => spec.id === step.actionId);
  const item = core ? undefined : withActions.find((c) => c.module.moduleId === ownerOfId(step.actionId));
  const declared = item?.module.actions.find((candidate) => candidate.id === step.actionId);
  const description = declared?.description ?? core?.description;

  return (
    <>
      <Field>
        <FieldLabel htmlFor="step-action">Action</FieldLabel>
        <OptionSelect
          id="step-action"
          className="w-full"
          value={step.actionId}
          placeholder="Pick an action…"
          onValueChange={(action) => onChange({ ...step, actionId: action, input: {} })}
          options={options}
        />
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </Field>
      {item && item.module.connections.length > 0 ? (
        <ConnectionPicker step={step} item={item} onChange={onChange} />
      ) : null}
      {declared ? (
        <ActionInputEditor
          fields={declared.input}
          input={step.input}
          onChange={(input) => onChange({ ...step, input })}
        />
      ) : null}
      {core ? (
        <JsonInputEditor
          key={step.actionId}
          keys={Object.keys(core.input.shape)}
          input={step.input}
          onChange={(input) => onChange({ ...step, input })}
        />
      ) : null}
      {declared && declared.output.length > 0 ? (
        <FieldDescription>
          Later steps can use what it returns:
          <ul className="mt-1 flex flex-col gap-0.5" data-slot="action-output">
            {declared.output.map((field) => (
              <li key={field.name}>
                <code className="font-mono text-xs">{`{{steps.${step.id ?? '<id>'}.${field.name}}}`}</code>
                {field.description ? `: ${field.description}` : ''}
              </li>
            ))}
          </ul>
        </FieldDescription>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------

/**
 * What the panel beside the canvas wraps every editor in: a header that says which node is open (the same icon chip
 * as on the canvas), and a body that scrolls on its own.
 */
function PanelShell({
  icon,
  tone,
  eyebrow,
  title,
  actions,
  children,
  slot,
}: {
  icon: IconName;
  tone: keyof typeof NODE_TONE;
  eyebrow: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  slot: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot={slot}>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', NODE_TONE[tone])}>
          <Icon name={icon} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[10.5px] leading-none font-medium tracking-wider text-muted-foreground uppercase">
            {eyebrow}
          </span>
          <h2 className="truncate text-xs leading-tight font-medium">{title}</h2>
        </div>
        {actions}
      </header>
      <FieldGroup className="min-h-0 flex-1 gap-5 overflow-y-auto p-4">{children}</FieldGroup>
    </div>
  );
}

/** A group of related controls under a quiet heading. */
function PanelSection({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const defaultTrigger = (kind: WorkflowTriggerKind, object: string, module = ''): WorkflowTrigger => {
  switch (kind) {
    case 'record_event':
      return { kind, objectId: object, types: ['record.created'] };
    case 'manual':
      return { kind, objectId: object };
    case 'event':
      return { kind, moduleId: module, types: [ANY_EVENT] };
    case 'task_event':
      return { kind, types: ['created'] };
    default:
      return { kind: 'schedule', everyMinutes: 60 };
  }
};

function TriggerEditor({
  trigger,
  onChange,
  index,
  modules,
}: {
  trigger: WorkflowTrigger;
  onChange: (trigger: WorkflowTrigger) => void;
  index: SchemaIndex;
  modules: RuntimeModule[];
}) {
  const objects = index.schema.objects;
  const objectOptions = objects.map((o) => ({ value: o.id, label: o.labelSingular, icon: o.icon }));
  const objectId = triggerObjectIdOf(trigger);
  const object = objectId ? index.objectsById.get(objectId) : undefined;
  const taskTrigger = trigger.kind === 'task_event';
  const fields = taskTrigger ? TASK_FILTER_FIELDS : object ? (index.fieldsByObjectId.get(object.id) ?? []) : [];
  /** Modules that deliver events: the only ones an event trigger can pick. */
  const eventSources = modules.filter((item) => item.module.events.length > 0);
  const source =
    trigger.kind === 'event' ? eventSources.find((item) => item.module.moduleId === trigger.moduleId) : undefined;
  const conditionOf = (candidate: WorkflowTrigger) =>
    candidate.kind === 'record_event' || candidate.kind === 'schedule' || candidate.kind === 'task_event'
      ? candidate.condition
      : undefined;
  // The trigger stores its condition with field ids; the filter bar speaks API names. A task has no field ids.
  const triggerCondition = conditionOf(trigger);
  const chips = chipsOf(
    triggerCondition ? mapFilterFields(triggerCondition, (ref) => fieldNameOf(fields, ref)) : undefined,
  );
  const setCondition = (next: ReturnType<typeof filterOfChips>) => {
    if (trigger.kind !== 'record_event' && trigger.kind !== 'schedule' && trigger.kind !== 'task_event') {
      return;
    }

    const { condition: _dropped, ...rest } = trigger;
    onChange(
      next
        ? { ...rest, condition: taskTrigger ? next : mapFilterFields(next, (name) => fieldIdOf(fields, name)) }
        : rest,
    );
  };
  const condition = (
    <PanelSection
      title="Only when"
      hint={
        trigger.kind === 'record_event'
          ? 'Checked on the record after the change (before it, for deletions).'
          : trigger.kind === 'task_event'
            ? 'Checked on the task after the change.'
            : 'Each tick runs the steps once per record that matches.'
      }
    >
      <div className="flex flex-col items-start gap-1.5">
        <FilterBar chips={chips} fields={fields} onChange={(next) => setCondition(filterOfChips(next))} />
        <AddFilterButton
          fields={fields}
          className="-ml-2"
          onAdd={(c) => setCondition(filterOfChips([...chips, { kind: 'condition', condition: c }]))}
        >
          Add condition
        </AddFilterButton>
      </div>
    </PanelSection>
  );
  const kind = triggerKind(trigger.kind);

  return (
    <PanelShell slot="trigger-panel" icon={kind.icon} tone="trigger" eyebrow="Trigger" title={kind.label}>
      <PanelSection title="Start when" hint={kind.hint}>
        <OptionSelect<WorkflowTriggerKind>
          id="wf-trigger"
          aria-label="Trigger"
          className="w-full"
          value={trigger.kind}
          onValueChange={(next) =>
            onChange(defaultTrigger(next, objectId ?? objects[0]?.id ?? '', eventSources[0]?.module.moduleId ?? ''))
          }
          options={TRIGGER_KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))}
        />
      </PanelSection>
      {trigger.kind === 'record_event' ? (
        <>
          <Field>
            <FieldLabel htmlFor="wf-object">Object</FieldLabel>
            <OptionSelect
              id="wf-object"
              className="w-full"
              value={trigger.objectId}
              onValueChange={(object) => onChange({ kind: 'record_event', objectId: object, types: trigger.types })}
              options={objectOptions}
            />
          </Field>
          <Field>
            <FieldLabel>Events</FieldLabel>
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              spacing={1}
              className="w-full"
              aria-label="Events"
              value={trigger.types}
              onValueChange={(types) => onChange({ ...trigger, types: types as RecordEventType[] })}
            >
              {(Object.keys(EVENT_LABEL) as RecordEventType[]).map((type) => (
                <ToggleGroupItem key={type} value={type} className="flex-1">
                  {EVENT_LABEL[type]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {trigger.types.length === 0 ? <FieldError>Pick at least one event</FieldError> : null}
          </Field>
          {trigger.types.includes('record.updated') ? (
            <Field>
              <FieldLabel>Only when these fields change</FieldLabel>
              <ToggleGroup
                multiple
                variant="outline"
                size="sm"
                spacing={1}
                className="max-h-40 w-full flex-wrap justify-start overflow-auto"
                aria-label="Fields to watch"
                value={trigger.fieldIds ?? []}
                onValueChange={(next) => {
                  const { fieldIds: _dropped, ...rest } = trigger;
                  onChange(next.length > 0 ? { ...rest, fieldIds: next } : rest);
                }}
              >
                {fields.map((field) => (
                  <ToggleGroupItem key={field.id} value={field.id}>
                    {field.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>Nothing selected means any change.</FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="wf-on-import">Imported records</FieldLabel>
            <div className="flex items-center gap-2 text-xs">
              <Switch
                id="wf-on-import"
                checked={trigger.onImport === true}
                onCheckedChange={(onImport) => {
                  const { onImport: _dropped, ...rest } = trigger;
                  onChange(onImport ? { ...rest, onImport } : rest);
                }}
              />
              <span className="text-muted-foreground">Also run for records an import writes</span>
            </div>
            <FieldDescription>
              A data load is not a business event, so imports are skipped unless you ask.
            </FieldDescription>
          </Field>
          <Separator />
          {condition}
        </>
      ) : null}
      {trigger.kind === 'task_event' ? (
        <>
          <Field>
            <FieldLabel>Events</FieldLabel>
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              spacing={1}
              className="w-full flex-wrap justify-start"
              aria-label="Events"
              value={trigger.types}
              onValueChange={(types) => {
                const next = types as (typeof TASK_EVENT_TYPES)[number][];
                const { statuses: _dropped, ...rest } = trigger;
                onChange(
                  trigger.statuses && next.includes('status_changed')
                    ? { ...rest, types: next, statuses: trigger.statuses }
                    : { ...rest, types: next },
                );
              }}
            >
              {TASK_EVENT_TYPES.map((type) => (
                <ToggleGroupItem key={type} value={type}>
                  {TASK_EVENT_LABEL[type]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {trigger.types.length === 0 ? <FieldError>Pick at least one event</FieldError> : null}
            <FieldDescription>
              Steps act on the task as <code className="font-mono text-xs">{'{{record.id}}'}</code>,{' '}
              <code className="font-mono text-xs">{'{{record.title}}'}</code> and{' '}
              <code className="font-mono text-xs">{'{{record.status}}'}</code>. Changes made by workflows start nothing.
            </FieldDescription>
          </Field>
          {trigger.types.includes('status_changed') ? (
            <Field>
              <FieldLabel>Only when it moves to</FieldLabel>
              <ToggleGroup
                multiple
                variant="outline"
                size="sm"
                spacing={1}
                className="w-full flex-wrap justify-start"
                aria-label="Statuses"
                value={trigger.statuses ?? []}
                onValueChange={(next) => {
                  const { statuses: _dropped, ...rest } = trigger;
                  onChange(next.length > 0 ? { ...rest, statuses: next as TaskStatus[] } : rest);
                }}
              >
                {TASK_STATUS_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>Nothing selected means any status.</FieldDescription>
            </Field>
          ) : null}
          <Separator />
          {condition}
        </>
      ) : null}
      {trigger.kind === 'manual' ? (
        <Field>
          <FieldLabel htmlFor="wf-object">Object</FieldLabel>
          <OptionSelect
            id="wf-object"
            className="w-full"
            value={trigger.objectId}
            onValueChange={(object) => onChange({ kind: 'manual', objectId: object })}
            options={objectOptions}
          />
          <FieldDescription>People pick a record and run the workflow from its Actions menu.</FieldDescription>
        </Field>
      ) : null}
      {trigger.kind === 'schedule' ? (
        <>
          <Field>
            <FieldLabel htmlFor="wf-every">Every</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="wf-every"
                type="number"
                min={1}
                max={WORKFLOW_SCHEDULE_MAX_MINUTES}
                className="w-28"
                value={trigger.everyMinutes}
                onChange={(e) =>
                  onChange({ ...trigger, everyMinutes: Math.max(1, Math.trunc(Number(e.target.value) || 0)) })
                }
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
            <FieldDescription>
              60 is hourly, 1440 is daily, up to a week. The first run is one interval after saving.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-object">For each</FieldLabel>
            <OptionSelect
              id="wf-object"
              className="w-full"
              value={trigger.objectId ?? ''}
              onValueChange={(object) =>
                onChange(
                  object
                    ? { kind: 'schedule', everyMinutes: trigger.everyMinutes, objectId: object }
                    : { kind: 'schedule', everyMinutes: trigger.everyMinutes },
                )
              }
              options={[{ value: '', label: 'Nothing: run the steps once' }, ...objectOptions]}
            />
          </Field>
          {trigger.objectId ? (
            <>
              <Separator />
              {condition}
            </>
          ) : null}
        </>
      ) : null}
      {trigger.kind === 'event' ? (
        eventSources.length === 0 ? (
          <p className="text-xs text-warning">Install a module that delivers events (Settings → Modules) first.</p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="wf-module">Module</FieldLabel>
              <OptionSelect
                id="wf-module"
                className="w-full"
                value={trigger.moduleId}
                placeholder="Pick a module…"
                onValueChange={(module) => onChange({ kind: 'event', moduleId: module, types: [ANY_EVENT] })}
                options={eventSources.map((item) => ({
                  value: item.module.moduleId,
                  label: item.module.name,
                  icon: moduleIcon(item.module),
                }))}
              />
            </Field>
            <Field>
              <FieldLabel>Events</FieldLabel>
              <div className="flex max-h-72 flex-col divide-y divide-border overflow-auto rounded-lg border border-border">
                <Label className="flex items-center gap-2.5 px-3 py-2 text-xs font-normal">
                  <Checkbox
                    checked={trigger.types.includes(ANY_EVENT)}
                    onCheckedChange={(checked) => onChange({ ...trigger, types: checked ? [ANY_EVENT] : [] })}
                  />
                  Any event
                </Label>
                {(source?.module.events ?? []).map((event) => {
                  const any = trigger.types.includes(ANY_EVENT);

                  return (
                    <Label key={keyOfId(event.id)} className="flex items-start gap-2.5 px-3 py-2 text-xs font-normal">
                      <Checkbox
                        className="mt-0.5"
                        disabled={any}
                        checked={!any && trigger.types.includes(keyOfId(event.id))}
                        onCheckedChange={(checked) =>
                          onChange({
                            ...trigger,
                            types: checked
                              ? [...trigger.types, keyOfId(event.id)]
                              : trigger.types.filter((t) => t !== keyOfId(event.id)),
                          })
                        }
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-xs">{keyOfId(event.id)}</span>
                        {event.description ? (
                          <span className="text-xs text-muted-foreground">{event.description}</span>
                        ) : null}
                      </span>
                    </Label>
                  );
                })}
              </div>
              {trigger.types.length === 0 ? <FieldError>Pick at least one event</FieldError> : null}
              <FieldDescription>
                Steps read the delivery with <code className="font-mono text-xs">{'{{event.type}}'}</code> and{' '}
                <code className="font-mono text-xs">{'{{event.payload.…}}'}</code>. Such a run has no record.
              </FieldDescription>
            </Field>
          </>
        )
      ) : null}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

/** One line saying what a condition tests, in the words of the data model. */
function useConditionWords(fields: FieldMetadata[]) {
  const fieldTypes = useFieldTypes();

  return useCallback(
    (chips: FilterChip[]): string => {
      if (chips.length === 0) {
        return 'always (no condition yet)';
      }

      return chips
        .map((chip) => {
          if (chip.kind === 'advanced') {
            return 'a condition';
          }

          const field = fields.find((candidate) => candidate.name === chip.condition.field);

          return describeCondition(chip.condition, field, field ? getFieldType(fieldTypes, field.type) : undefined);
        })
        .join(' and ');
    },
    [fields, fieldTypes],
  );
}

/** The editor for the selected step, beside the canvas. */
function StepPanel({
  step,
  recordObject,
  taskTrigger,
  index,
  modules,
  kinds,
  onChange,
  onRemove,
  onAddAfter,
}: {
  step: WorkflowStepInput;
  recordObject: string | undefined;
  /** The trigger is a task event: the record is the task, and its conditions name its fields as they are. */
  taskTrigger: boolean;
  index: SchemaIndex;
  modules: RuntimeModule[];
  kinds: StepKindOption[];
  onChange: (step: WorkflowStepInput) => void;
  onRemove: () => void;
  onAddAfter: (preset: StepPreset) => void;
}) {
  const preset = presetOf(step);
  const kind = stepPreset(preset);
  const fieldsFor = (objectName: string | undefined): FieldMetadata[] => {
    const object = objectName ? index.objectsByName.get(objectName) : undefined;

    return object ? (index.fieldsByObjectId.get(object.id) ?? []) : [];
  };
  const objectOptions = index.schema.objects.map((o) => ({
    value: o.nameSingular,
    label: o.labelSingular,
    icon: o.icon,
  }));
  const recordFields = taskTrigger ? TASK_FILTER_FIELDS : fieldsFor(recordObject);
  // A branch stores its condition with field ids; the filter bar speaks API names. A task has no field ids.
  const chips =
    step.kind === 'branch' ? chipsOf(mapFilterFields(step.condition, (ref) => fieldNameOf(recordFields, ref))) : [];
  const idOfField = (name: string) => (taskTrigger ? name : fieldIdOf(recordFields, name));

  return (
    <PanelShell
      slot="step-panel"
      icon={kind.icon}
      tone={step.kind === 'branch' ? 'branch' : 'action'}
      eyebrow={step.kind === 'branch' ? 'Condition' : 'Action'}
      title={kind.label}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove step"
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Icon name="trash-2" />
        </Button>
      }
    >
      <Field>
        <FieldLabel htmlFor="step-name">Name</FieldLabel>
        <Input
          id="step-name"
          placeholder={kind.label}
          value={step.label ?? ''}
          onChange={(e) => onChange({ ...step, label: e.target.value || undefined })}
        />
      </Field>
      {step.kind === 'action' && preset === 'update' ? (
        <Field>
          <FieldLabel>Set fields</FieldLabel>
          {recordObject ? (
            <ValuesEditor
              fields={recordFields}
              values={(step.input.values ?? {}) as Record<string, unknown>}
              onChange={(values) => onChange({ ...step, input: { ...step.input, object: recordObject, values } })}
            />
          ) : (
            <p className="text-xs text-warning">
              This trigger provides no record to update. Pick an object in the trigger.
            </p>
          )}
        </Field>
      ) : null}
      {step.kind === 'action' && preset === 'create' ? (
        <>
          <Field>
            <FieldLabel htmlFor="step-object">Object</FieldLabel>
            <OptionSelect
              id="step-object"
              className="w-full"
              value={String(step.input.object ?? '')}
              onValueChange={(object) => onChange({ ...step, input: { object, values: {} } })}
              options={objectOptions}
            />
          </Field>
          <Field>
            <FieldLabel>Set fields</FieldLabel>
            <ValuesEditor
              fields={fieldsFor(String(step.input.object ?? ''))}
              values={(step.input.values ?? {}) as Record<string, unknown>}
              onChange={(values) => onChange({ ...step, input: { ...step.input, values } })}
            />
          </Field>
        </>
      ) : null}
      {step.kind === 'action' && preset === 'action' ? (
        <ActionStepFields step={step} modules={modules} onChange={onChange} />
      ) : null}
      {step.kind === 'branch' ? (
        <Field>
          <FieldLabel>Take the Yes lane when</FieldLabel>
          {recordObject || taskTrigger ? (
            <div className="flex flex-col items-start gap-1.5">
              <FilterBar
                chips={chips}
                fields={recordFields}
                onChange={(next) => {
                  const condition = filterOfChips(next);
                  onChange({ ...step, condition: condition ? mapFilterFields(condition, idOfField) : { and: [] } });
                }}
              />
              <AddFilterButton
                fields={recordFields}
                className="-ml-2"
                onAdd={(c) => {
                  const condition = filterOfChips([...chips, { kind: 'condition', condition: c }]);
                  onChange({ ...step, condition: condition ? mapFilterFields(condition, idOfField) : { and: [] } });
                }}
              >
                Add condition
              </AddFilterButton>
            </div>
          ) : (
            <p className="text-xs text-warning">A branch tests the record; pick an object in the trigger.</p>
          )}
          <FieldDescription>
            Checked on the record as it is when the branch is reached. Without a condition the Yes lane always runs.
          </FieldDescription>
        </Field>
      ) : null}
      <Separator />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="w-full justify-center" />}>
          <Icon name="plus" className="size-3.5" />{' '}
          {step.kind === 'branch' ? 'Add step after both lanes' : 'Add step after'}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-52">
          {kinds.map((option) => (
            <DropdownMenuItem key={option.value} disabled={option.disabled} onClick={() => onAddAfter(option.value)}>
              <Icon name={option.icon} /> {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------

/** "Update the record" steps update the trigger's record, whatever object the trigger names now. */
const followTrigger = (steps: WorkflowStepInput[], object: string | undefined): WorkflowStepInput[] =>
  steps.map((step) => {
    if (step.kind === 'branch') {
      return { ...step, yes: followTrigger(step.yes, object), no: followTrigger(step.no, object) };
    }

    return object && presetOf(step) === 'update' ? { ...step, input: { ...step.input, object } } : step;
  });

interface FormState {
  name: string;
  description: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  steps: WorkflowStepInput[];
}

const formOf = (existing: Workflow | undefined, firstObjectId: string, start?: WorkflowTriggerKind): FormState => ({
  name: existing?.title ?? '',
  description: existing?.description ?? '',
  enabled: existing?.enabled ?? true,
  trigger: existing?.trigger ?? defaultTrigger(start ?? 'record_event', firstObjectId),
  steps: existing?.steps ?? [],
});

export function WorkflowEditor({ existing }: { existing?: Workflow }) {
  const { schema, index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const save = useSaveWorkflow();
  const firstObject = schema.objects[0]?.nameSingular ?? '';
  const firstObjectId = schema.objects[0]?.id ?? '';
  // `?trigger=schedule` and the like start a new workflow from that kind of trigger.
  const start = TRIGGER_KINDS.find((kind) => kind.value === navigation.search.trigger)?.value;
  const [form, setForm] = useState<FormState>(() => formOf(existing, firstObjectId, start));
  const [saved, setSaved] = useState<string>(() => JSON.stringify(formOf(existing, firstObjectId, start)));
  const [selected, setSelected] = useState<CanvasSelection | null>({ kind: 'trigger' });
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  // The workflow can change underneath the editor, for example when the agent edits it. Take the new version
  // while nothing is unsaved; unsaved changes are kept, and saving them replaces the other version.
  const [version, setVersion] = useState(existing?.updatedAt);
  const [revision, setRevision] = useState(0);

  if (existing && existing.updatedAt !== version) {
    setVersion(existing.updatedAt);

    if (!dirty) {
      const next = formOf(existing, firstObjectId);
      setForm(next);
      setSaved(JSON.stringify(next));
      setRevision((r) => r + 1);
    }
  }

  // The trigger names its object by id; the steps and the pickers below speak API names.
  const recordObjectId = triggerObjectIdOf(form.trigger);
  const recordObject = recordObjectId ? index.objectsById.get(recordObjectId)?.nameSingular : undefined;
  const taskTrigger = form.trigger.kind === 'task_event';
  const recordFields = useMemo(() => {
    if (taskTrigger) {
      return TASK_FILTER_FIELDS;
    }

    const object = recordObject ? index.objectsByName.get(recordObject) : undefined;

    return object ? (index.fieldsByObjectId.get(object.id) ?? []) : [];
  }, [index, recordObject, taskTrigger]);
  const conditionWords = useConditionWords(recordFields);
  const { items: modules } = useRuntimeModules();
  const kinds = useMemo<StepKindOption[]>(
    () =>
      STEP_PRESETS.map((preset) => ({
        ...preset,
        disabled:
          (preset.value === 'update' && !recordObject) || (preset.value === 'branch' && !recordObject && !taskTrigger),
      })),
    [recordObject, taskTrigger],
  );
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Leaving with unsaved changes asks first, in the app and in the browser.
  useEffect(() => {
    if (!dirty) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);

    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const describe = useCallback(
    (step: WorkflowStepInput): CanvasStepView => {
      const preset = presetOf(step);
      const kind = stepPreset(preset);
      const label = (name: string) => index.objectsByName.get(name)?.labelSingular ?? name;
      const fieldLabels = (objectName: string | undefined, values: Record<string, unknown>) => {
        const object = objectName ? index.objectsByName.get(objectName) : undefined;

        return Object.keys(values).map((key) => (object ? (fieldOf(index, object.id, key)?.label ?? key) : key));
      };

      if (step.kind === 'branch') {
        return {
          step,
          title: step.label || kind.label,
          summary: `If ${conditionWords(chipsOf(mapFilterFields(step.condition, (ref) => fieldNameOf(recordFields, ref))))}`,
          icon: kind.icon,
        };
      }

      const values = (step.input.values ?? {}) as Record<string, unknown>;
      let summary: string;

      switch (preset) {
        case 'update': {
          const labels = fieldLabels(recordObject, values);
          summary = labels.length > 0 ? `Sets ${labels.join(', ')}` : 'Sets nothing yet';
          break;
        }
        case 'create':
          summary = `Creates a ${label(String(step.input.object ?? '')).toLowerCase()}`;
          break;
        default: {
          const core = ACTIONS.find((spec) => spec.id === step.actionId);

          if (core) {
            summary = core.summary;
            break;
          }

          const item = modules.find((candidate) => candidate.module.moduleId === ownerOfId(step.actionId));
          const action = item?.module.actions.find((candidate) => candidate.id === step.actionId);

          return {
            step,
            title: step.label || kind.label,
            summary: item && action ? `${action.label} · ${item.module.name}` : 'Pick an action',
            icon: item ? moduleIcon(item.module) : kind.icon,
          };
        }
      }

      return { step, title: step.label || kind.label, summary, icon: kind.icon };
    },
    [index, recordObject, modules, conditionWords, recordFields],
  );
  const addStep = useCallback(
    (at: InsertAt, preset: StepPreset) => {
      const id = newStepId();
      const step: WorkflowStepInput =
        preset === 'update'
          ? {
              id,
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: recordObject ?? '', id: TRIGGER_RECORD_ID, values: {} },
            }
          : preset === 'create'
            ? {
                id,
                kind: 'action',
                actionId: coreIds.actions.create_record,
                input: { object: firstObject, values: {} },
              }
            : preset === 'action'
              ? { id, kind: 'action', actionId: '', input: {} }
              : { id, kind: 'branch', condition: { and: [] }, yes: [], no: [] };
      setForm((f) => ({ ...f, steps: insertStep(f.steps, at, step) }));
      setSelected({ kind: 'step', id });
    },
    [firstObject, recordObject],
  );
  const selectedStep = selected?.kind === 'step' ? findStep(form.steps, selected.id) : undefined;
  const listHref = links.workflows(slug);
  const leave = () => {
    if (dirty) {
      setLeaving(true);
    } else {
      navigation.navigate(listHref);
    }
  };
  const problem = (): string | null => {
    if (!form.name.trim()) {
      return 'Give the workflow a title.';
    }

    if (
      (form.trigger.kind === 'record_event' || form.trigger.kind === 'task_event') &&
      form.trigger.types.length === 0
    ) {
      return 'Pick at least one event.';
    }

    if (form.trigger.kind === 'event') {
      if (!form.trigger.moduleId) {
        return 'Pick a module for the trigger.';
      }

      if (form.trigger.types.length === 0) {
        return 'Pick at least one event.';
      }
    }

    const limits = stepLimitsProblem(form.steps);

    if (limits) {
      return `${limits}.`;
    }

    for (const step of flattenSteps(form.steps)) {
      if (step.kind === 'action' && !step.actionId) {
        return 'Pick an action for every step that runs one.';
      }
    }

    return null;
  };
  const submit = async () => {
    const message = problem();

    if (message) {
      setError(message);

      return;
    }

    const input: WorkflowInput = {
      title: form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      enabled: form.enabled,
      trigger: form.trigger,
      steps: followTrigger(form.steps, recordObject),
    };

    try {
      const result = await save.mutateAsync({
        id: existing?.id,
        input: existing ? { ...input, description: input.description ?? '' } : input,
      });
      setError(null);
      setSaved(JSON.stringify(form));
      toast.success(existing ? 'Workflow saved' : 'Workflow created');

      if (!existing) {
        navigation.navigate(links.workflowEditor(slug, result.id), { replace: true });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const title = existing ? existing.title : 'New workflow';

  return (
    <div data-slot="workflow-editor" className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <h1 className="truncate text-xs font-medium">{title}</h1>
          {dirty ? <span className="shrink-0 text-xs text-muted-foreground">Unsaved changes</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            disabled={save.isPending || (existing !== undefined && !dirty)}
            onClick={() => void submit()}
          >
            {existing ? 'Save' : 'Create'}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Back to workflows" onClick={leave}>
            <Icon name="x" />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <Field>
            <FieldLabel htmlFor="wf-name">Name</FieldLabel>
            <Input
              id="wf-name"
              autoFocus={!existing}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-description">Description</FieldLabel>
            <Input
              id="wf-description"
              placeholder="What this automation is for"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-enabled">Enabled</FieldLabel>
            <div className="flex h-8 items-center">
              <Switch id="wf-enabled" checked={form.enabled} onCheckedChange={(enabled) => set({ enabled })} />
            </div>
          </Field>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-h-[360px] min-w-0 overflow-hidden rounded-lg border border-border">
            <WorkflowCanvas
              steps={form.steps}
              triggerTitle={triggerKind(form.trigger.kind).label}
              triggerSummary={describeTrigger(form.trigger, index, schema.modules)}
              triggerIcon={triggerKind(form.trigger.kind).icon}
              describe={describe}
              kinds={kinds}
              selected={selected}
              onSelect={setSelected}
              onAdd={addStep}
            />
          </div>
          <div
            className="min-h-[360px] min-w-0 overflow-hidden rounded-lg border border-border bg-card"
            data-slot="workflow-panel"
          >
            {selected?.kind === 'trigger' ? (
              <TriggerEditor
                key={revision}
                trigger={form.trigger}
                index={index}
                modules={modules}
                onChange={(trigger) => set({ trigger })}
              />
            ) : selectedStep ? (
              <StepPanel
                key={`${selectedStep.id}:${revision}`}
                step={selectedStep}
                recordObject={recordObject}
                taskTrigger={taskTrigger}
                index={index}
                modules={modules}
                kinds={kinds}
                onChange={(next) => set({ steps: replaceStep(form.steps, selectedStep.id ?? '', next) })}
                onRemove={() => {
                  set({ steps: removeStep(form.steps, selectedStep.id ?? '') });
                  setSelected(null);
                }}
                onAddAfter={(kind) => addStep({ kind: 'after', id: selectedStep.id ?? '' }, kind)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Icon name="sliders-horizontal" className="size-5 text-muted-foreground" />
                <p className="text-xs font-medium">Nothing selected</p>
                <p className="max-w-60 text-xs text-muted-foreground">
                  Select the trigger or a step to edit it. Use the + buttons on the canvas to add steps; "If / else"
                  splits the flow into a Yes lane and a No lane that each end on their own.
                </p>
              </div>
            )}
          </div>
        </div>
        <FieldDescription>
          Values can use templates: <code className="font-mono text-xs">{'{{record.name}}'}</code>,{' '}
          <code className="font-mono text-xs">{'{{today}}'}</code>,{' '}
          <code className="font-mono text-xs">{'{{now}}'}</code>,{' '}
          <code className="font-mono text-xs">{'{{event.payload.…}}'}</code> for module events, or the output of an
          earlier step, such as <code className="font-mono text-xs">{'{{steps.<id>.id}}'}</code>.
        </FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>The changes to this workflow are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setLeaving(false);
                navigation.navigate(listHref);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** `/workflows/new` and `/workflows/:workflowId`. */
export function WorkflowEditorPage() {
  const { params, navigate } = useNavigation();
  const { slug, role, roleStatus } = useWorkspace();
  const workflowId = params.workflowId;
  const workflows = useWorkflows();
  const existing = workflowId ? workflows.data?.find((w) => w.id === workflowId) : undefined;
  useSetBreadcrumbs([
    { label: 'Workflows', href: links.workflows(slug) },
    { label: existing?.title ?? (workflowId ? '…' : 'New workflow') },
  ]);

  if (roleStatus === 'loading') {
    return <PageSkeleton />;
  }

  if (!roleSatisfies(role, 'admin')) {
    return (
      <EmptyState
        icon="lock"
        title="Workflows are for admins"
        description="Ask a workspace admin to make this change or to give you the admin role."
      />
    );
  }

  if (workflowId && !existing) {
    if (workflows.isPending || workflows.isFetching) {
      return <PageSkeleton />;
    }

    return (
      <EmptyState
        icon="circle-help"
        title="Workflow not found"
        description="It may have been deleted."
        action={
          <Button size="lg" variant="outline" onClick={() => navigate(links.workflows(slug))}>
            Back to workflows
          </Button>
        }
      />
    );
  }

  return <WorkflowEditor key={existing?.id ?? 'new'} existing={existing} />;
}
