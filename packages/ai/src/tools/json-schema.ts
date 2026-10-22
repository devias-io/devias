import { AI_TOOL_NAME_PATTERN } from '@devias/core';
import { z } from 'zod';

/** Zod input schema → the JSON schema the model API accepts (draft 2020-12, root object, no `$schema`). */
export const toInputSchema = (schema: z.ZodType): Record<string, unknown> => {
  let json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' }) as Record<
    string,
    unknown
  >;
  // A schema registered with an id comes out as `{ $ref: '#/$defs/<id>' }`: the model API wants the object itself at
  // the root, so inline it (its definition stays in $defs for anything that refers back to it).
  const root = typeof json.$ref === 'string' ? /^#\/\$defs\/(.+)$/.exec(json.$ref)?.[1] : undefined;
  const defs = json.$defs as Record<string, Record<string, unknown>> | undefined;

  if (root && defs?.[root]) {
    json = { ...defs[root], $defs: defs };
  }

  delete json.$schema;
  delete json.$id;

  if (json.type !== 'object') {
    throw new Error('Tool input schemas must describe an object');
  }

  return json;
};

export const assertToolName = (name: string): void => {
  if (!AI_TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`Tool name "${name}" must match ${AI_TOOL_NAME_PATTERN}`);
  }
};
