import {
  coreIds,
  FILTER_OPS,
  type FieldMetadata,
  type Filter,
  type FilterCondition,
  mapFilterFields,
  markdownLosses,
  type ObjectMetadata,
  type Page,
  primaryFieldOf,
  type RecordData,
  richTextToMarkdown,
  richTextValuesFromText,
  richTextValuesToText,
  type SchemaIndex,
  systemFieldName,
  type ViewMetadata,
} from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { z } from 'zod';
import type { AdapterContext } from './adapters/types';

/** Shared input shapes and lookups for the built-in tools. */

export const ConditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .describe(
      'Field API name, or one of id, createdAt, updatedAt. createdAt and updatedAt take an ISO date-time with an offset (2026-10-17T00:00:00Z); a plain date (2026-10-17) means the start of that day in UTC',
    ),
  op: z.enum(FILTER_OPS).describe('Comparison operator; which ones apply depends on the field type'),
  value: z
    .unknown()
    .optional()
    .describe('Comparison value; omit for is_empty and is_not_empty; [from, to] for between'),
});
export type ConditionInput = z.infer<typeof ConditionSchema>;

export const FilterInputSchema = z.object({
  all: z.array(ConditionSchema).optional().describe('Every condition must match (AND)'),
  any: z.array(ConditionSchema).optional().describe('At least one condition must match (OR)'),
});
export type FilterInput = z.infer<typeof FilterInputSchema>;

export const SortInputSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `createdAt` and `updatedAt` are compared as date-times with an offset, but a plain date is what people and models
 * write ("created today"), so it means the start of that day in UTC.
 */
const timestampValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(timestampValue)
    : typeof value === 'string' && DATE_ONLY.test(value)
      ? `${value}T00:00:00Z`
      : value;

const toCondition = (c: ConditionInput): FilterCondition => {
  const value = c.field === 'created_at' || c.field === 'updated_at' ? timestampValue(c.value) : c.value;

  return { field: c.field, op: c.op, ...(value !== undefined ? { value } : {}) };
};

/** The columns every record has besides its fields: they can be selected and sorted on like a field. */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set(['id', 'created_at', 'updated_at']);

export const toFilter = (input: FilterInput | undefined | null): Filter | undefined => {
  if (!input) {
    return undefined;
  }

  const all = (input.all ?? []).map(toCondition);
  const any = (input.any ?? []).map(toCondition);
  const parts: Filter[] = [];

  if (all.length === 1) {
    parts.push(all[0] as FilterCondition);
  } else if (all.length > 1) {
    parts.push({ and: all });
  }

  if (any.length === 1) {
    parts.push(any[0] as FilterCondition);
  } else if (any.length > 1) {
    parts.push({ or: any });
  }

  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return { and: parts };
};

const lower = (value: string | undefined) => value?.toLowerCase();

/** Objects may be referenced by API name (singular or plural), id, or label. */
export const resolveObject = (index: SchemaIndex, ref: string): ObjectMetadata => {
  const direct = index.objectsByName.get(ref) ?? index.objectsById.get(ref);

  if (direct) {
    return direct;
  }

  const needle = ref.trim().toLowerCase();
  const found = index.schema.objects.find(
    (o) =>
      lower(o.nameSingular) === needle ||
      lower(o.namePlural) === needle ||
      lower(o.labelSingular) === needle ||
      lower(o.labelPlural) === needle,
  );

  if (found) {
    return found;
  }

  const names = index.schema.objects.map((o) => o.nameSingular).join(', ');

  throw new EngineError('NOT_FOUND', `Unknown object "${ref}". Objects in this workspace: ${names}`);
};

export const fieldsOf = (index: SchemaIndex, object: ObjectMetadata): FieldMetadata[] =>
  index.fieldsByObjectId.get(object.id) ?? [];

