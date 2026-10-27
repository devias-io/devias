import type { RecordData } from '../query/ir';

/**
 * Maps field type keys to TypeScript value types so `InferRecord<typeof person>` works without codegen.
 * Modules add their own types by augmenting this interface:
 *
 *   declare module '@devias/core' { interface FieldValueMap { rating: number } }
 */
export interface FieldValueMap {
  text: string;
  number: number;
  currency: number;
  boolean: boolean;
  date: string;
  date_time: string;
  select: string;
  multi_select: string[];
  email: string;
  phone: string;
  url: string;
  relation: string;
  json: unknown;
}

export type FieldValue<T extends string> = T extends keyof FieldValueMap ? FieldValueMap[T] : unknown;

type FieldLike = { readonly name: string; readonly type: string; readonly isRequired?: boolean | undefined };

/** Record type inferred from an object definition's `fields` tuple. */
export type InferRecordFromFields<F extends readonly FieldLike[]> = RecordData & {
  [K in F[number] as K['name']]: K extends { isRequired: true } ? FieldValue<K['type']> : FieldValue<K['type']> | null;
};

export type InferRecord<T extends { readonly fields: readonly FieldLike[] }> = InferRecordFromFields<T['fields']>;
