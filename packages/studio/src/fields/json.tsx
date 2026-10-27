import { defineFieldType, opsForFieldType } from '@devias/core';
import { Textarea } from '@devias/ui';
import { useState } from 'react';
import { Empty, isEmptyValue } from './shared';

const compact = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const jsonFieldType = defineFieldType<unknown, Record<string, never>>({
  type: 'json',
  label: 'JSON',
  icon: 'braces',
  category: 'advanced',
  cell: ({ value }) =>
    isEmptyValue(value) ? <Empty /> : <span className="truncate font-mono text-xs">{compact(value)}</span>,
  editor: ({ value, onChange, mode, onCommit, onCancel, autoFocus, disabled }) => {
    const [text, setText] = useState(isEmptyValue(value) ? '' : JSON.stringify(value, null, 2));
    const [error, setError] = useState<string | null>(null);
    const apply = (next: string) => {
      setText(next);

      if (next.trim() === '') {
        setError(null);
        onChange(null);

        return;
      }

      try {
        onChange(JSON.parse(next));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid JSON');
      }
    };

    return (
      <div className="flex flex-col gap-1">
        <Textarea
          value={text}
          rows={mode === 'inline' ? 4 : 6}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className="font-mono text-xs"
          onChange={(e) => apply(e.target.value)}
          onBlur={mode === 'inline' && !error ? onCommit : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onCancel?.();
            }

            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !error) {
              onCommit?.();
            }
          }}
        />
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    );
  },
  filter: { operators: opsForFieldType('json') },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => (isEmptyValue(value) ? '' : compact(value)),
});
