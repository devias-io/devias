import { API_NAME_PATTERN, type FieldMetadata } from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';

/**
 * SQL expressions over the `record` row alias `r`. Only metadata-validated API names are ever inlined
 * (they match /^[a-z][a-z0-9_]{0,62}$/); every value is a bound parameter.
 */

export type FieldRef =
  | { kind: 'system'; name: 'id' | 'created_at' | 'updated_at' }
  | { kind: 'field'; field: FieldMetadata };

export type ValueCast = 'uuid' | 'timestamptz' | 'date' | 'numeric' | 'boolean' | 'text' | 'jsonb';

const TEXT_TYPES = new Set(['text', 'email', 'phone', 'url', 'select', 'currency', 'relation', 'member']);

export const resolveFieldRef = (fieldsByName: Map<string, FieldMetadata>, name: string): FieldRef | undefined => {
  if (name === 'id' || name === 'created_at' || name === 'updated_at') {
    return { kind: 'system', name };
  }

  const field = fieldsByName.get(name);

  return field ? { kind: 'field', field } : undefined;
};

const assertName = (name: string): string => {
  if (!API_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to inline field name "${name}"`);
  }

  return name;
};

/** `r.data->>'name'` — text projection of a field. */
export const jsonText = (name: string): SQL => sql.raw(`r.data->>'${assertName(name)}'`);
/** `r.data->'name'` — jsonb projection of a field. */
export const jsonValue = (name: string): SQL => sql.raw(`r.data->'${assertName(name)}'`);
/** `NULLIF(r.data->>'name', '')` — text projection where the empty string counts as empty, like core. */
export const jsonTextNonEmpty = (name: string): SQL => sql.raw(`NULLIF(r.data->>'${assertName(name)}', '')`);

export const castFor = (ref: FieldRef): ValueCast => {
  if (ref.kind === 'system') {
    return ref.name === 'id' ? 'uuid' : 'timestamptz';
  }

  switch (ref.field.type) {
    case 'number':
    case 'money':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'date_time':
      return 'timestamptz';
    case 'multi_select':
    case 'json':
      return 'jsonb';
    default:
      return TEXT_TYPES.has(ref.field.type) ? 'text' : 'jsonb';
  }
};

export const isTextLike = (ref: FieldRef): boolean => ref.kind === 'field' && TEXT_TYPES.has(ref.field.type);

/** Typed expression used for comparisons and sorting. */
export const valueExpr = (ref: FieldRef): SQL => {
  if (ref.kind === 'system') {
    if (ref.name === 'id') {
      return sql.raw('r.id');
    }

    return sql.raw(ref.name === 'created_at' ? 'r.created_at' : 'r.updated_at');
  }

  const name = ref.field.name;

  switch (castFor(ref)) {
    case 'numeric':
      return sql`(${jsonText(name)})::numeric`;
    case 'boolean':
      return sql`(${jsonText(name)})::boolean`;
    case 'date':
      return sql`(${jsonText(name)})::date`;
    case 'timestamptz':
      return sql`(${jsonText(name)})::timestamptz`;
    case 'jsonb':
      return jsonValue(name);
    default:
      return jsonText(name);
  }
};

/** Sort expression: text-like fields sort with the "C" collation so ordering matches core's `sortRecords`. */
export const sortExpr = (ref: FieldRef): SQL => {
  if (ref.kind === 'system') {
    return valueExpr(ref);
  }

  if (castFor(ref) === 'text') {
    return sql`${jsonTextNonEmpty(ref.field.name)} COLLATE "C"`;
  }

  return valueExpr(ref);
};

/** A bound parameter with the cast the expression expects. */
export const typedParam = (value: unknown, cast: ValueCast): SQL => {
  switch (cast) {
    case 'uuid':
      return sql`${value}::uuid`;
    case 'timestamptz':
      return sql`${value}::timestamptz`;
    case 'date':
      return sql`${value}::date`;
    case 'numeric':
      return sql`${value}::numeric`;
    case 'boolean':
      return sql`${value}::boolean`;
    case 'jsonb':
      return sql`${typeof value === 'string' ? value : JSON.stringify(value)}::jsonb`;
    default:
      return sql`${value}`;
  }
};

/** A JSON array parameter expanded to a set of typed scalars: `(SELECT (x)::cast FROM jsonb_array_elements_text($1::jsonb) x)`. */
export const jsonArrayElements = (values: unknown[], cast: ValueCast): SQL => {
  const elements = sql`jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)`;

  switch (cast) {
    case 'uuid':
      return sql`(SELECT (x)::uuid FROM ${elements} x)`;
    case 'timestamptz':
      return sql`(SELECT (x)::timestamptz FROM ${elements} x)`;
    case 'date':
      return sql`(SELECT (x)::date FROM ${elements} x)`;
    case 'numeric':
      return sql`(SELECT (x)::numeric FROM ${elements} x)`;
    case 'boolean':
      return sql`(SELECT (x)::boolean FROM ${elements} x)`;
    default:
      return sql`(SELECT x FROM ${elements} x)`;
  }
};

/** `ARRAY(SELECT jsonb_array_elements_text($1::jsonb))` — a text[] built from a JSON array parameter. */
export const jsonTextArray = (values: string[]): SQL =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (m) => `\\${m}`);
