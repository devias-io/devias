import type { SelectOption } from '@devias/core';
import { Badge, cn } from '@devias/ui';
import { createContext, type KeyboardEvent, useContext } from 'react';

export const isEmptyValue = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/** Placeholder for an empty value; tables hide it (`data-slot="empty-value"`), forms and detail views show it. */
export const Empty = () => (
  <span data-slot="empty-value" className="text-muted-foreground">
    -
  </span>
);

/** Enter commits, Escape cancels; Shift+Enter is left alone for textareas. */
export const inlineKeyHandler =
  (onCommit?: () => void, onCancel?: () => void, { multiline = false } = {}) =>
  (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onCommit?.();
    }
  };

export const OPTION_COLORS: Record<string, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300/80',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300/80',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300/80',
  green: 'bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-300/80',
  red: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300/80',
  yellow: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-300/80',
  pink: 'bg-pink-50 text-pink-700 dark:bg-pink-400/10 dark:text-pink-300/80',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300/80',
};

/** The solid swatch of an option color, for dots and markers where the tinted badge would be too much. */
const OPTION_DOTS: Record<string, string> = {
  neutral: 'bg-neutral-400 dark:bg-neutral-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
};

export const optionDotClass = (color: string | undefined): string =>
  OPTION_DOTS[color ?? 'neutral'] ?? (OPTION_DOTS.neutral as string);

export const OPTION_COLOR_NAMES = Object.keys(OPTION_COLORS);

export const optionColorClass = (color: string | undefined): string =>
  OPTION_COLORS[color ?? 'neutral'] ?? (OPTION_COLORS.neutral as string);

/** Inside it, selected options are drawn in grey whatever their colour, where the colour would only add noise (the activity feed). */
export const PlainOptionsContext = createContext(false);

/**
 * A selected option: a soft pill in the option's colour (grey when it has none), without an outline, so it reads as a
 * label apart from the outlined Yes / No of a checkbox field.
 */
export const OptionBadge = ({ option, className }: { option: SelectOption; className?: string }) => {
  const plain = useContext(PlainOptionsContext);

  return (
    <Badge
      variant="outline"
      className={cn(
        'border-transparent px-2 font-normal',
        optionColorClass(plain ? undefined : option.color),
        className,
      )}
    >
      <span className="truncate">{option.label}</span>
    </Badge>
  );
};

/** An option as a row in a menu or list: plain text, without the pill. */
export const OptionLabel = ({ option, className }: { option: SelectOption; className?: string }) => (
  <span className={cn('min-w-0 truncate', className)}>{option.label}</span>
);

export const optionsOf = (settings: Record<string, unknown> | undefined): SelectOption[] => {
  const options = (settings as { options?: unknown } | undefined)?.options;

  return Array.isArray(options) ? (options as SelectOption[]) : [];
};

export const formatNumber = (value: number, settings: { precision?: number; format?: string } = {}): string => {
  const precision = settings.precision;
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision ?? 0,
    maximumFractionDigits: precision ?? 2,
  }).format(value);

  return settings.format === 'percent' ? `${formatted}%` : formatted;
};

export const formatCurrency = (value: number, currencyCode: string | undefined): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode ?? 'USD' }).format(value);
  } catch {
    return `${currencyCode ?? ''} ${formatNumber(value, { precision: 2 })}`.trim();
  }
};

export const parseNumberInput = (text: string): number | null => {
  const trimmed = text.trim();

  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed.replace(',', '.'));

  return Number.isFinite(parsed) ? parsed : null;
};

export const stopRowClick = (event: { stopPropagation: () => void }) => event.stopPropagation();
