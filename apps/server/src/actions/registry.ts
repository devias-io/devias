import { type EngineContext, EngineError, engineActions, runAction } from '@devias/data-engine';
import { declaredActions } from './declared';
import { moduleActions } from './modules';
import { notificationActions } from './notifications';
import { taskRunActions } from './task-runs';
import type { Action, ActionDeps } from './types';
import { workspaceActions } from './workspace';

/** Every action the server implements, core's and the registered modules', in mount order. */
export interface ActionRegistry {
  all(): Action[];
  get(id: string): Action | undefined;
  /** Check the declared permission, then run with an input that was already parsed (HTTP validated it). */
  run(action: Action, ctx: EngineContext, input: unknown): Promise<unknown>;
  /** Parse a merged input against the spec, check the permission, run. What tools call. */
  invoke(ctx: EngineContext, id: string, input: unknown): Promise<unknown>;
}

export const createActionRegistry = (deps: ActionDeps): ActionRegistry => {
  const list: Action[] = [
    ...engineActions(deps),
    ...taskRunActions(deps),
    ...notificationActions(deps),
    ...moduleActions(deps),
    ...workspaceActions(deps),
    ...declaredActions(deps),
  ];
  const byId = new Map<string, Action>();
  const routes = new Set<string>();

  for (const action of list) {
    const { id, http } = action.spec;

    if (byId.has(id)) {
      throw new Error(`Action "${id}" is implemented twice`);
    }

    const route = `${http.method.toUpperCase()} ${http.path}`;

    if (routes.has(route)) {
      throw new Error(`Action "${id}": ${route} is taken`);
    }

    byId.set(id, action);
    routes.add(route);
  }

  const run = (action: Action, ctx: EngineContext, input: unknown) => runAction(deps.engine, action, ctx, input);

  return {
    all: () => list,
    get: (id) => byId.get(id),
    run,
    invoke: async (ctx, id, input) => {
      const action = byId.get(id);

      if (!action) {
        throw new EngineError('NOT_FOUND', `Unknown action "${id}"`);
      }

      return run(action, ctx, action.spec.parse(input));
    },
  };
};
