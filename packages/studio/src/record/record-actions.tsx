import {
  type ActionField,
  evaluateFilter,
  type LayoutAction,
  type ObjectMetadata,
  type RecordData,
  type ResolvedRecordAction,
  recordActionsOf,
} from '@devias/core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Icon,
  Input,
  Textarea,
} from '@devias/ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRunModuleAction } from '../hooks/use-module-connections';
import { useSchema } from '../providers/schema';
import { useRecordPage } from './record-page-context';

/** An installed module's action that a record page offers for this record. */
export interface RecordAction extends ResolvedRecordAction {
  /** What the person fills in first: the action's fields besides the record's id. */
  fields: ActionField[];
}

/**
 * The actions installed modules offer on this record's page: the entries of the layout's `actions` that fit this
 * object (see `recordActionsOf`), for the record's current values.
 */
export const useRecordActions = (
  object: ObjectMetadata,
  record: RecordData | undefined,
  entries: readonly LayoutAction[] | null | undefined,
): RecordAction[] => {
  const { schema } = useSchema();

  if (!record) {
    return [];
  }

  return recordActionsOf(object.id, entries, schema.modules)
    .filter((item) => evaluateFilter(record, item.when))
    .map((item) => ({ ...item, fields: item.action.input.filter((field) => field.name !== item.input) }));
};

type Values = Record<string, string | boolean>;

/** The input an action takes from what was typed: empty fields are left out, so the action's defaults apply. */
const inputFrom = (fields: ActionField[], values: Values): Record<string, unknown> | string => {
  const input: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];

    if (field.type === 'boolean') {
      if (value === true) {
        input[field.name] = true;
      }

      continue;
    }

    const text = typeof value === 'string' ? value.trim() : '';

    if (!text) {
      if (field.required) {
        return `${field.label} is required`;
      }

      continue;
    }

    if (field.type === 'number') {
      const number = Number(text);

      if (!Number.isFinite(number)) {
        return `${field.label} must be a number`;
      }

      input[field.name] = number;
    } else if (field.type === 'json') {
      try {
        input[field.name] = JSON.parse(text);
      } catch {
        return `${field.label} must be valid JSON`;
      }
    } else {
      input[field.name] = text;
    }
  }

  return input;
};

/** Placeholders written for workflow templates (`{{today}}`) mean nothing in a form. */
const placeholderOf = (field: ActionField) =>
  field.placeholder && !field.placeholder.includes('{{') ? field.placeholder : undefined;

function RecordActionDialog({
  item,
  busy,
  onSubmit,
  onClose,
}: {
  item: RecordAction;
  busy: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Values>({});
  const input = inputFrom(item.fields, values);
  const problem = typeof input === 'string' ? input : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.label}</DialogTitle>
          {item.action.description ? <DialogDescription>{item.action.description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (typeof input !== 'string' && !busy) {
              onSubmit(input);
            }
          }}
        >
          {item.fields.map((field) => {
            const id = `record-action-${field.name}`;
            const set = (value: string | boolean) => setValues((current) => ({ ...current, [field.name]: value }));
            const text = typeof values[field.name] === 'string' ? (values[field.name] as string) : '';

            return field.type === 'boolean' ? (
              <Field key={field.name} orientation="horizontal">
                <Checkbox id={id} checked={values[field.name] === true} onCheckedChange={(checked) => set(checked)} />
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              </Field>
            ) : (
              <Field key={field.name}>
                <FieldLabel htmlFor={id}>
                  {field.label}
                  {field.required ? '' : ' (optional)'}
                </FieldLabel>
                {field.type === 'long_text' || field.type === 'json' ? (
                  <Textarea
                    id={id}
                    value={text}
                    placeholder={placeholderOf(field)}
                    onChange={(event) => set(event.target.value)}
                  />
                ) : (
                  <Input
                    id={id}
                    type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    step={field.type === 'number' ? 'any' : undefined}
                    value={text}
                    placeholder={placeholderOf(field)}
                    onChange={(event) => set(event.target.value)}
                  />
                )}
                {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
              </Field>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || problem !== null} title={problem ?? undefined}>
              {item.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Run a record action: straight away when it needs nothing but the record, else after asking for its fields. Render
 * `dialog` once, near the page's other dialogs.
 */
export const useRunRecordAction = (recordId: string) => {
  const run = useRunModuleAction();
  const [asking, setAsking] = useState<RecordAction | null>(null);
  const execute = (item: RecordAction, fields: Record<string, unknown>) =>
    run.mutate(
      {
        module: item.moduleId,
        action: item.action.name,
        input: { ...fields, [item.input]: recordId },
      },
      {
        onSuccess: () => {
          setAsking(null);
          toast.success(`${item.label} done`);
        },
      },
    );

  return {
    pending: run.isPending,
    start: (item: RecordAction) => (item.fields.length > 0 ? setAsking(item) : execute(item, {})),
    dialog: asking ? (
      <RecordActionDialog
        key={asking.key}
        item={asking}
        busy={run.isPending}
        onSubmit={(input) => execute(asking, input)}
        onClose={() => setAsking(null)}
      />
    ) : null,
  };
};

type ButtonSize = 'default' | 'sm';

/** One action's button, with the dialog it opens when the action needs more than the record. */
function RecordActionItem({ item, recordId, size }: { item: RecordAction; recordId: string; size: ButtonSize }) {
  const run = useRunRecordAction(recordId);

  return (
    <>
      <Button
        variant={item.primary ? 'default' : 'outline'}
        size={size}
        data-action="record-action"
        disabled={run.pending}
        onClick={() => run.start(item)}
      >
        <Icon name={item.icon} /> {item.label}
      </Button>
      {run.dialog}
    </>
  );
}

/** The buttons of the layout's `actions`, for the record of the page they are on: what the top bar of a shell draws. */
export function RecordActions({ entries, size = 'default' }: { entries: readonly LayoutAction[]; size?: ButtonSize }) {
  const { object, record } = useRecordPage();
  const items = useRecordActions(object, record, entries);

  return items.map((item) => <RecordActionItem key={item.key} item={item} recordId={record.id} size={size} />);
}

/**
 * One module action as a button, for a block that draws its own header or toolbar: `<RecordActionButton action={ids.actions.recalculate_quote} />`.
 * It needs a record page around it. The record fills the action's `record` field for the page's object, any other
 * fields are asked for in a dialog, and the action runs as the person. Draws nothing when the action is not installed or
 * takes no record of this object; `label`, `icon`, `primary` and `when` work as in a layout's `actions`.
 */
export function RecordActionButton({ size = 'default', ...entry }: LayoutAction & { size?: ButtonSize }) {
  const { object, record } = useRecordPage();
  const [item] = useRecordActions(object, record, [entry]);

  return item ? <RecordActionItem item={item} recordId={record.id} size={size} /> : null;
}
