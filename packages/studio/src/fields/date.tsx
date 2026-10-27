import { defineFieldType, opsForFieldType, SORTABLE_FIELD_TYPES } from '@devias/core';
import { Button, Calendar, cn, Icon, Input, Popover, PopoverContent, PopoverTrigger } from '@devias/ui';
import { format, isValid, parseISO } from 'date-fns';
import { useState } from 'react';
import { Empty, isEmptyValue } from './shared';

const parseDate = (value: string | null | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = parseISO(value);

  return isValid(parsed) ? parsed : undefined;
};

export const formatDate = (value: string | null | undefined, pattern = 'd MMM yyyy'): string => {
  const date = parseDate(value);

  return date ? format(date, pattern) : (value ?? '');
};

export const dateFieldType = defineFieldType<string, Record<string, never>>({
  type: 'date',
  label: 'Date',
  icon: 'calendar',
  category: 'basic',
  cell: ({ value }) => (isEmptyValue(value) ? <Empty /> : <span className="tabular-nums">{formatDate(value)}</span>),
  editor: ({ value, onChange, mode, onCommit, onCancel, autoFocus, disabled, invalid }) => {
    const [open, setOpen] = useState(mode === 'inline');
    const [picked, setPicked] = useState(false);
    const date = parseDate(value);

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next && mode === 'inline') {
            (picked ? onCommit : onCancel)?.();
          }
        }}
      >
        <div className="flex items-center gap-1">
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size={mode === 'inline' ? 'sm' : 'default'}
                className={cn('flex-1 justify-start gap-2 font-normal', !date && 'text-muted-foreground')}
                disabled={disabled}
                autoFocus={autoFocus}
                aria-invalid={invalid || undefined}
              />
            }
          >
            <Icon name="calendar" className="size-3.5 text-muted-foreground" />
            {date ? format(date, 'd MMM yyyy') : 'Pick a date'}
          </PopoverTrigger>
          {date && !disabled ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear date"
              onClick={() => {
                onChange(null);
                setPicked(true);

                if (mode === 'inline') {
                  onCommit?.();
                }
              }}
            >
              <Icon name="x" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={(next) => {
              onChange(next ? format(next, 'yyyy-MM-dd') : null);
              setPicked(true);
              setOpen(false);

              if (mode === 'inline') {
                onCommit?.();
              }
            }}
          />
        </PopoverContent>
      </Popover>
    );
  },
  filter: {
    operators: opsForFieldType('date'),
    input: ({ value, onChange }) => (
      <Input
        type="date"
        className="h-7"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    ),
  },
  sortable: SORTABLE_FIELD_TYPES.has('date'),
  groupable: false,
  searchable: false,
  toText: (value) => (isEmptyValue(value) ? '' : formatDate(value)),
});

const toLocalInput = (value: string | null | undefined): string => {
  const date = parseDate(value);

  return date ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
};

export const dateTimeFieldType = defineFieldType<string, Record<string, never>>({
  type: 'date_time',
  label: 'Date & time',
  icon: 'calendar-clock',
  category: 'basic',
  cell: ({ value }) =>
    isEmptyValue(value) ? <Empty /> : <span className="tabular-nums">{formatDate(value, 'd MMM yyyy HH:mm')}</span>,
  editor: ({ value, onChange, mode, onCommit, onCancel, autoFocus, disabled, invalid }) => (
    <Input
      type="datetime-local"
      className={mode === 'inline' ? 'h-7' : undefined}
      value={toLocalInput(value)}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      onBlur={mode === 'inline' ? onCommit : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit?.();
        }

        if (e.key === 'Escape') {
          onCancel?.();
        }
      }}
    />
  ),
  filter: {
    operators: opsForFieldType('date_time'),
    input: ({ value, onChange }) => (
      <Input
        type="datetime-local"
        className="h-7"
        value={toLocalInput(typeof value === 'string' ? value : null)}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      />
    ),
  },
  sortable: SORTABLE_FIELD_TYPES.has('date_time'),
  groupable: false,
  searchable: false,
  toText: (value) => (isEmptyValue(value) ? '' : formatDate(value, 'd MMM yyyy HH:mm')),
});
