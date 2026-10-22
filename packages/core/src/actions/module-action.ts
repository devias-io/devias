import { z } from 'zod';
import { CORE_OWNER } from '../ids';
import { keyOfId, ownerOfId } from '../manifest/entities';
import type { ActionDefinition, ActionOutputField } from '../module-runtime';
import { type AnyActionSpec, defineActionSpec } from './define';

/** The model-facing name of a module's action: `<module>__<action>`, hyphens as underscores. */
export const namespacedToolName = (moduleId: string, name: string): string => `${moduleId.replace(/-/g, '_')}__${name}`;

/**
 * The name the model calls a tool by, from its id: a core tool is `core.list_records` and is called `list_records`, a
 * module's tool is its action, `crm.recalculate_quote`, called `crm__recalculate_quote`.
 */
export const toolNameOfId = (id: string): string =>
  ownerOfId(id) === CORE_OWNER ? keyOfId(id) : namespacedToolName(ownerOfId(id), keyOfId(id));

/** What an action returns, one field at a time: `id (text): the quote id; total (number): …`. */
export const describeOutput = (output: readonly ActionOutputField[]): string =>
  output
    .map(
      (field) =>
        `${field.name} (${field.type === 'record' ? `the id of a record of ${field.objectId}` : field.type})${field.description ? `: ${field.description}` : ''}`,
    )
    .join('; ');

/** An action's declaration as the model reads it: what it does, what it takes and what it returns. */
const describeForModel = (moduleName: string, action: ActionDefinition, connects: boolean): string => {
  const fields = action.input
    .map(
      (field) =>
        `${field.name}${field.required ? ' (required)' : ''}: ${field.label}${field.type === 'record' ? ` (the id of a record of ${field.objectId})` : ''}${field.help ? `. ${field.help}` : ''}`,
    )
    .join('; ');

  return [
    `${moduleName}: ${action.description ?? action.label}`,
    fields ? `Input: ${fields}.` : '',
    action.output.length > 0 ? `Returns ${describeOutput(action.output)}.` : '',
    connects
      ? `It uses the person's own ${moduleName} connection, else the workspace's; pass connectionId (from list_connections) to choose another.`
      : '',
    'Runs now, outside any workflow; pass literal values, templates are not rendered here.',
  ]
    .filter(Boolean)
    .join(' ');
};

/** The input key that picks which of a module's connections an action uses; the runtime takes it off the input. */
export const CONNECTION_ID_INPUT = 'connectionId';

/**
 * An action a module declares, as a spec like core's: `<module>.<action>`, with a route of its own and a tool,
 * run with `module.run` and approved as declared. `input` is the schema its handler validates with; a module with
 * connections also takes an optional `connectionId`, for callers and workflow steps that pick one.
 */
export const moduleActionSpec = (
  module: { id: string; name: string; connections?: readonly unknown[] },
  action: ActionDefinition,
  input: z.ZodType,
): AnyActionSpec => {
  const connects = (module.connections?.length ?? 0) > 0;
  const body =
    connects && input instanceof z.ZodObject
      ? input.extend({
          [CONNECTION_ID_INPUT]: z.string().optional().describe('The connection to use, from list_connections'),
        })
      : input;

  return defineActionSpec({
    id: action.id,
    summary: action.label,
    ...(action.description ? { description: action.description } : {}),
    tags: ['modules'],
    permission: 'module.run',
    approval: action.approval,
    externalContent: action.external,
    ...(body instanceof z.ZodObject ? { body } : { body, bodyField: 'input' }),
    output: z.unknown(),
    ai: {
      tool: namespacedToolName(module.id, keyOfId(action.id)),
      description: describeForModel(module.name, action, connects),
    },
    http: {
      method: 'post',
      path: `/api/workspaces/{workspaceId}/modules/${module.id}/actions/${keyOfId(action.id)}`,
      bodyDescription: `The input of ${action.label}`,
      outputDescription:
        action.output.length > 0 ? `What it returns: ${describeOutput(action.output)}` : 'What the action returned',
    },
  }) as AnyActionSpec;
};
