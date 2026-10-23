import type { AnyToolDefinition } from '../types';
import { askUser } from './ask';
import { connectModule, installModule, listModuleCatalog, listModules } from './modules';
import { navigate } from './navigate';
import { useSkill } from './skills';
import { finishTask } from './tasks';
import { createApiKey } from './workspace';

/** Everything the agent can do out of the box, in the order the settings page lists them. */
export const builtinTools: AnyToolDefinition[] = [
  finishTask,
  listModules,
  listModuleCatalog,
  installModule,
  connectModule,
  createApiKey,
  navigate,
  useSkill,
  askUser,
];

export { askUser, connectModule, createApiKey, installModule, listModuleCatalog, listModules, navigate, useSkill };
