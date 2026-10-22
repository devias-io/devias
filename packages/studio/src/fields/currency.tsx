import { defineFieldType, opsForFieldType, SORTABLE_FIELD_TYPES } from '@devias/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@devias/ui';
import { useState } from 'react';
import { z } from 'zod';
import { Empty, isEmptyValue } from './shared';

const NONE = '__none__';

/** `EUR · Euro`, for any ISO 4217 code the runtime knows; the bare code when it does not know it. */
export const currencyLabel = (code: string): string => {
  try {
    const name = new Intl.DisplayNames(undefined, { type: 'currency' }).of(code);

    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
};

const currencyCodes = (): string[] => {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return ['EUR', 'USD', 'GBP'];
  }
};

export const currencyFieldType = defineFieldType<string, Record<string, never>>({
  type: 'currency',
  label: 'Currency',
  icon: 'coins',
  category: 'basic',
  settingsSchema: z.object({}),
  cell: ({ value }) =>
    isEmptyValue(value) ? <Empty /> : <span title={currencyLabel(String(value))}>{String(value)}</span>,
  editor: ({ field, value, onChange, mode, onCommit, onCancel, disabled, invalid }) => {
    const [changed, setChanged] = useState(false);
    const items = [
      ...(field.isRequired ? [] : [{ value: NONE, label: '— None —' }]),
      ...currencyCodes().map((code) => ({ value: code, label: currencyLabel(code) })),
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
            {(current: unknown) => (current === NONE ? '— None —' : current ? currencyLabel(String(current)) : '')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} label={item.label}>
              {item.value === NONE ? <span className="text-muted-foreground">{item.label}</span> : item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
  filter: { operators: opsForFieldType('currency') },
  sortable: SORTABLE_FIELD_TYPES.has('currency'),
  groupable: false,
  searchable: false,
  toText: (value) => (isEmptyValue(value) ? '' : String(value)),
});
