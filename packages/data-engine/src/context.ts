import type { Actor } from '@devias/core';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/** Everything the engine needs to know about the caller of one operation. */
export interface EngineContext {
  workspaceId: string;
  actor: Actor;
  /** Membership role for user actors; null for api keys, functions and the system. */
  role: WorkspaceRole | null;
  /** Permission map of an api key actor, e.g. `{ record: ['read', 'write'] }`. */
  apiKeyPermissions?: Record<string, string[]>;
  /**
   * The run an agent is working in, when it is: the agent may then touch only the task of the run and its subtasks,
   * and what it writes names the run.
   */
  run?: { id: string; taskId: string };
}

export const systemContext = (workspaceId: string, id = 'seed'): EngineContext => ({
  workspaceId,
  actor: { kind: 'system', id },
  role: null,
});

export const functionContext = (workspaceId: string, id: string): EngineContext => ({
  workspaceId,
  actor: { kind: 'function', id: id },
  role: null,
});

/**
 * A module's code at work (an action, a job, a schedule): it acts as the module.
 * `onBehalfOf` names the person who started it, for history (`module:<id>@user:<id>`); it does not widen or narrow
 * what the module may do.
 */
export const moduleActorContext = (
  workspaceId: string,
  moduleId: string,
  onBehalfOf?: string | null,
): EngineContext => ({
  workspaceId,
  actor: { kind: 'module', id: moduleId, ...(onBehalfOf ? { onBehalfOf: { kind: 'user', id: onBehalfOf } } : {}) },
  role: null,
});

export const workflowContext = (workspaceId: string, workflowId: string): EngineContext => ({
  workspaceId,
  actor: { kind: 'workflow', id: workflowId },
  role: null,
});

/**
 * An agent acting for the person in `ctx`: it has their role, and history records both (`agent:<id>@user:<id>`).
 * What bounds an agent is its tool list, not a narrower set of permissions.
 */
export const agentContext = (
  ctx: EngineContext,
  agentId: string,
  run?: { id: string; taskId: string },
): EngineContext => {
  if (ctx.actor.kind !== 'user') {
    throw new Error('Agents act for signed-in users only');
  }

  return {
    workspaceId: ctx.workspaceId,
    actor: { kind: 'agent', id: agentId, onBehalfOf: { kind: 'user', id: ctx.actor.id } },
    role: ctx.role,
    ...(run ? { run } : {}),
  };
};

/**
 * `user:<id>`, `api_key:<id>`, `function:<uid>`, `workflow:<id>`, `system:seed`, `agent:<id>@user:<id>`,
 * `module:<id>@user:<id>` — stored in created_by/updated_by.
 */
export const actorString = (actor: Actor): string =>
  `${actor.kind}:${actor.id}${actor.onBehalfOf ? `@${actor.onBehalfOf.kind}:${actor.onBehalfOf.id}` : ''}`;
