import { defineFieldType, opsForFieldType, SEARCHABLE_FIELD_TYPES, SORTABLE_FIELD_TYPES } from '@devias/core';
import { Input, Label, Switch, Textarea } from '@devias/ui';
import { z } from 'zod';
import { Empty, inlineKeyHandler, isEmptyValue } from './shared';

interface TextSettings {
  multiline?: boolean;
  maxLength?: number;
}

export const textFieldType = defineFieldType<string, TextSettings>({
  type: 'text',
  label: 'Text',
  icon: 'text',
  category: 'basic',
  settingsSchema: z.object({ multiline: z.boolean().optional(), maxLength: z.number().int().positive().optional() }),
  cell: ({ value, field }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : (
      <span className={field.settings.multiline ? 'line-clamp-1' : 'truncate'}>{value}</span>
    ),
  editor: ({ field, value, onChange, mode, onCommit, onCancel, autoFocus, disabled, invalid }) => {
    const common = {
      value: value ?? '',
      autoFocus,
      disabled,
      'aria-invalid': invalid || undefined,
      maxLength: field.settings.maxLength,
      onBlur: mode === 'inline' ? onCommit : undefined,
    };

    if (field.settings.multiline) {
      return (
        <Textarea
          {...common}
          rows={mode === 'inline' ? 3 : 4}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          onKeyDown={inlineKeyHandler(onCommit, onCancel, { multiline: true })}
        />
      );
    }

    return (
      <Input
        {...common}
        className={mode === 'inline' ? 'h-7' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        onKeyDown={inlineKeyHandler(onCommit, onCancel)}
      />
    );
  },
  filter: { operators: opsForFieldType('text') },
  sortable: SORTABLE_FIELD_TYPES.has('text'),
  groupable: false,
  searchable: SEARCHABLE_FIELD_TYPES.has('text'),
  toText: (value) => value ?? '',
  settingsEditor: ({ value, onChange }) => (
    <div className="flex flex-col gap-3">
      <Label className="flex items-center justify-between gap-2">
        <span>Multiline</span>
        <Switch checked={Boolean(value.multiline)} onCheckedChange={(multiline) => onChange({ ...value, multiline })} />
      </Label>
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Max length</span>
        <Input
          type="number"
          min={1}
          placeholder="No limit"
          value={value.maxLength ?? ''}
          onChange={(e) => onChange({ ...value, maxLength: e.target.value ? Number(e.target.value) : undefined })}
        />
      </Label>
    </div>
  ),
});
