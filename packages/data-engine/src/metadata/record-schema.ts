import { type FieldMetadata, valueSchemaForField } from '@devias/core';
import { z } from 'zod';

/**
 * Zod object schemas for one object's records, derived from field metadata:
 * - `create`: required fields must be present unless they carry a default; defaults are applied;
 *   optional fields accept null or may be omitted.
 * - `update`: every key optional; required fields still reject null.
 * Unknown keys are rejected by both.
 */
export interface RecordSchemas {
  create: z.ZodType<Record<string, unknown>>;
  update: z.ZodType<Record<string, unknown>>;
}

export const buildRecordSchemas = (fields: FieldMetadata[]): RecordSchemas => {
  const createShape: Record<string, z.ZodType<unknown>> = {};
  const updateShape: Record<string, z.ZodType<unknown>> = {};

  for (const field of fields) {
    const base = valueSchemaForField(field);
    let create: z.ZodType<unknown> = field.isRequired ? base : base.optional();

    if (field.defaultValue !== undefined) {
      create = create.default(field.defaultValue);
    }

    createShape[field.name] = create;
    updateShape[field.name] = base.optional();
  }

  return {
    create: z.strictObject(createShape) as unknown as z.ZodType<Record<string, unknown>>,
    update: z.strictObject(updateShape) as unknown as z.ZodType<Record<string, unknown>>,
  };
};

/** Cache keyed by object id and metadata version so schemas are rebuilt only when metadata changes. */
export class RecordSchemaCache {
  private readonly entries = new Map<string, RecordSchemas>();

  get(objectId: string, version: number, fields: FieldMetadata[]): RecordSchemas {
    const key = `${objectId}:${version}`;
    const cached = this.entries.get(key);

    if (cached) {
      return cached;
    }

    if (this.entries.size > 500) {
      this.entries.clear();
    }

    const built = buildRecordSchemas(fields);
    this.entries.set(key, built);

    return built;
  }
}
