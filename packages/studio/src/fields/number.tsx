import {
  defineFieldType,
  type FieldCellProps,
  type FieldEditorProps,
  type FieldMetadata,
  fieldRef,
  opsForFieldType,
  SORTABLE_FIELD_TYPES,
} from '@devias/core';
import { Input, InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, Label, OptionSelect } from '@devias/ui';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useFields } from '../hooks/use-schema-lookups';
import { Empty, formatCurrency, formatNumber, inlineKeyHandler, isEmptyValue, parseNumberInput } from './shared';

interface NumberSettings {
  precision?: number;
  format?: 'plain' | 'percent';
}

/** Text state so partial input like "1." survives while typing; the field value stays a number. */
function NumericInput({
  value,
  onChange,
  step,
  suffix,
  prefix,
  inline,
  onCommit,
  onCancel,
  autoFocus,
  disabled,
  invalid,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number | 'any';
  suffix?: string;
  prefix?: string;
  inline: boolean;
  onCommit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((current) => (parseNumberInput(current) === value ? current : value === null ? '' : String(value)));
  }, [value]);
  const input = (
    <InputGroupInput
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      value={text}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNumberInput(e.target.value));
      }}
      onBlur={inline ? onCommit : undefined}
      onKeyDown={inlineKeyHandler(onCommit, onCancel)}
    />
  );

  if (!prefix && !suffix) {
    return (
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        value={text}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={inline ? 'h-7' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNumberInput(e.target.value));
        }}
        onBlur={inline ? onCommit : undefined}
        onKeyDown={inlineKeyHandler(onCommit, onCancel)}
      />
    );
  }

  return (
    <InputGroup className={inline ? 'h-7' : undefined}>
      {prefix ? (
        <InputGroupAddon>
          <InputGroupText>{prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {input}
      {suffix ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

export const numberFieldType = defineFieldType<number, NumberSettings>({
  type: 'number',
  label: 'Number',
  icon: 'hash',
  category: 'basic',
  settingsSchema: z.object({
    precision: z.number().int().min(0).max(10).optional(),
    format: z.enum(['plain', 'percent']).optional(),
  }),
  cell: ({ value, field }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : (
      <span className="tabular-nums">{formatNumber(value as number, field.settings)}</span>
    ),
  editor: ({ field, value, onChange, mode, onCommit, onCancel, autoFocus, disabled, invalid }) => (
    <NumericInput
      value={value}
      onChange={onChange}
      step={field.settings.precision !== undefined ? 10 ** -field.settings.precision : 'any'}
      suffix={field.settings.format === 'percent' ? '%' : undefined}
      inline={mode === 'inline'}
      onCommit={onCommit}
      onCancel={onCancel}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
    />
  ),
  filter: { operators: opsForFieldType('number') },
  sortable: SORTABLE_FIELD_TYPES.has('number'),
  groupable: false,
  searchable: false,
  toText: (value, field) => (isEmptyValue(value) ? '' : formatNumber(value as number, field.settings)),
  settingsEditor: ({ value, onChange }) => (
    <div className="grid grid-cols-2 gap-3">
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Precision</span>
        <Input
          type="number"
          min={0}
          max={10}
          value={value.precision ?? ''}
          onChange={(e) =>
            onChange({ ...value, precision: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </Label>
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Format</span>
        <OptionSelect
          className="w-full"
          aria-label="Format"
          value={value.format ?? 'plain'}
          onValueChange={(format) => onChange({ ...value, format })}
          options={[
            { value: 'plain', label: 'Plain' },
            { value: 'percent', label: 'Percent' },
          ]}
        />
      </Label>
    </div>
  ),
});

interface MoneySettings {
  /** The code amounts are in, unless the record says otherwise. */
  currencyCode?: string;
  /** The id of the field of the same object that holds each record's code: it wins over `currencyCode`. */
  currencyFieldId?: string;
}

/** The currency of one record's amount: its own currency field's code when the field names one, else the fixed code. */
const useCurrency = (field: FieldMetadata & { settings: MoneySettings }, record?: Record<string, unknown>) => {
  const fields = useFields(field.objectId);
  const name = fieldRef(fields, field.settings.currencyFieldId)?.name;
  const own = name ? record?.[name] : undefined;

  return typeof own === 'string' && own.length === 3 ? own : field.settings.currencyCode;
};

function MoneyCell({ value, field, record }: FieldCellProps<number, MoneySettings>) {
  const currency = useCurrency(field, record);

  return isEmptyValue(value) ? (
    <Empty />
  ) : (
    <span className="tabular-nums">{formatCurrency(value as number, currency)}</span>
  );
}

function MoneyEditor({
  field,
  value,
  onChange,
  mode,
  onCommit,
  onCancel,
  autoFocus,
  disabled,
  invalid,
  record,
}: FieldEditorProps<number, MoneySettings>) {
  const currency = useCurrency(field, record);

  return (
    <NumericInput
      value={value}
      onChange={onChange}
      step={0.01}
      prefix={currency ?? 'USD'}
      inline={mode === 'inline'}
      onCommit={onCommit}
      onCancel={onCancel}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** The currency fields of the object: what a money field's `currencyFieldId` can name. */
function CurrencyFieldSelect({
  objectId,
  value,
  onChange,
}: {
  objectId?: string;
  value?: string;
  onChange: (id?: string) => void;
}) {
  const fields = useFields(objectId).filter((f) => f.type === 'currency');

  return (
    <OptionSelect
      className="w-full"
      value={value ?? ''}
      onValueChange={(id) => onChange(id || undefined)}
      options={[
        { value: '', label: 'None: use the currency code' },
        ...fields.map((f) => ({ value: f.id, label: f.label })),
      ]}
    />
  );
}

export const moneyFieldType = defineFieldType<number, MoneySettings>({
  type: 'money',
  label: 'Money',
  icon: 'dollar-sign',
  category: 'basic',
  settingsSchema: z.object({ currencyCode: z.string().length(3).optional(), currencyFieldId: z.string().optional() }),
  cell: MoneyCell,
  editor: MoneyEditor,
  filter: { operators: opsForFieldType('money') },
  sortable: SORTABLE_FIELD_TYPES.has('money'),
  groupable: false,
  searchable: false,
  toText: (value, field) => (isEmptyValue(value) ? '' : formatCurrency(value as number, field.settings.currencyCode)),
  settingsEditor: ({ objectId, value, onChange }) => (
    <div className="flex flex-col items-stretch gap-3">
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Currency code</span>
        <Input
          maxLength={3}
          placeholder="EUR"
          value={value.currencyCode ?? ''}
          onChange={(e) => onChange({ ...value, currencyCode: e.target.value.toUpperCase() || undefined })}
        />
      </Label>
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Currency field</span>
        <CurrencyFieldSelect
          objectId={objectId}
          value={value.currencyFieldId}
          onChange={(currencyFieldId) => onChange({ ...value, currencyFieldId })}
        />
      </Label>
    </div>
  ),
});
