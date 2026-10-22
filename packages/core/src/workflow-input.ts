import type { z } from 'zod';
import { coreIds } from './core-ids';
import { isRichTextDoc } from './rich-text';
import { richTextToMarkdown } from './rich-text-markdown';
import { richTextValuesFromText } from './rich-text-values';

type FieldLike = { name: string; type: string };
type Values = Record<string, unknown>;

const isRecord = (value: unknown): value is Values =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A record-writing step's input with the text written to rich-text fields read as Markdown, the way an agent's is.
 * A step author writes `values: { notes: "Met **Ada**" }`, or a template that fills a longer string, and gets a
 * document; a value that is already a document (a whole template copied from another rich-text field) is kept
 * exactly. `fieldsOf` gives the fields of an object by its API name; other actions are returned as they are.
 */
export const richTextStepInput = (
  actionId: string,
  input: unknown,
  fieldsOf: (object: string) => readonly FieldLike[],
): unknown => {
  if (!isRecord(input) || typeof input.object !== 'string') {
    return input;
  }

  const fields = fieldsOf(input.object);
  const convert = (values: unknown): unknown => (isRecord(values) ? richTextValuesFromText(fields, values) : values);

  switch (actionId) {
    case coreIds.actions.create_record:
    case coreIds.actions.update_record:
    case coreIds.actions.upsert_record:
      return { ...input, values: convert(input.values) };
    case coreIds.actions.batch_write_records:
      return {
        ...input,
        ...(Array.isArray(input.create) ? { create: input.create.map(convert) } : {}),
        ...(Array.isArray(input.update)
          ? {
              update: input.update.map((one: unknown) => (isRecord(one) ? { ...one, patch: convert(one.patch) } : one)),
            }
          : {}),
      };
    default:
      return input;
  }
};

/** Whether the schema of an input property takes text (looking through optional, nullable and default). */
const takesText = (schema: z.ZodType | undefined): boolean => {
  let current: unknown = schema;

  for (let depth = 0; depth < 8 && current; depth++) {
    const def = (current as { _zod?: { def?: { type?: string; innerType?: unknown } } })._zod?.def;

    if (def?.type === 'string') {
      return true;
    }

    if (def?.type === 'optional' || def?.type === 'nullable' || def?.type === 'default' || def?.type === 'prefault') {
      current = def.innerType;
      continue;
    }

    return false;
  }

  return false;
};

/**
 * A step's input with each document turned into Markdown where the action wants text: a notification's `body`, a
 * module action's text field. Only the input's own properties are looked at, and only a document is changed, so a
 * value that is exactly one template (and so kept its type) can still be copied between rich-text fields.
 */
export const textStepInput = (input: unknown, schema: z.ZodObject | undefined): unknown => {
  if (!schema || !isRecord(input)) {
    return input;
  }

  const shape = schema.shape as Record<string, z.ZodType | undefined>;

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      isRichTextDoc(value) && takesText(shape[key]) ? richTextToMarkdown(value) : value,
    ]),
  );
};
