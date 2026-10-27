import { type ActionSpec, personOf, type RunWorkflowInput, type WorkflowRun } from '@devias/core';
import type { EngineContext } from '../context';
import { EngineError } from '../errors';
import type { DataEngine } from '../index';

/** Runs a workflow now, or again: steps may call module code, which only a host can execute, so the host brings it. */
export interface WorkflowRunner {
  runManual(ctx: EngineContext, workflowId: string, input: RunWorkflowInput): Promise<WorkflowRun>;
  retryRun(ctx: EngineContext, workflowId: string, runId: string): Promise<WorkflowRun>;
}

/** What the handlers that need only the engine may use. A host's own handlers extend it with what they need. */
export interface EngineActionDeps {
  engine: DataEngine;
  /** Without one, running a workflow is `MISSING_DEPENDENCY`. */
  workflows?: WorkflowRunner;
}

/** A declared action bound to the code that performs it. */
export interface Action<I = unknown, O = unknown> {
  spec: ActionSpec<I, O>;
  /** Runs with an input already parsed against the spec, after its permission was checked. */
  run(input: I, ctx: EngineContext): Promise<O>;
  /** Over HTTP: send this as the ETag and answer 304 when `If-None-Match` carries it. */
  etag?(output: O): string;
}

export const implement = <I, O>(
  spec: ActionSpec<I, O>,
  run: (input: I, ctx: EngineContext) => Promise<O>,
  options: { etag?: (output: O) => string } = {},
): Action<I, O> => ({ spec, run, ...options });

/** Check who may (people-only actions, then the declared permission) and run, as the caller. */
export const runAction = (engine: DataEngine, action: Action, ctx: EngineContext, input: unknown): Promise<unknown> => {
  if (action.spec.sessionOnly && personOf(ctx.actor) === null) {
    throw new EngineError('FORBIDDEN', `"${action.spec.summary}" is for signed-in users only`);
  }

  engine.permissions.authorize(ctx, action.spec.permission);

  return action.run(input, ctx);
};

/** Run an action by id with a merged input: parse it against the spec, then `runAction`. What tools call. */
export const invokeAction = async (
  engine: DataEngine,
  actions: readonly Action[],
  ctx: EngineContext,
  id: string,
  input: unknown,
): Promise<unknown> => {
  const action = actions.find((one) => one.spec.id === id);

  if (!action) {
    throw new EngineError('NOT_FOUND', `Unknown action "${id}"`);
  }

  return runAction(engine, action, ctx, action.spec.parse(input));
};
