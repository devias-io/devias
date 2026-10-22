import {
  defineFieldType,
  GROUPABLE_FIELD_TYPES,
  opsForFieldType,
  type SelectOption,
  SelectOptionSchema,
  SORTABLE_FIELD_TYPES,
} from '@devias/core';
import {
  Button,
  Checkbox,
  cn,
  Icon,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@devias/ui';
import { useState } from 'react';
import { z } from 'zod';
import { OptionsEditor } from './options-editor';
import { Empty, isEmptyValue, OptionBadge, OptionLabel, optionsOf } from './shared';

interface SelectSettings {
  options: SelectOption[];
}

const settingsSchema = z.object({ options: z.array(SelectOptionSchema).min(1) });

const findOption = (options: SelectOption[], value: unknown): SelectOption | undefined =>
  options.find((o) => o.value === value);

const NONE = '__none__';

export const selectFieldType = defineFieldType<string, SelectSettings>({
  type: 'select',
  label: 'Select',
  icon: 'list',
  category: 'basic',
  settingsSchema,
  defaultSettings: { options: [] },
  cell: ({ value, field }) => {
    if (isEmptyValue(value)) {
      return <Empty />;
    }

    const option = findOption(optionsOf(field.settings), value);

    // A value that is no longer one of the options still reads as a label, in grey.
    return <OptionBadge option={option ?? { value: String(value), label: String(value) }} />;
  },
  editor: ({ field, value, onChange, mode, onCommit, onCancel, disabled, invalid }) => {
    const options = optionsOf(field.settings);
    const [changed, setChanged] = useState(false);
    const items = [
      ...(field.isRequired ? [] : [{ value: NONE, label: '— None —' }]),
      ...options.map((o) => ({ value: o.value, label: o.label })),
    ];

    return (
      <Select
        items={items}
        value={value ?? (field.isRequired ? null : NONE)}
        disabled={disabled}
        defaultOpen={mode === 'inline'}
        onValueChange={(next) => {
          onChange(next === NONE || next === null ? null : String(next));
          setChanged(true);

          if (mode === 'inline') {
            onCommit?.();
          }
        }}
        onOpenChange={(open) => {
          if (!open && mode === 'inline' && !changed) {
            onCancel?.();
          }
        }}
      >
        <SelectTrigger
          size={mode === 'inline' ? 'sm' : 'default'}
          className="w-full"
          aria-invalid={invalid || undefined}
        >
          <SelectValue placeholder="Select…">
            {(current: unknown) => {
              const option = findOption(options, current);

              return option ? <OptionBadge option={option} /> : current === NONE ? '— None —' : String(current ?? '');
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} label={item.label}>
              {item.value === NONE ? (
                <span className="text-muted-foreground">{item.label}</span>
              ) : (
                <OptionLabel option={findOption(options, item.value) ?? { value: item.value, label: item.label }} />
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
  filter: { operators: opsForFieldType('select') },
  sortable: SORTABLE_FIELD_TYPES.has('select'),
  groupable: GROUPABLE_FIELD_TYPES.has('select'),
  searchable: false,
  toText: (value, field) =>
    isEmptyValue(value) ? '' : (findOption(optionsOf(field.settings), value)?.label ?? String(value)),
  settingsEditor: ({ value, onChange }) => (
    <OptionsEditor options={value.options ?? []} onChange={(options) => onChange({ ...value, options })} />
  ),
});

export const multiSelectFieldType = defineFieldType<string[], SelectSettings>({
  type: 'multi_select',
  label: 'Multi select',
  icon: 'list-checks',
  category: 'basic',
  settingsSchema,
  defaultSettings: { options: [] },
  cell: ({ value, field }) => {
    if (!Array.isArray(value) || value.length === 0) {
      return <Empty />;
    }

    const options = optionsOf(field.settings);
    const shown = value.slice(0, 3);

    return (
      <span className="flex items-center gap-1 overflow-hidden">
        {shown.map((v) => {
          const option = findOption(options, v);

          return <OptionBadge key={v} option={option ?? { value: v, label: v }} />;
        })}
        {value.length > shown.length ? (
          <span className="text-xs text-muted-foreground">+{value.length - shown.length}</span>
        ) : null}
      </span>
    );
  },
  editor: ({ field, value, onChange, mode, onCommit, onCancel, disabled, invalid }) => {
    const options = optionsOf(field.settings);
    const selected = Array.isArray(value) ? value : [];
    const [open, setOpen] = useState(mode === 'inline');
    const [changed, setChanged] = useState(false);
    const toggle = (optionValue: string, checked: boolean) => {
      const next = checked ? [...selected, optionValue] : selected.filter((v) => v !== optionValue);
      onChange(next.length > 0 ? next : null);
      setChanged(true);
    };

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next && mode === 'inline') {
            (changed ? onCommit : onCancel)?.();
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size={mode === 'inline' ? 'sm' : 'default'}
              className={cn('w-full justify-between font-normal', selected.length === 0 && 'text-muted-foreground')}
              disabled={disabled}
              aria-invalid={invalid || undefined}
            />
          }
        >
          <span className="truncate">
            {selected.length === 0 ? 'Select…' : selected.map((v) => findOption(options, v)?.label ?? v).join(', ')}
          </span>
          <Icon name="chevron-down" className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 gap-1 p-1.5">
          {options.length === 0 ? <div className="px-2 py-1 text-xs text-muted-foreground">No options</div> : null}
          {options.map((option) => (
            <Label
              key={option.value}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-normal hover:bg-muted"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked)}
              />
              <OptionLabel option={option} />
            </Label>
          ))}
        </PopoverContent>
      </Popover>
    );
  },
  filter: { operators: opsForFieldType('multi_select') },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value, field) =>
    Array.isArray(value) ? value.map((v) => findOption(optionsOf(field.settings), v)?.label ?? v).join(', ') : '',
  settingsEditor: ({ value, onChange }) => (
    <OptionsEditor options={value.options ?? []} onChange={(options) => onChange({ ...value, options })} />
  ),
});
