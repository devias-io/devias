import type { SelectOption } from '@devias/core';
import { Button, Icon, Input, OptionSelect } from '@devias/ui';
import { OPTION_COLOR_NAMES } from './shared';

const slugValue = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Shared settings editor for select and multi_select: value / label / color rows. */
export function OptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
}) {
  const update = (index: number, patch: Partial<SelectOption>) =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium">Options</div>
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            placeholder="Label"
            value={option.label}
            onChange={(e) =>
              update(index, {
                label: e.target.value,
                ...(option.value === slugValue(option.label) || option.value === ''
                  ? { value: slugValue(e.target.value) }
                  : {}),
              })
            }
          />
          <Input
            placeholder="value"
            className="font-mono text-xs"
            value={option.value}
            onChange={(e) => update(index, { value: e.target.value })}
          />
          <OptionSelect
            aria-label="Color"
            className="w-28"
            value={option.color ?? 'neutral'}
            onValueChange={(color) => update(index, { color })}
            options={OPTION_COLOR_NAMES.map((color) => ({ value: color, label: color }))}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove option"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <Icon name="x" className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...options, { value: '', label: '', color: 'neutral' }])}
      >
        <Icon name="plus" /> Add option
      </Button>
    </div>
  );
}
