import type { DataEngine, EngineContext, Snapshot } from '@devias/data-engine';
import type { ModelToolSpec } from '../model/types';
import { toolsFromActions } from './actions';
import { builtinAdapters } from './adapters';
import type { ToolAdapters } from './adapters/types';
import { builtinTools } from './builtin';
import { assertToolName, toInputSchema } from './json-schema';
import type { ActionsPort, ToolDefinition } from './types';

export interface ToolRegistry {
  all(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  /** Tools this caller may see: hidden ones dropped, module tools only when the module is installed. */
  toolsFor(ctx: EngineContext, snapshot: Snapshot): ToolDefinition[];
  /** Model-facing specs, sorted by name so the rendered prompt is stable across turns. */
  specsFor(tools: ToolDefinition[]): ModelToolSpec[];
}

export interface ToolRegistryOptions {
  engine: DataEngine;
  /** Override the built-in set (tests). */
  builtin?: ToolDefinition[];
  /** The host's actions; those no built-in tool serves get a generated tool. */
  actions?: ActionsPort;
  /** What is specific to a model about an action, by action id. Default: the platform's. */
  adapters?: ToolAdapters;
}

export const createToolRegistry = (options: ToolRegistryOptions): ToolRegistry => {
  const { engine } = options;
  const tools = new Map<string, ToolDefinition>();
  const specs = new Map<string, ModelToolSpec>();

  const register = (tool: ToolDefinition) => {
    assertToolName(tool.name);

    if (tools.has(tool.name)) {
      throw new Error(`AI tool "${tool.name}" is registered twice`);
    }

    if (!tool.area) {
      throw new Error(`AI tool "${tool.name}" needs an area`);
    }

    if (!tool.description.trim()) {
      throw new Error(`AI tool "${tool.name}" needs a description`);
    }

    tools.set(tool.name, tool);
    specs.set(tool.name, { name: tool.name, description: tool.description, inputSchema: toInputSchema(tool.input) });
  };

  const builtin = options.builtin ?? builtinTools;

  for (const tool of builtin) {
    register(tool);
  }

  if (options.actions) {
    for (const tool of toolsFromActions(
      options.actions,
      new Set(builtin.map((t) => t.name)),
      options.adapters ?? builtinAdapters,
    )) {
      register(tool);
    }
  }

  return {
    all: () => [...tools.values()],
    get: (name) => tools.get(name),
    toolsFor: (ctx, snapshot) => {
      const installed = new Set(snapshot.schema.modules.map((e) => e.id));

      return [...tools.values()].filter(
        (tool) => (tool.moduleId === null || installed.has(tool.moduleId)) && tool.available?.(ctx, engine) !== false,
      );
    },
    specsFor: (list) =>
      list
        .map((tool) => specs.get(tool.name))
        .filter((spec): spec is ModelToolSpec => spec !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
  };
};
