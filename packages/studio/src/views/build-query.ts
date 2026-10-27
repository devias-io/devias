import {
  type FieldMetadata,
  type FieldTypeDefinition,
  type ObjectMetadata,
  type Query,
  SORTABLE_FIELD_TYPES,
  type ViewState,
} from '@devias/core';

const SYSTEM_SORTABLE = new Set(['id', 'created_at', 'updated_at']);

/**
 * ViewState → Query IR. `state.filter` is the effective filter (it starts as the saved view's filter and
 * carries the user's local edits), so no extra AND with the saved filter is needed here. Relation fields
 * shown as columns are `include`d so views get their related records in one round trip.
 */
export const buildQuery = (
  object: ObjectMetadata,
  state: ViewState,
  fieldTypes: Map<string, FieldTypeDefinition>,
  fields: FieldMetadata[],
  options: { limit?: number; count?: boolean } = {},
): Query => {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const include: Record<string, true> = {};

  for (const column of state.fields) {
    if (!column.visible) {
      continue;
    }

    const field = byName.get(column.name);

    if (field?.type === 'relation') {
      include[column.name] = true;
    }
  }

  const isSortable = (name: string): boolean => {
    const field = byName.get(name);

    if (!field) {
      return SYSTEM_SORTABLE.has(name);
    }

    const type = fieldTypes.get(field.type);

    return type ? (type.sortable ?? SORTABLE_FIELD_TYPES.has(field.type)) : SORTABLE_FIELD_TYPES.has(field.type);
  };
  const sort = state.sorts.filter((s) => isSortable(s.field));
  const search = state.search.trim();

  return {
    object: object.nameSingular,
    ...(state.filter ? { filter: state.filter } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    ...(search ? { search } : {}),
    ...(Object.keys(include).length > 0 ? { include } : {}),
    limit: options.limit ?? 50,
    ...(options.count === false ? {} : { count: true }),
  };
};
