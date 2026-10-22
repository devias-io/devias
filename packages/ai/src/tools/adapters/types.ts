import type { SchemaIndex } from '@devias/core';
import type { z } from 'zod';

/** What an adapter may look at: the workspace's schema, and read-only actions. Never the engine itself. */
export interface AdapterContext {
  schema(): Promise<SchemaIndex>;
  /**
   * Run a read-only action as the caller: to resolve a name the model wrote (a workflow by its title), or to add what
   * a reader wants beside the result (a workflow's last runs). Anything that writes is refused.
   */
  read(actionId: string, input?: unknown): Promise<unknown>;
}

const CARRYING = Symbol('carrying');
const ANSWERING = Symbol('answering');

/** The action's input, and something from before the call that the result needs after it (a deleted thing's name). */
export const carrying = <ActionInput, Carry>(input: ActionInput, carry: Carry) => ({
  [CARRYING]: true as const,
  input,
  carry,
});
export type Carrying<ActionInput, Carry> = ReturnType<typeof carrying<ActionInput, Carry>>;

/** Answer the model without calling the action: there is nothing to do ("nothing to change"). */
export const answering = (result: unknown) => ({ [ANSWERING]: true as const, result });
export type Answering = ReturnType<typeof answering>;

export const isCarrying = (value: unknown): value is Carrying<unknown, unknown> =>
  typeof value === 'object' && value !== null && CARRYING in value;
export const isAnswering = (value: unknown): value is Answering =>
  typeof value === 'object' && value !== null && ANSWERING in value;

/**
 * What is specific to a model about an action, kept apart from the action: the tool is the action plus its adapter.
 * An adapter maps and shapes; it never reads or writes the workspace itself, so a person's call and the agent's go
 * through the same code.
 */
export interface ToolAdapter<ToolInput, ActionInput, ActionOutput, Carry = unknown> {
  /** The input the model fills in, when it differs from the action's (friendlier names, flat fields). */
  input?: z.ZodType<ToolInput>;
  /** The action's input, from the tool's. Without it the tool's input is the action's. */
  toAction?: (
    input: ToolInput,
    context: AdapterContext,
  ) =>
    | ActionInput
    | Carrying<ActionInput, Carry>
    | Answering
    | Promise<ActionInput | Carrying<ActionInput, Carry> | Answering>;
  /** What the model reads back, from what the action returned (and what `toAction` carried over). */
  shape?: (output: ActionOutput, input: ToolInput, context: AdapterContext, carry: Carry) => unknown;
}

// biome-ignore lint/suspicious/noExplicitAny: each adapter takes the input and output of its own action
export type AnyToolAdapter = ToolAdapter<any, any, any, any>;

/** Adapters by the id of the action they serve. */
export type ToolAdapters = Record<string, AnyToolAdapter>;

/** Declares an adapter so the tool's input type reaches `toAction` and `shape`. */
// biome-ignore lint/suspicious/noExplicitAny: the action's output is typed by its own spec, not here
export const defineAdapter = <ToolInput, ActionInput = unknown, ActionOutput = any, Carry = unknown>(
  adapter: ToolAdapter<ToolInput, ActionInput, ActionOutput, Carry>,
): ToolAdapter<ToolInput, ActionInput, ActionOutput, Carry> => adapter;
