import { assetActions } from './assets';
import { documentActions } from './documents';
import { metadataActions } from './metadata';
import { recordActions } from './records';
import { taskActions } from './tasks';
import type { Action, EngineActionDeps } from './types';
import { workflowActions } from './workflows';

export {
  type Action,
  type EngineActionDeps,
  implement,
  invokeAction,
  runAction,
  type WorkflowRunner,
} from './types';

/** The actions that need only the engine: the same handlers serve the server's routes and the agent's tools. */
export const engineActions = (deps: EngineActionDeps): Action[] => [
  ...metadataActions(deps),
  ...recordActions(deps),
  ...documentActions(deps),
  ...assetActions(deps),
  ...taskActions(deps),
  ...workflowActions(deps),
];
