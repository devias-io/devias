import { z } from 'zod';
import { cleanRichText, type RichTextDoc, richTextProblem } from '../rich-text';

/**
 * Built-in field types. Modules may register more through `defineFieldType`; the engine treats
 * unknown types as opaque JSON and the studio renders them with a fallback.
 */
export const BUILTIN_FIELD_TYPES = [
  'text',
  'number',
  'money',
  'currency',
  'boolean',
  'date',
  'date_time',
  'select',
  'multi_select',
  'email',
  'phone',
  'url',
  'relation',
  'member',
  'rich_text',
  'json',
] as const;

export type BuiltinFieldType = (typeof BUILTIN_FIELD_TYPES)[number];
export type FieldType = BuiltinFieldType | (string & {});

export const FILTER_OPS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
  'any_of',
  'all_of',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const FilterOpSchema = z.enum(FILTER_OPS).meta({ id: 'FilterOp' });

export const SelectOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

export const RelationSettingsSchema = z.object({
  relationType: z.literal('many_to_one'),
  /** Id of the target object. */
  targetObjectId: z.string().min(1),
  /** The heading of the target object's related-records tab for the virtual inverse (one-to-many) side. */
  inverseLabel: z.string().optional(),
  /** `cascade`: deleting the target record deletes the records whose relation points at it. Left out, they stay. */
  onDelete: z.literal('cascade').optional(),
});
export type RelationSettings = z.infer<typeof RelationSettingsSchema>;

/** Per-type settings schemas. Unknown types accept any object. */
export const FIELD_SETTINGS_SCHEMAS: Record<BuiltinFieldType, z.ZodType<Record<string, unknown>>> = {
  text: z.object({ multiline: z.boolean().optional(), maxLength: z.number().int().positive().optional() }),
  number: z.object({
    precision: z.number().int().min(0).max(10).optional(),
    format: z.enum(['plain', 'percent']).optional(),
  }),
  money: z.object({ currencyCode: z.string().length(3).optional(), currencyFieldId: z.string().optional() }),
  // A three-letter ISO 4217 code (`EUR`): what a `money` field's `currencyFieldId` points at.
  currency: z.object({}),
  boolean: z.object({}),
  date: z.object({}),
  date_time: z.object({}),
  select: z.object({ options: z.array(SelectOptionSchema).min(1) }),
  multi_select: z.object({ options: z.array(SelectOptionSchema).min(1) }),
  email: z.object({}),
  phone: z.object({}),
  // `image`: the link is a picture of the record (a logo, a photo); tables draw it beside the name.
  url: z.object({ image: z.boolean().optional() }),
  relation: RelationSettingsSchema,
  member: z.object({}),
  rich_text: z.object({}),
  json: z.object({}),
};

const TEXT_OPS: FilterOp[] = ['eq', 'neq', 'contains', 'starts_with', 'in', 'not_in', 'is_empty', 'is_not_empty'];
const RANGE_OPS: FilterOp[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'between', 'is_empty', 'is_not_empty'];

export const FIELD_TYPE_OPS: Record<BuiltinFieldType, FilterOp[]> = {
  text: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  url: TEXT_OPS,
  number: [...RANGE_OPS, 'in'],
  money: [...RANGE_OPS, 'in'],
  boolean: ['eq', 'is_empty', 'is_not_empty'],
  date: RANGE_OPS,
  date_time: RANGE_OPS,
  select: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  currency: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi_select: ['any_of', 'all_of', 'is_empty', 'is_not_empty'],
  relation: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  member: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  /** Tiptap JSON: searched as JSON text (to find the records a document mentions) or tested for emptiness. */
  rich_text: ['contains', 'is_empty', 'is_not_empty'],
  json: ['is_empty', 'is_not_empty'],
};

export const SYSTEM_FIELD_OPS: Record<string, FilterOp[]> = {
  id: ['eq', 'neq', 'in', 'not_in'],
  created_at: RANGE_OPS,
  updated_at: RANGE_OPS,
};

export const SORTABLE_FIELD_TYPES = new Set<string>([
  'text',
  'email',
  'phone',
  'url',
  'number',
  'money',
  'currency',
  'boolean',
  'date',
  'date_time',
  'select',
]);
export const GROUPABLE_FIELD_TYPES = new Set<string>(['select', 'boolean']);
export const SEARCHABLE_FIELD_TYPES = new Set<string>(['text', 'email', 'phone', 'url']);

