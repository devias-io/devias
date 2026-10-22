import { type AnyActionSpec, keyOfId, moduleActionSpec } from '@devias/core';
import type { ModuleServer } from '@devias/server';
import { type Action, type ActionDeps, implement } from './types';

/** An action a module declares, with what the runtime needs to run it. */
export interface DeclaredAction {
  spec: AnyActionSpec;
  moduleId: string;
  actionId: string;
}

/** The actions the registered modules declare, as specs like core's: one per handler, `<module>.<action>`. */
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
          actionId: keyOfId(handler.id),
        },
      ];
    }),
  );

/**
 * Each runs through the module runtime: as the module, with the caller's connection or the workspace's, and only
 * where it is installed (the runtime answers NOT_FOUND elsewhere). The registry has checked `module.run` already.
 */
export const declaredActions = ({ declared, runtime }: ActionDeps): Action[] =>
  declared.map(({ spec, moduleId, actionId }) =>
    implement(spec, (input, ctx) => runtime.runAction(ctx, moduleId, actionId, input)),
  );