/** Fields may be referenced by API name, id, or label. */
export const resolveField = (index: SchemaIndex, object: ObjectMetadata, ref: string): FieldMetadata => {
  const fields = fieldsOf(index, object);
  const needle = ref.trim().toLowerCase();
  const found =
    fields.find((f) => f.name === ref || f.id === ref) ??
    fields.find((f) => lower(f.name) === needle || lower(f.label) === needle);

  if (found) {
    return found;
  }

  throw new EngineError(
    'NOT_FOUND',
    `Unknown field "${ref}" on ${object.nameSingular}. Fields: ${fields.map((f) => f.name).join(', ')}`,
  );
};

export const viewsOf = (index: SchemaIndex, object: ObjectMetadata): ViewMetadata[] =>
  index.viewsByObjectId.get(object.id) ?? [];

/** Views may be referenced by id or by name. */
export const resolveView = (index: SchemaIndex, object: ObjectMetadata, ref: string): ViewMetadata => {
  const views = viewsOf(index, object);
  const needle = ref.trim().toLowerCase();
  const found = views.find((v) => v.id === ref) ?? views.find((v) => lower(v.label) === needle);

  if (found) {
    return found;
  }

  throw new EngineError(
    'NOT_FOUND',
    `Unknown view "${ref}" on ${object.nameSingular}. Views: ${views.map((v) => `${v.label} (${v.id})`).join(', ')}`,
  );
};

export const relationTargetOf = (index: SchemaIndex, field: FieldMetadata): ObjectMetadata | undefined => {
  const target = (field.settings as { targetObjectId?: unknown }).targetObjectId;

  return typeof target === 'string' ? index.objectsById.get(target) : undefined;
};

export const fieldSummary = (index: SchemaIndex, field: FieldMetadata) => {
  const options = (field.settings as { options?: { value: string; label: string }[] }).options;
  const target = field.type === 'relation' ? relationTargetOf(index, field) : undefined;

  return {
    name: field.name,
    type: field.type,
    label: field.label,
    ...(field.description ? { description: field.description } : {}),
    ...(field.isRequired ? { required: true } : {}),
    ...(field.isUnique ? { unique: true } : {}),
    ...(options ? { options: options.map((o) => o.value) } : {}),
    ...(field.type === 'rich_text' ? { format: 'markdown' } : {}),
    ...(field.type === 'url' && (field.settings as { image?: unknown }).image === true ? { image: true } : {}),
    ...(target ? { relationTarget: target.nameSingular } : {}),
    ...(field.defaultValue !== undefined && field.defaultValue !== null
      ? { defaultValue: field.type === 'rich_text' ? richTextToMarkdown(field.defaultValue) : field.defaultValue }
      : {}),
  };
};

export const objectSummary = (index: SchemaIndex, object: ObjectMetadata) => ({
  nameSingular: object.nameSingular,
  namePlural: object.namePlural,
  labelSingular: object.labelSingular,
  labelPlural: object.labelPlural,
  ...(object.description ? { description: object.description } : {}),
  /** The id of the field that names a record, which is what `update_object` takes; `describe_object` lists the fields with their ids. */
  primaryFieldId: primaryFieldOf(index, object)?.id ?? null,
  fieldCount: fieldsOf(index, object).length,
  viewCount: viewsOf(index, object).length,
  ...(object.readOnly ? { readOnly: true } : {}),
  ...(object.moduleId ? { module: object.moduleId } : {}),
});

/** A view as the agent reads it: the fields by API name, though the view stores their ids. */
export const viewSummary = (index: SchemaIndex, view: ViewMetadata) => {
  const nameOf = (ref: string) => index.fieldsById.get(ref)?.name ?? systemFieldName(ref) ?? ref;

  return {
    id: view.id,
    label: view.label,
    type: view.type,
    ...(view.isDefault ? { default: true } : {}),
    fields: view.config.fields.filter((f) => f.visible !== false).map((f) => nameOf(f.fieldId)),
    ...(view.config.filter ? { filter: mapFilterFields(view.config.filter, nameOf) } : {}),
    ...(view.config.sorts.length > 0
      ? { sorts: view.config.sorts.map((s) => ({ field: nameOf(s.fieldId), direction: s.direction })) }
      : {}),
    ...(view.config.groupById ? { groupBy: nameOf(view.config.groupById) } : {}),
  };
};