export const isBuiltinFieldType = (type: string): type is BuiltinFieldType =>
  (BUILTIN_FIELD_TYPES as readonly string[]).includes(type);

/** Module field types store arbitrary JSON: they can be tested for emptiness or searched as JSON text. */
export const CUSTOM_FIELD_TYPE_OPS: FilterOp[] = ['contains', 'is_empty', 'is_not_empty'];

export const opsForFieldType = (type: string): FilterOp[] =>
  isBuiltinFieldType(type) ? FIELD_TYPE_OPS[type] : CUSTOM_FIELD_TYPE_OPS;

export const settingsSchemaForFieldType = (type: string): z.ZodType<Record<string, unknown>> =>
  isBuiltinFieldType(type) ? FIELD_SETTINGS_SCHEMAS[type] : z.record(z.string(), z.unknown());

export interface ValueSchemaField {
  type: string;
  /** The field's API name, for messages. */
  name?: string | undefined;
  settings?: Record<string, unknown> | undefined;
  isRequired?: boolean | undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A web address as people type it: `acme.com`, `www.acme.com/about` or `https://acme.com`. The scheme is optional (and
 * is https when missing), only http and https are accepted, and the host needs a dot (or be `localhost`), so a bare
 * word is not an address. Returns the parsed address, or null when the value is not one.
 */
export const parseWebAddress = (value: string): URL | null => {
  const text = value.trim();

  if (!text || /\s/.test(text)) {
    return null;
  }

  const explicit = /^[a-z][a-z\d+.-]*:\/\//i.test(text);

  // `mailto:`, `tel:`, `javascript:`: another kind of link. `acme.com:8080` is a port, not a scheme.
  if (!explicit && /^[a-z][a-z\d+.-]*:(?!\d)/i.test(text)) {
    return null;
  }

  try {
    const url = new URL(explicit ? text : `https://${text}`);
    const web = url.protocol === 'http:' || url.protocol === 'https:';
    const bare = !url.username && !url.password;

    return web && bare && (url.hostname.includes('.') || url.hostname === 'localhost') ? url : null;
  } catch {
    return null;
  }
};

/**
 * Zod schema for one field's value, derived from its metadata. The engine and the studio share this so
 * validation is identical on both sides. Unknown types accept anything.
 */
export const valueSchemaForField = (field: ValueSchemaField): z.ZodType<unknown> => {
  const settings = field.settings ?? {};
  let schema: z.ZodType<unknown>;

  switch (field.type) {
    case 'text':
    case 'phone':
      schema = z.string();
      break;
    case 'email':
      schema = z.string().trim().toLowerCase().pipe(z.email());
      break;
    case 'url':
      schema = z
        .string()
        .trim()
        .refine((v) => parseWebAddress(v) !== null, 'Invalid URL');
      break;
    case 'number':
    case 'money':
      schema = z.number().finite();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'date':
      schema = z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD');
      break;
    case 'date_time':
      schema = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
      break;
    case 'select': {
      const options = (settings as { options?: SelectOption[] }).options ?? [];
      const values = options.map((o) => o.value);
      schema = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
      break;
    }
    case 'multi_select': {
      const options = (settings as { options?: SelectOption[] }).options ?? [];
      const values = options.map((o) => o.value);
      const item = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
      schema = z.array(item);
      break;
    }
    case 'currency':
      schema = z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/, 'Expected a currency code like EUR');
      break;
    case 'relation':
    case 'member':
      schema = z.string().min(1);
      break;
    case 'json':
      schema = z.unknown();
      break;
    case 'rich_text': {
      const name = field.name ? `Field ${field.name} is` : 'A rich-text field is';
      // The editor's document, checked (shape, size, depth) and without links it may not carry. Text is not
      // guessed at: a script that has Markdown converts it first, and the message says how.
      schema = z.unknown().transform((value, ctx) => {
        const problem =
          typeof value === 'string'
            ? `${name} rich text: send an editor document. To write Markdown, convert it with markdownToRichText from @devias/core`
            : richTextProblem(value);

        if (problem) {
          ctx.addIssue({ code: 'custom', message: problem });

          return z.NEVER;
        }

        return cleanRichText(value as RichTextDoc);
      });
      break;
    }
    default:
      schema = z.unknown();
  }

  return field.isRequired ? schema : schema.nullable();
};
