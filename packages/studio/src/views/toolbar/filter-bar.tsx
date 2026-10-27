import { type FieldMetadata, type FilterCondition, type FilterOp, opsForFieldType } from '@devias/core';
import { Button, cn, Icon, Input, OptionSelect, Popover, PopoverContent, PopoverTrigger } from '@devias/ui';
import { type FormEvent, type ReactNode, useState } from 'react';
import { FilterValueInput, opNeedsValue } from '../../fields/filter-input';
import { getFieldType, useFieldTypes } from '../../registries';
import { describeValue, type FilterChip, OP_LABELS } from '../filters';

interface EditorProps {
  fields: FieldMetadata[];
  initial?: FilterCondition;
  onApply: (condition: FilterCondition) => void;
  onRemove?: () => void;
}

/** Step one of adding a filter: pick the field, with a search for long lists. */
function FieldList({ fields, onPick }: { fields: FieldMetadata[]; onPick: (name: string) => void }) {
  const fieldTypes = useFieldTypes();
  const [query, setQuery] = useState('');
  const shown = fields.filter((f) => f.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-2" data-slot="filter-field-list">
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by…"
          aria-label="Search fields"
          className="pl-8"
        />
      </div>
      <ul className="-mx-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1">
        {shown.map((field) => (
          <li key={field.id}>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => onPick(field.name)}
            >
              <Icon name={getFieldType(fieldTypes, field.type).icon} className="size-3.5 text-muted-foreground" />
              <span className="truncate">{field.label}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-2 py-3 text-xs text-muted-foreground">No fields match.</li> : null}
      </ul>
    </div>
  );
}

/**
 * Add or edit a filter, in two steps: first the field, then the condition and its value. Editing an existing chip
 * opens on the second step; the back arrow changes the field.
 */
export function ConditionEditor({ fields, initial, onApply, onRemove }: EditorProps) {
  const fieldTypes = useFieldTypes();
  const filterable = fields.filter((f) => (getFieldType(fieldTypes, f.type).filter?.operators.length ?? 0) > 0);
  const [fieldName, setFieldName] = useState<string | null>(initial?.field ?? null);
  const field = filterable.find((f) => f.name === fieldName);
  const fieldType = field ? getFieldType(fieldTypes, field.type) : undefined;
  const ops = fieldType?.filter?.operators ?? (field ? opsForFieldType(field.type) : []);
  const [op, setOp] = useState<FilterOp>(initial?.op ?? ops[0] ?? 'eq');
  const [value, setValue] = useState<unknown>(initial?.value ?? null);
  const effectiveOp = ops.includes(op) ? op : (ops[0] ?? 'eq');

  if (filterable.length === 0) {
    return <div className="text-xs text-muted-foreground">No filterable fields.</div>;
  }

  if (!field || !fieldType) {
    return (
      <FieldList
        fields={filterable}
        onPick={(name) => {
          const picked = filterable.find((f) => f.name === name);
          const pickedOps = picked ? (getFieldType(fieldTypes, picked.type).filter?.operators ?? []) : [];
          setFieldName(name);
          setOp(pickedOps[0] ?? 'eq');
          setValue(null);
        }}
      />
    );
  }

  const canApply = !opNeedsValue(effectiveOp) || (value !== null && value !== undefined && value !== '');
  const apply = (event?: FormEvent) => {
    event?.preventDefault();

    if (!canApply) {
      return;
    }

    onApply({ field: field.name, op: effectiveOp, ...(opNeedsValue(effectiveOp) ? { value } : {}) });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={apply} data-slot="filter-condition">
      <button
        type="button"
        className="-ml-1 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium hover:bg-muted"
        aria-label="Change field"
        onClick={() => setFieldName(null)}
      >
        <Icon name="arrow-left" className="size-3.5 text-muted-foreground" />
        <Icon name={fieldType.icon} className="size-3.5 text-muted-foreground" />
        {field.label}
      </button>
      <OptionSelect
        size="sm"
        className="w-full"
        aria-label="Condition"
        value={effectiveOp}
        onValueChange={(next) => {
          setOp(next);
          setValue(null);
        }}
        options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))}
      />
      <FilterValueInput field={field} fieldType={fieldType} op={effectiveOp} value={value} onChange={setValue} />
      <div className="flex items-center justify-between gap-2 pt-1">
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={!canApply}>
          Apply
        </Button>
      </div>
    </form>
  );
}

