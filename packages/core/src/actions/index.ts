export * from './define';
export * from './documents';
export * from './metadata';
export * from './module-action';
export * from './modules';
export * from './notifications';
export * from './records';
export * from './tasks';
export * from './workflows';
export * from './workspace';

import type { ActionDefinition } from '../module-runtime';
import { AGENT_ACTIONS } from './agent-actions';
import { documentActions } from './documents';
import {
  commandItemActions,
  describeObject,
  fieldActions,
  getSchema,
  layoutActions,
  listBlocks,
  navItemActions,
  objectActions,
  viewActions,
} from './metadata';
import { moduleActions } from './modules';
import { notificationActions } from './notifications';
import { activityActions, recordActions, recordCommentActions } from './records';
import { taskActions } from './tasks';
import { workflowActions } from './workflows';
import { aiAgentActions, aiSettingsActions, aiSkillActions, apiKeyActions, memberActions } from './workspace';

/** Every action core declares, in a stable order. */
export const ACTIONS = [
  getSchema,
  describeObject,
  listBlocks,
  ...Object.values(objectActions),
  ...Object.values(fieldActions),
  ...Object.values(viewActions),
  ...Object.values(layoutActions),
  ...Object.values(navItemActions),
  ...Object.values(commandItemActions),
  ...Object.values(recordActions),
  ...Object.values(activityActions),
  ...Object.values(recordCommentActions),
  ...Object.values(documentActions),
  ...Object.values(taskActions),
  ...Object.values(workflowActions),
  ...Object.values(moduleActions),
  ...Object.values(notificationActions),
  ...Object.values(apiKeyActions),
  ...Object.values(memberActions),
  ...Object.values(aiSettingsActions),
  ...Object.values(aiAgentActions),
  ...Object.values(aiSkillActions),
];

export { AGENT_ACTIONS, type AgentActionSpec } from './agent-actions';

/**
 * The name the model calls the tool for an action by, or null when no tool serves it: a core action is served by the
 * tool its `ai` names (or the agent's own tool), a module's action by its `name`, which `actions` (the declarations of
 * the module installed) give.
 */
export const toolOfAction = (
  id: string,
  actions: readonly Pick<ActionDefinition, 'id' | 'name'>[] = [],
): string | null => {
  const spec = ACTIONS.find((one) => one.id === id);

  if (spec) {
    return spec.ai.tool;
  }

  const agentOwn = AGENT_ACTIONS.find((one) => one.id === id);

  if (agentOwn) {
    return agentOwn.tool;
  }

  return actions.find((action) => action.id === id)?.name ?? null;
};
