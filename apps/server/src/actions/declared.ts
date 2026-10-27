import { type AnyActionSpec, moduleActionSpec } from '@devias/core';
import type { ModuleServer } from '@devias/server';
import { type Action, type ActionDeps, implement } from './types';

/** An action a module declares, with what the runtime needs to run it. */
export interface DeclaredAction {
  spec: AnyActionSpec;
  moduleId: string;
  /** What its tool and its route are called. */
  actionName: string;
}

/** The actions the registered modules declare, as specs like core's: one per handler, called by their name. */
export const declaredActionSpecs = (modules: ModuleServer[]): DeclaredAction[] =>
  modules.flatMap((module) =>
    module.actions.flatMap((handler) => {
      const declaration = module.manifest.actions.find((action) => action.id === handler.id);

      if (!declaration) {
        return [];
      }

      return [
        {
          spec: moduleActionSpec(module.manifest, declaration, handler.input),
          moduleId: module.manifest.id,
          actionName: declaration.name,
        },
      ];
    }),
  );

/**
 * Each runs through the module runtime: as the module, with the caller's connection or the workspace's, and only
 * where it is installed (the runtime answers NOT_FOUND elsewhere). The registry has checked `module.run` already.
 */
export const declaredActions = ({ declared, runtime }: ActionDeps): Action[] =>
  declared.map(({ spec, moduleId, actionName }) =>
    implement(spec, (input, ctx) => runtime.runAction(ctx, moduleId, actionName, input)),
  );
