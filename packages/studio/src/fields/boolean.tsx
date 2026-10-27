import { defineFieldType, GROUPABLE_FIELD_TYPES, opsForFieldType, SORTABLE_FIELD_TYPES } from '@devias/core';
import { Badge, cn } from '@devias/ui';
import { Empty, isEmptyValue } from './shared';

export const booleanFieldType = defineFieldType<boolean, Record<string, never>>({
  type: 'boolean',
  label: 'Checkbox',
  icon: 'square-check',
  category: 'basic',
  defaultValue: () => false,
  cell: ({ value }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : value ? (
      <Badge variant="outline" className="border-border bg-transparent px-2 font-normal">
        Yes
      </Badge>
    ) : (
      <Badge variant="outline" className="border-border bg-transparent px-2 font-normal text-muted-foreground">
        No
      </Badge>
    ),
  editor: ({ field, value, onChange, mode, onCommit, onCancel, autoFocus, disabled }) => (
    <fieldset
      aria-label={field.label}
      className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      // Inline, picking an option is what commits; leaving without one (a click elsewhere, Tab, Escape) puts it back.
      onBlur={(event) => {
        if (mode === 'inline' && !event.currentTarget.contains(event.relatedTarget)) {
          onCancel?.();
        }
      }}
      onKeyDown={(event) => {
        if (mode === 'inline' && event.key === 'Escape') {
          onCancel?.();
        }
      }}
    >
      {([true, false] as const).map((option) => {
        const selected = value === option;

        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            // biome-ignore lint/a11y/noAutofocus: an inline editor opens because the user asked to edit this cell
            autoFocus={autoFocus && option === Boolean(value)}
            className={cn(
              'h-6 min-w-10 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50',
              selected
                ? 'bg-background text-foreground shadow-xs'
                : 'cursor-pointer text-muted-foreground hover:text-foreground',
            )}
            // Keep focus where it is while an option is pressed, so the press is not read as leaving the editor.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(option);

              if (mode === 'inline') {
                queueMicrotask(() => onCommit?.());
              }
            }}
          >
            {option ? 'Yes' : 'No'}
          </button>
        );
      })}
    </fieldset>
  ),
  filter: { operators: opsForFieldType('boolean') },
  sortable: SORTABLE_FIELD_TYPES.has('boolean'),
  groupable: GROUPABLE_FIELD_TYPES.has('boolean'),
  searchable: false,
  toText: (value) => (isEmptyValue(value) ? '' : value ? 'Yes' : 'No'),
});
