import {
  aiAgentActions as aiAgents,
  aiSettingsActions as aiSettings,
  aiSkillActions as aiSkills,
  apiKeyActions as apiKeys,
  memberActions as members,
  personOf,
} from '@devias/core';
import { type EngineContext, EngineError } from '@devias/data-engine';
import type { Acting } from '../auth/directory';
import { type Action, type ActionDeps, implement } from './types';

/** The signed-in person behind a session-only action, with their role. */
const actingOf = (ctx: EngineContext): Acting => {
  const userId = personOf(ctx.actor);

  if (!userId) {
    throw new EngineError('FORBIDDEN', 'Only signed-in owners or admins can do this');
  }

  return { userId, role: ctx.role };
};

/** Api keys and members (through the directory), the agent's settings and the workspace's agents. */
export const workspaceActions = ({ directory, ai }: ActionDeps): Action[] => [
  implement(apiKeys.list, (_input, ctx) => directory.apiKeys.list(ctx.workspaceId)),
  implement(apiKeys.create, (input, ctx) => directory.apiKeys.create(ctx.workspaceId, actingOf(ctx).userId, input)),
  implement(apiKeys.delete, ({ id }, ctx) => directory.apiKeys.delete(ctx.workspaceId, id)),
  implement(members.list, (_input, ctx) => directory.members.list(ctx.workspaceId)),
  implement(members.updateRole, ({ memberId, role }, ctx) =>
    directory.members.updateRole(ctx.workspaceId, actingOf(ctx), memberId, role),
  ),
  implement(members.remove, ({ memberId }, ctx) => directory.members.remove(ctx.workspaceId, actingOf(ctx), memberId)),
  implement(members.listInvitations, (_input, ctx) => directory.invitations.list(ctx.workspaceId)),
  implement(members.invite, (input, ctx) => directory.invitations.create(ctx.workspaceId, actingOf(ctx), input)),
  implement(members.cancelInvitation, ({ invitationId }, ctx) =>
    directory.invitations.cancel(ctx.workspaceId, invitationId),
  ),
  implement(aiSettings.get, (_input, ctx) => ai.settings.get(ctx)),
  implement(aiSettings.update, (patch, ctx) => ai.settings.update(ctx, patch)),
  implement(aiAgents.list, ({ includeArchived }, ctx) =>
    ai.agents.list(ctx, { includeArchived: includeArchived === 'true' }),
  ),
  implement(aiAgents.activity, ({ id, ...query }, ctx) => ai.agents.activity(ctx, id, query)),
  implement(aiAgents.usage, (_input, ctx) => ai.agents.usage(ctx)),
  implement(aiAgents.create, (input, ctx) => ai.agents.create(ctx, input)),
  implement(aiAgents.update, ({ id, ...patch }, ctx) => ai.agents.update(ctx, id, patch)),
  implement(aiAgents.delete, ({ id }, ctx) => ai.agents.delete(ctx, id)),
  implement(aiSkills.list, ({ includeArchived }, ctx) =>
    ai.skills.list(ctx, { includeArchived: includeArchived === 'true' }),
  ),
  implement(aiSkills.get, ({ id }, ctx) => ai.skills.get(ctx, id)),
  implement(aiSkills.create, (input, ctx) => ai.skills.create(ctx, input)),
  implement(aiSkills.update, ({ id, ...patch }, ctx) => ai.skills.update(ctx, id, patch)),
  implement(aiSkills.delete, ({ id }, ctx) => ai.skills.delete(ctx, id)),
];