export const recordLabel = (index: SchemaIndex, object: ObjectMetadata, record: RecordData): string => {
  const field = primaryFieldOf(index, object);
  const value = field ? record[field.name] : undefined;

  if (value === null || value === undefined || value === '') {
    return record.id;
  }

  return typeof value === 'string' ? value : String(value);
};

/**
 * Values the model wrote, ready for the engine: Markdown text for a rich-text field becomes the editor's document.
 * This is where the agent's Markdown meets the stored form; the engine itself takes the document as it is.
 */
export const withRichText = (
  index: SchemaIndex,
  object: ObjectMetadata,
  values: Record<string, unknown>,
): Record<string, unknown> => richTextValuesFromText(fieldsOf(index, object), values);

/**
 * What a whole-text rewrite drops from the text it replaces, for the model: Markdown cannot carry everything the
 * editor can make, and what it cannot carry is lost from the new text. Null when nothing is lost.
 */
export const rewriteWarning = (what: string, current: unknown): string | null => {
  const losses = markdownLosses(current);

  return losses.length > 0
    ? `Rewriting the ${what} dropped ${losses.join(' and ')} from the earlier text, which Markdown cannot carry. The earlier text is in the history.`
    : null;
};

/** Warnings for a write of text to the rich-text fields of one record, read from what is stored there now. */
export const recordRewriteWarnings = async (
  context: AdapterContext,
  index: SchemaIndex,
  object: ObjectMetadata,
  id: string,
  written: Record<string, unknown>,
): Promise<string[]> => {
  const fields = fieldsOf(index, object).filter(
    (field) => field.type === 'rich_text' && typeof written[field.name] === 'string',
  );

  if (fields.length === 0) {
    return [];
  }

  let current: Record<string, unknown>;

  try {
    current = (await context.read(coreIds.actions.get_record, { object: object.nameSingular, id })) as Record<
      string,
      unknown
    >;
  } catch {
    // The write reports a record that is not there; a warning is not the place to.
    return [];
  }

  return fields.flatMap(
    (field) => rewriteWarning(`${field.label} of ${object.labelSingular}`, current[field.name]) ?? [],
  );
};

/** The result with its warnings, when there are any. */
export const withWarnings = <T extends object>(
  result: T,
  warnings: readonly string[],
): T | (T & { warnings: string[] }) => (warnings.length > 0 ? { ...result, warnings: [...warnings] } : result);

/** A record as the model sees it: id, label, field values, and labels of related records when included. */
export const shapeRecord = (
  index: SchemaIndex,
  object: ObjectMetadata,
  record: RecordData,
  included?: Page['included'],
) => {
  const { createdBy: _createdBy, updatedBy: _updatedBy, ...stored } = record;
  // Rich text is read as Markdown, the way it is written: the model never sees the editor's JSON.
  const rest = richTextValuesToText(fieldsOf(index, object), stored);

  const labels: Record<string, string> = {};

  if (included) {
    for (const field of fieldsOf(index, object)) {
      if (field.type !== 'relation') {
        continue;
      }

      const value = record[field.name];
      const target = relationTargetOf(index, field);

      if (typeof value !== 'string' || !target) {
        continue;
      }

      const related = included[field.name]?.find((r) => r.id === value);

      if (related) {
        labels[field.name] = recordLabel(index, target, related);
      }
    }
  }

  return {
    ...rest,
    label: recordLabel(index, object, record),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
  };
};

/** Turn a call away because of what it says, with a message the model can act on. */
export function refuse(message: string): never {
  throw new EngineError('VALIDATION', message);
}

/** Engine errors become structured error results the model can act on; anything else is rethrown. */
export const errorResult = (error: unknown): { error: { code: string; message: string; details?: unknown } } => {
  if (error instanceof EngineError) {
    return {
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    };
  }

  throw error;
};
