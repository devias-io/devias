import {
  type FieldMetadata,
  type FieldTypeDefinition,
  type Filter,
  type FilterCondition,
  type FilterOp,
  isCondition,
} from '@devias/core';

export const OP_LABELS: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  not_in: 'is none of',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  between: 'between',
  contains: 'contains',
  starts_with: 'starts with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  any_of: 'has any of',
  all_of: 'has all of',
};

/** A chip: either an editable condition or an opaque nested group ("advanced"). */
export type FilterChip = { kind: 'condition'; condition: FilterCondition } | { kind: 'advanced'; filter: Filter };

/** Top-level conditions of a filter (a single condition or an AND list); anything else is one advanced chip. */
export const chipsOf = (filter: Filter | undefined): FilterChip[] => {
  if (!filter) {
    return [];
  }

  if (isCondition(filter)) {
    return [{ kind: 'condition', condition: filter }];
  }

  if ('and' in filter) {
    return filter.and.map((f) =>
      isCondition(f) ? { kind: 'condition', condition: f } : { kind: 'advanced', filter: f },
    );
  }

  return [{ kind: 'advanced', filter }];
};

export const filterOfChips = (chips: FilterChip[]): Filter | undefined => {
  const parts = chips.map((c) => (c.kind === 'condition' ? c.condition : c.filter));

  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return { and: parts };
};

/** What a condition compares against, as text ("Sent", "10 and 20"); `null` for conditions without a value. */
export const describeValue = (
  condition: FilterCondition,
  field: FieldMetadata | undefined,
  fieldType: FieldTypeDefinition | undefined,
): string | null => {
  if (condition.op === 'is_empty' || condition.op === 'is_not_empty') {
    return null;
  }

  const text = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '…';
    }

    if (Array.isArray(value)) {
      return value.map((v) => text(v)).join(', ');
    }

    if (field && fieldType && typeof value !== 'boolean') {
      const shown = fieldType.toText(value, field as FieldMetadata & { settings: Record<string, unknown> });

      if (shown) {
        return shown;
      }
    }

    return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  };

  if (condition.op === 'between' && Array.isArray(condition.value)) {
    return `${text(condition.value[0])} and ${text(condition.value[1])}`;
  }

  return text(condition.value);
};

export const describeCondition = (
  condition: FilterCondition,
  field: FieldMetadata | undefined,
  fieldType: FieldTypeDefinition | undefined,
): string => {
  const label = field?.label ?? condition.field;
  const op = OP_LABELS[condition.op] ?? condition.op;
  const value = describeValue(condition, field, fieldType);

  return value === null ? `${label} ${op}` : `${label} ${op} ${value}`;
};
