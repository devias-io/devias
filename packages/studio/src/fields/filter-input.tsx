import type { FieldMetadata, FieldTypeDefinition, FilterOp } from '@devias/core';
import { Checkbox, Input, Label } from '@devias/ui';
import { useState } from 'react';
import { OptionLabel, optionsOf, parseNumberInput } from './shared';

const NO_VALUE_OPS = new Set<FilterOp>(['is_empty', 'is_not_empty']);
const LIST_OPS = new Set<FilterOp>(['in', 'not_in', 'any_of', 'all_of']);
const NUMERIC_TYPES = new Set(['number', 'money']);

export const opNeedsValue = (op: FilterOp): boolean => !NO_VALUE_OPS.has(op);

/**
 * Free-text list of values. It keeps what was typed (a trailing comma included) and only reports the parsed list, so
 * the field is not re-rendered from the list while typing; the parent remounts it (by key) when the operator changes.
 */
function ListTextInput({
  numeric,
  value,
  onChange,
}: {
  numeric: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));

  return (
    <Input
      className="h-7"
      placeholder="Comma-separated values"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parts = e.target.value
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        onChange(numeric ? parts.map((p) => parseNumberInput(p)).filter((n): n is number => n !== null) : parts);
      }}
    />
  );
}

/** Value input for one filter condition, derived from the field type and operator. */
export function FilterValueInput({
  field,
  fieldType,
  op,
  value,
  onChange,
}: {
  field: FieldMetadata;
  fieldType: FieldTypeDefinition;
  op: FilterOp;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (NO_VALUE_OPS.has(op)) {
    return null;
  }

  const options = optionsOf(field.settings);
  const numeric = NUMERIC_TYPES.has(field.type);

  if (LIST_OPS.has(op)) {
    if (options.length > 0) {
      const selected = Array.isArray(value) ? (value as string[]) : [];

      return (
        <div className="flex max-h-48 flex-col gap-0.5 overflow-auto">
          {options.map((option) => (
            <Label
              key={option.value}
              className="flex h-7 items-center gap-2 rounded-md px-1 text-xs font-normal hover:bg-muted"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))
                }
              />
              <OptionLabel option={option} />
            </Label>
          ))}
        </div>
      );
    }

    return <ListTextInput key={op} numeric={numeric} value={value} onChange={onChange} />;
  }

  if (op === 'between') {
    const pair = Array.isArray(value) ? value : [null, null];
    const Single = fieldType.filter?.input;
    const render = (index: 0 | 1) =>
      Single ? (
        <Single
          field={field as FieldMetadata & { settings: Record<string, unknown> }}
          op={op}
          value={pair[index] ?? null}
          onChange={(v) => onChange(index === 0 ? [v, pair[1] ?? null] : [pair[0] ?? null, v])}
        />
      ) : (
        <Input
          className="h-7"
          type={numeric ? 'number' : 'text'}
          value={pair[index] === null || pair[index] === undefined ? '' : String(pair[index])}
          onChange={(e) => {
            const v = numeric ? parseNumberInput(e.target.value) : e.target.value || null;
            onChange(index === 0 ? [v, pair[1] ?? null] : [pair[0] ?? null, v]);
          }}
        />
      );

    return (
      <div className="flex items-center gap-1.5">
        {render(0)}
        <span className="text-xs text-muted-foreground">and</span>
        {render(1)}
      </div>
    );
  }

  if (fieldType.filter?.input) {
    const Custom = fieldType.filter.input;

    return (
      <Custom
        field={field as FieldMetadata & { settings: Record<string, unknown> }}
        op={op}
        value={value}
        onChange={onChange}
      />
    );
  }

  const EDITOR_TYPES = new Set(['select', 'boolean', 'relation', 'date', 'date_time']);

  if (EDITOR_TYPES.has(field.type) || (!numeric && !['text', 'email', 'phone', 'url'].includes(field.type))) {
    const Editor = fieldType.editor;

    return (
      <Editor
        field={field as FieldMetadata & { settings: Record<string, unknown> }}
        value={value === undefined ? null : value}
        onChange={(v) => onChange(v)}
        mode="form"
      />
    );
  }

  return (
    <Input
      className="h-7"
      type={numeric ? 'number' : 'text'}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(numeric ? parseNumberInput(e.target.value) : e.target.value || null)}
    />
  );
}