export function AddFilterButton({
  fields,
  onAdd,
  compact = false,
  align = compact ? 'end' : 'start',
  className,
  label,
  icon = true,
  size = 'sm',
  children,
}: {
  fields: FieldMetadata[];
  onAdd: (c: FilterCondition) => void;
  /** Icon-only trigger. */
  compact?: boolean;
  /** Accessible name and tooltip, for a trigger whose children are not text (e.g. a toolbar icon with a count). */
  label?: string;
  /** Popover alignment; right-aligned toolbars open it towards the left. */
  align?: 'start' | 'end';
  className?: string;
  /** Show the filter icon in front of the children. */
  icon?: boolean;
  /** The trigger's size; toolbars with larger controls ask for `lg`. */
  size?: 'sm' | 'lg';
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          compact ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Filter"
              title="Filter"
              className="text-muted-foreground"
            />
          ) : (
            <Button
              variant="ghost"
              size={size}
              aria-label={label}
              title={label}
              className={cn('text-muted-foreground', className)}
            />
          )
        }
      >
        {icon || compact ? (
          <Icon name="filter" className={compact ? undefined : size === 'lg' ? 'size-4' : 'size-3.5'} />
        ) : null}
        {compact ? null : (children ?? 'Filter')}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <ConditionEditor
          key={String(open)}
          fields={fields}
          onApply={(condition) => {
            onAdd(condition);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The row of active filters under the toolbar. Each is a chip in three parts (field, condition, value) that opens
 * its editor when clicked; the dashed chip at the end adds another.
 */
export function FilterBar({
  chips,
  fields,
  onChange,
}: {
  chips: FilterChip[];
  fields: FieldMetadata[];
  onChange: (chips: FilterChip[]) => void;
}) {
  const fieldTypes = useFieldTypes();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (chips.length === 0) {
    return null;
  }

  const replace = (index: number, chip: FilterChip | null) => {
    setOpenIndex(null);
    onChange(chip ? chips.map((c, i) => (i === index ? chip : c)) : chips.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-slot="filter-bar">
      {chips.map((chip, index) => {
        if (chip.kind === 'advanced') {
          return (
            <span
              key={index}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-card pr-1 pl-2.5 text-xs"
            >
              Advanced filter
              <button
                type="button"
                aria-label="Remove filter"
                className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => replace(index, null)}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          );
        }

        const field = fields.find((f) => f.name === chip.condition.field);
        const fieldType = field ? getFieldType(fieldTypes, field.type) : undefined;
        const value = describeValue(chip.condition, field, fieldType);

        return (
          <Popover key={index} open={openIndex === index} onOpenChange={(open) => setOpenIndex(open ? index : null)}>
            <span
              className="inline-flex h-7 items-center rounded-lg border border-border bg-card text-xs"
              data-filter-chip
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="flex h-full items-center gap-1.5 rounded-l-lg pr-2 pl-2.5 transition-colors hover:bg-muted"
                  />
                }
              >
                {fieldType ? <Icon name={fieldType.icon} className="size-3 text-muted-foreground" /> : null}
                <span className="font-medium">{field?.label ?? chip.condition.field}</span>
                <span className="text-muted-foreground">{OP_LABELS[chip.condition.op]}</span>
                {value !== null ? <span className="max-w-48 truncate text-brand-strong">{value}</span> : null}
              </PopoverTrigger>
              <button
                type="button"
                aria-label="Remove filter"
                className="flex h-full w-6 items-center justify-center rounded-r-lg border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => replace(index, null)}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
            <PopoverContent align="start" className="w-72">
              <ConditionEditor
                fields={fields}
                initial={chip.condition}
                onApply={(condition) => replace(index, { kind: 'condition', condition })}
                onRemove={() => replace(index, null)}
              />
            </PopoverContent>
          </Popover>
        );
      })}
      <AddFilterButton
        fields={fields}
        label="Add filter"
        icon={false}
        className="h-7 gap-1 rounded-lg border border-dashed border-border px-2 text-xs"
        onAdd={(condition) => onChange([...chips, { kind: 'condition', condition }])}
      >
        <Icon name="plus" className="size-3 -ml-0.5" /> Add filter
      </AddFilterButton>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onChange([])}>
        Clear
      </Button>
    </div>
  );
}
