import { type AnyActionSpec, areaOfAction, ESCALATING_PERMISSIONS, personOf } from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { type AdapterContext, isAnswering, isCarrying, type ToolAdapters } from './adapters/types';
import type { ActionsPort, ToolDefinition, ToolRunContext } from './types';

/** Past these, a result is cut so one call can't flood the conversation. */
const MAX_ITEMS = 50;
const MAX_CHARS = 20_000;

/** What a generated tool returns: the action's output, trimmed when it is too large to be useful. */
export const shapeOutput = (output: unknown): unknown => {
  if (output === undefined || output === null) {
    return { done: true };
  }

  let shaped = output;

  if (Array.isArray(output) && output.length > MAX_ITEMS) {
    shaped = {
      items: output.slice(0, MAX_ITEMS),
      total: output.length,
      truncated: `Only the first ${MAX_ITEMS} of ${output.length} are shown.`,
    };
  }

  const json = JSON.stringify(shaped);

  if (json.length <= MAX_CHARS) {
    return shaped;
  }

  return {
    truncated: 'The result was too large to show in full; ask for less (one id, a filter, a smaller page).',
    preview: json.slice(0, MAX_CHARS),
  };
};

const describe = (spec: AnyActionSpec, description: string | undefined): string => {
  if (description) {
    return description;
  }

  const summary = spec.summary.endsWith('.') ? spec.summary : `${spec.summary}.`;

  return spec.description ? `${summary} ${spec.description}` : summary;
};

const adapterContext = (context: ToolRunContext, port: ActionsPort): AdapterContext => ({
  schema: async () => (await context.engine.metadata.getSnapshot(context.workspaceId)).index,
  read: async (actionId, input) => {
    const spec = port.specs.find((one) => one.id === actionId);

    if (!spec?.readOnly) {
      throw new EngineError('FORBIDDEN', `An adapter may only read: "${actionId}" is not a read-only action`);
    }

    return invokeAction(context, actionId, input ?? {});
  },
});

/** Run an action as the tool's caller through the host. */
export const invokeAction = (context: ToolRunContext, actionId: string, input: unknown): Promise<unknown> => {
  if (!context.actions) {
    throw new EngineError('MISSING_DEPENDENCY', `"${actionId}" is not available on this server`);
  }

  return context.actions.invoke(context.ctx, actionId, input);
};

/**
 * One tool per exposed action that no hand-written tool serves. Several actions may name the same hand-written
 * tool; a generated tool serves exactly one, so two actions naming the same missing tool is a mistake.
 */
export const toolsFromActions = (
  port: ActionsPort,
  handWritten: ReadonlySet<string>,
  adapters: ToolAdapters = {},
): ToolDefinition[] => {
  const generated = new Map<string, ToolDefinition>();

  for (const spec of port.specs) {
    const { ai } = spec;

    if (ai.tool === null || handWritten.has(ai.tool)) {
      continue;
    }

    if (generated.has(ai.tool)) {
      throw new Error(`Actions "${spec.id}" and another both name the tool "${ai.tool}", which nothing hand-writes`);
    }

    const adapter = adapters[spec.id];

    generated.set(ai.tool, {
      name: ai.tool,
      description: describe(spec, ai.description),
      input: adapter?.input ?? spec.input,
      area: areaOfAction(spec),
      escalates: ESCALATING_PERMISSIONS.includes(spec.permission),
      approval: spec.approval,
      locked: spec.locked,
      readOnly: spec.readOnly,
      externalContent: spec.externalContent,
      moduleId: spec.module,
      available: (ctx, engine) =>
        engine.permissions.can(ctx, spec.permission) && (!spec.sessionOnly || personOf(ctx.actor) !== null),
      run: async (input, context) => {
        const adapting = adapterContext(context, port);
        const mapped = adapter?.toAction ? await adapter.toAction(input, adapting) : input;

        if (isAnswering(mapped)) {
          return shapeOutput(mapped.result);
        }

        const [actionInput, carry] = isCarrying(mapped) ? [mapped.input, mapped.carry] : [mapped, undefined];
        const output = await invokeAction(context, spec.id, actionInput);

        return shapeOutput(adapter?.shape ? await adapter.shape(output, input, adapting, carry) : output);
      },
    });
  }

  return [...generated.values()];
};
