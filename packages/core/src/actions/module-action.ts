import { z } from 'zod';
import type { ActionDefinition, ActionOutputField } from '../module-runtime';
import { type AnyActionSpec, defineActionSpec } from './define';

/**
 * The name the model calls a module's action by, from the manifest that declares it: the action's `name`, which is its
 * tool and the end of its route. It is unique across what a server offers as tools, so no module is in front of it.
 */
export const toolNameOfAction = (
  manifest: { actions: readonly Pick<ActionDefinition, 'id' | 'name'>[] },
  id: string,
): string => {
  const action = manifest.actions.find((candidate) => candidate.id === id);

  if (!action) {
    throw new Error(`The manifest declares no action "${id}"`);
  }

  return action.name;
};

/** What an action returns, one field at a time: `id (text): the quote id; total (number): …`. */
export const describeOutput = (output: readonly ActionOutputField[]): string =>
  output
    .map(
      (field) =>
        `${field.name} (${field.type === 'record' ? `the id of a record of ${field.objectId}` : field.type})${field.description ? `: ${field.description}` : ''}`,
    )
    .join('; ');

/** An action's declaration as the model reads it: what it does, what it takes and what it returns. */
const describeForModel = (moduleLabel: string, action: ActionDefinition, connects: boolean): string => {
  const fields = action.input
    .map(
      (field) =>
        `${field.name}${field.required ? ' (required)' : ''}: ${field.label}${field.type === 'record' ? ` (the id of a record of ${field.objectId})` : ''}${field.help ? `. ${field.help}` : ''}`,
    )
    .join('; ');

  return [
    `${moduleLabel}: ${action.description ?? action.label}`,
    fields ? `Input: ${fields}.` : '',
    action.output.length > 0 ? `Returns ${describeOutput(action.output)}.` : '',
    connects
      ? `It uses the person's own ${moduleLabel} connection, else the workspace's; pass connectionId (from list_connections) to choose another.`
      : '',
    'Runs now, outside any workflow; pass literal values, templates are not rendered here.',
  ]
    .filter(Boolean)
    .join(' ');
};

/** The input key that picks which of a module's connections an action uses; the runtime takes it off the input. */
export const CONNECTION_ID_INPUT = 'connectionId';

/**
 * An action a module declares, as a spec like core's: its id as declared, with a route and a tool called by its
 * `name`, run with `module.run` and approved as declared. `input` is the schema its handler validates with; a module with
 * connections also takes an optional `connectionId`, for callers and workflow steps that pick one.
 */
export const moduleActionSpec = (
  module: { id: string; label: string; connections?: readonly unknown[] },
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
    module: module.id,
    summary: action.label,
    ...(action.description ? { description: action.description } : {}),
    tags: ['modules'],
    permission: 'module.run',
    approval: action.approval,
    externalContent: action.external,
    ...(body instanceof z.ZodObject ? { body } : { body, bodyField: 'input' }),
    output: z.unknown(),
    ai: {
      tool: action.name,
      description: describeForModel(module.label, action, connects),
    },
    http: {
      method: 'post',
      path: `/api/workspaces/{workspaceId}/modules/${module.id}/actions/${action.name}`,
      bodyDescription: `The input of ${action.label}`,
      outputDescription:
        action.output.length > 0 ? `What it returns: ${describeOutput(action.output)}` : 'What the action returned',
    },
  }) as AnyActionSpec;
};
