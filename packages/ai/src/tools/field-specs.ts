import {
  API_NAME_PATTERN,
  BUILTIN_FIELD_TYPES,
  type FieldInput,
  type FieldMetadata,
  markdownToRichText,
  type ObjectMetadata,
  RESERVED_FIELD_NAMES,
  type SchemaIndex,
  type SelectOption,
} from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { z } from 'zod';
import { resolveField, resolveObject } from './helpers';

export const ApiName = z
  .string()
  .regex(API_NAME_PATTERN, 'lowercase letters, digits and underscores, starting with a letter');

export const OptionSchema = z.object({
  value: z.string().min(1).describe('Stored value, e.g. "in_progress"'),
  label: z.string().min(1),
  color: z.string().optional().describe('neutral, blue, purple, orange, green, red, ...'),
});

export const FieldSpecSchema = z.object({
  name: ApiName.describe('Field API name in lowercase with underscores, e.g. lead_score'),
  type: z
    .string()
    .min(1)
    .describe(`One of ${BUILTIN_FIELD_TYPES.join(', ')} (modules may add more)`),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  options: z.array(OptionSchema).optional().describe('For select and multi_select fields'),
  relationTarget: z.string().optional().describe('For relation fields: the target object API name'),
  defaultValue: z.unknown().optional(),
  multiline: z.boolean().optional().describe('For text fields: a long text area'),
  currencyCode: z.string().length(3).optional().describe('For money fields: the currency of every amount, e.g. EUR'),
  currencyField: z
    .string()
    .optional()
    .describe("For money fields: the currency field of the same object that holds each record's own code"),
  precision: z.number().int().min(0).max(10).optional().describe('For number fields: decimal places'),
  image: z
    .boolean()
    .optional()
    .describe('For url fields: the link is a picture of the record (a logo, a photo); tables draw it beside the name'),
});
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

/** The object a field belongs to: one that exists, or one being made along with its fields (named by its API name). */
export type FieldOwner = ObjectMetadata | { pending: true; nameSingular: string; labelPlural: string };

const settingsFor = (index: SchemaIndex, owner: FieldOwner, spec: FieldSpec): Record<string, unknown> => {
  switch (spec.type) {
    case 'select':
    case 'multi_select': {
      if (!spec.options?.length) {
        throw new EngineError('VALIDATION', `Field "${spec.name}" is a ${spec.type} and needs at least one option`);
      }

      return { options: spec.options };
    }
    case 'relation': {
      if (!spec.relationTarget) {
        throw new EngineError('VALIDATION', `Field "${spec.name}" is a relation and needs relationTarget`);
      }

      // The object being made has no id yet: the engine reads its API name as the object.
      const target =
        'pending' in owner && spec.relationTarget === owner.nameSingular
          ? owner.nameSingular
          : resolveObject(index, spec.relationTarget).id;

      return { relationType: 'many_to_one', targetObjectId: target, inverseLabel: owner.labelPlural };
    }
    case 'text':
      return spec.multiline ? { multiline: true } : {};
    case 'money':
      return {
        ...(spec.currencyCode ? { currencyCode: spec.currencyCode.toUpperCase() } : {}),
        // Beside a new object's fields the engine reads the name as the earlier field of that name.
        ...(spec.currencyField
          ? {
              currencyFieldId:
                'pending' in owner ? spec.currencyField : resolveField(index, owner, spec.currencyField).id,
            }
          : {}),
      };
    case 'number':
      return spec.precision !== undefined ? { precision: spec.precision } : {};
    case 'url':
      return spec.image ? { image: true } : {};
    default:
      return {};
  }
};

export const fieldInput = (
  index: SchemaIndex,
  owner: FieldOwner,
  spec: FieldSpec,
  position: number,
): Omit<FieldInput, 'objectId'> => {
  if (RESERVED_FIELD_NAMES.has(spec.name)) {
    throw new EngineError('VALIDATION', `"${spec.name}" is a reserved field name`);
  }

  return {
    name: spec.name,
    type: spec.type,
    label: spec.label,
    ...(spec.description ? { description: spec.description } : {}),
    settings: settingsFor(index, owner, spec),
    ...(spec.required ? { isRequired: true } : {}),
    ...(spec.unique ? { isUnique: true } : {}),
    ...(spec.defaultValue !== undefined
      ? {
          // A rich-text default the model wrote is Markdown, like every other rich text it writes.
          defaultValue:
            spec.type === 'rich_text' && typeof spec.defaultValue === 'string'
              ? markdownToRichText(spec.defaultValue)
              : spec.defaultValue,
        }
      : {}),
    position,
  };
};

export interface FieldChanges {
  label?: string | undefined;
  description?: string | undefined;
  required?: boolean | undefined;
  addOptions?: SelectOption[] | undefined;
  removeOptions?: string[] | undefined;
  setOptions?: SelectOption[] | undefined;
  image?: boolean | undefined;
}

/** What a field edit asks for, as the field's own properties; empty when it asks for nothing. */
export const fieldPatch = (field: FieldMetadata, input: FieldChanges): Partial<FieldInput> => {
  const patch: Partial<FieldInput> = {};

  if (input.label !== undefined) {
    patch.label = input.label;
  }

  if (input.description !== undefined) {
    patch.description = input.description;
  }

  if (input.required !== undefined) {
    patch.isRequired = input.required;
  }

  if (input.addOptions || input.removeOptions || input.setOptions) {
    if (field.type !== 'select' && field.type !== 'multi_select') {
      throw new EngineError('VALIDATION', `Field "${field.name}" is a ${field.type}; only select fields have options`);
    }

    const current = ((field.settings as { options?: SelectOption[] }).options ?? []).slice();
    let options = input.setOptions ? [...input.setOptions] : current;

    if (input.removeOptions) {
      options = options.filter((o) => !input.removeOptions?.includes(o.value));
    }

    for (const option of input.addOptions ?? []) {
      if (!options.some((o) => o.value === option.value)) {
        options.push(option);
      }
    }

    if (options.length === 0) {
      throw new EngineError('VALIDATION', 'A select field needs at least one option');
    }

    patch.settings = { ...field.settings, options };
  }

  if (input.image !== undefined) {
    if (field.type !== 'url') {
      throw new EngineError('VALIDATION', `Field "${field.name}" is a ${field.type}; only url fields can be pictures`);
    }

    const { image: _image, ...rest } = field.settings as { image?: boolean };
    patch.settings = { ...(patch.settings ?? rest), ...(input.image ? { image: true } : {}) };
  }

  return patch;
};
