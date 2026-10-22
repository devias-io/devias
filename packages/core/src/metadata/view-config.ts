import { coreIds } from '../core-ids';
import type { Filter } from '../query/ir';
import type { FieldMetadata } from './schema';

/** The field a stored reference names: its id, or its API name (what the agent and the API may still write). */
export const fieldRef = (fields: readonly FieldMetadata[], ref: string | undefined): FieldMetadata | undefined =>
  ref === undefined ? undefined : (fields.find((f) => f.id === ref) ?? fields.find((f) => f.name === ref));

/** A filter with the `field` of every condition replaced, the rest of it as it was. */
export const mapFilterFields = (filter: Filter, replace: (field: string) => string): Filter => {
  if ('and' in filter) {
    return { and: filter.and.map((part) => mapFilterFields(part, replace)) };
  }

  if ('or' in filter) {
    return { or: filter.or.map((part) => mapFilterFields(part, replace)) };
  }

  if ('not' in filter) {
    return { not: mapFilterFields(filter.not, replace) };
  }

  return { ...filter, field: replace(filter.field) };
};

/** Every `field` a filter's conditions name. */
export const filterFieldRefs = (filter: Filter | undefined): string[] => {
  if (!filter) {
    return [];
  }

  if ('and' in filter) {
    return filter.and.flatMap(filterFieldRefs);
  }

  if ('or' in filter) {
    return filter.or.flatMap(filterFieldRefs);
  }

  if ('not' in filter) {
    return filterFieldRefs(filter.not);
  }

  return [filter.field];
};

/** The system columns of every object, by the name a record carries them under and the id a view stores them by. */
export const SYSTEM_FIELD_IDS: Readonly<Record<string, string>> = {
  id: coreIds.fields.id,
  created_at: coreIds.fields.created_at,
  updated_at: coreIds.fields.updated_at,
};

/** The id of a system column named by its name or its id; undefined for anything else. */
export const systemFieldId = (ref: string): string | undefined =>
  SYSTEM_FIELD_IDS[ref] ?? Object.values(SYSTEM_FIELD_IDS).find((id) => id === ref);

/** The name of a system column named by its id. */
export const systemFieldName = (ref: string): string | undefined =>
  Object.entries(SYSTEM_FIELD_IDS).find(([, id]) => id === ref)?.[0];

/** The API name a stored reference stands for: a field's, a system column's, else the reference as it is. */
export const fieldNameOf = (fields: readonly FieldMetadata[], ref: string): string =>
  fieldRef(fields, ref)?.name ?? systemFieldName(ref) ?? ref;

/** The id a name or id stands for: a field's, a system column's, else the reference as it is. */
export const fieldIdOf = (fields: readonly FieldMetadata[], ref: string): string =>
  fieldRef(fields, ref)?.id ?? systemFieldId(ref) ?? ref;
