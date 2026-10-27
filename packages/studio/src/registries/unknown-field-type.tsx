import { type FieldTypeDefinition, opsForFieldType } from '@devias/core';
import { Badge, Textarea } from '@devias/ui';
import { useState } from 'react';

const compact = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/** Fallback for field types no module registered: JSON text plus a badge naming the type. */
export const unknownFieldType = (type: string): FieldTypeDefinition => ({
  type,
  label: type,
  icon: 'circle-help',
  cell: ({ value }) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-xs">{compact(value)}</span>
      <Badge variant="outline" className="shrink-0 text-xs">
        {type}
      </Badge>
    </span>
  ),
  editor: ({ value, onChange, onCommit, onCancel, autoFocus, disabled }) => {
    const [text, setText] = useState(value === null || value === undefined ? '' : JSON.stringify(value, null, 2));
    const commit = () => {
      if (text.trim() === '') {
        onChange(null);
      } else {
        try {
          onChange(JSON.parse(text));
        } catch {
          onChange(text);
        }
      }

      onCommit?.();
    };

    return (
      <Textarea
        value={text}
        autoFocus={autoFocus}
        disabled={disabled}
        className="font-mono text-xs"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onCancel?.();
          }
        }}
      />
    );
  },
  filter: { operators: opsForFieldType(type) },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => compact(value),
});
