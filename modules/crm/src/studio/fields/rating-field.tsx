import { defineFieldType } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import { z } from 'zod';

const MAX = 5;
const STARS = [1, 2, 3, 4, 5];

function Star({ active, size }: { active: boolean; size: string }) {
  return (
    <Icon name="star" className={cn(size, active ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground')} />
  );
}

function Stars({
  value,
  onPick,
  size = 'size-3.5',
}: {
  value: number | null;
  onPick?: (value: number | null) => void;
  size?: string;
}) {
  const filled = value ?? 0;
  const label = `${filled} of ${MAX} stars`;

  if (!onPick) {
    return (
      <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
        {STARS.map((star) => (
          <Star key={star} active={star <= filled} size={size} />
        ))}
      </span>
    );
  }

  return (
    <span role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5">
      {STARS.map((star) => (
        // biome-ignore lint/a11y/useSemanticElements: star buttons act as radios
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={filled === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          className="rounded-sm outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={() => onPick(filled === star ? null : star)}
        >
          <Star active={star <= filled} size={size} />
        </button>
      ))}
    </span>
  );
}

/** 1–5 stars. Stored as an integer; clicking the current value clears it. */
export const ratingFieldType = defineFieldType<number, Record<string, never>>({
  type: 'rating',
  label: 'Rating',
  icon: 'star',
  category: 'basic',
  valueSchema: () => z.number().int().min(1).max(MAX),
  cell: ({ value }) =>
    value === null || value === undefined ? <span className="text-muted-foreground">-</span> : <Stars value={value} />,
  editor: ({ value, onChange, mode, onCommit, onCancel, disabled }) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape/Enter shortcuts for the inline editor
    <div
      className="flex h-7 items-center px-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onCancel?.();
        }

        if (e.key === 'Enter') {
          onCommit?.();
        }
      }}
    >
      <Stars
        value={value}
        size="size-4"
        onPick={
          disabled
            ? undefined
            : (next) => {
                onChange(next);

                if (mode === 'inline') {
                  queueMicrotask(() => onCommit?.());
                }
              }
        }
      />
    </div>
  ),
  filter: { operators: ['eq', 'gte', 'lte', 'is_empty', 'is_not_empty'] },
  sortable: true,
  groupable: false,
  searchable: false,
  toText: (value) => (value === null || value === undefined ? '' : `${value}/${MAX}`),
});
