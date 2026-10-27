import { z } from 'zod';
import {
  AiAgentActivityQuerySchema,
  AiAgentActivitySchema,
  AiAgentInputSchema,
  AiAgentPatchSchema,
  AiAgentSchema,
  AiAgentUsageSchema,
  AiSettingsPatchSchema,
  AiSettingsSchema,
  AiSkillInputSchema,
  AiSkillPatchSchema,
  AiSkillSchema,
  AiSkillSummarySchema,
} from '../ai';
import { coreIds } from '../core-ids';
import { defineActionSpec } from './define';

export const ApiKeySummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    start: z.string().nullable().optional(),
    prefix: z.string().nullable().optional(),
    createdAt: z.string(),
    expiresAt: z.string().nullable().optional(),
    lastRequest: z.string().nullable().optional(),
    permissions: z.record(z.string(), z.array(z.string())).nullable().optional(),
  })
  .meta({ id: 'ApiKeySummary' });

export const CreatedApiKeySchema = ApiKeySummarySchema.extend({ key: z.string() }).meta({ id: 'CreatedApiKey' });

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(32),
    expiresInDays: z.number().int().min(1).max(365).optional(),
    permissions: z.record(z.string(), z.array(z.string())).optional(),
  })
  .meta({ id: 'CreateApiKey' });

/** Organization-owned api keys, managed by owners and admins. Granting access is never left to a workspace override. */
export const apiKeyActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_api_keys,
    ai: { tool: 'list_api_keys' },
    summary: 'List API keys',
    tags: ['api-keys'],
    permission: 'apikey.manage',
    output: z.array(ApiKeySummarySchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/api-keys',
      outputDescription: 'Keys of this workspace',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_api_key,
    ai: { tool: 'create_api_key' },
    summary: 'Create an API key',
    tags: ['api-keys'],
    permission: 'apikey.manage',
    locked: true,
    body: CreateApiKeySchema,
    output: CreatedApiKeySchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/api-keys',
      status: 201,
      outputDescription: 'The new key; `key` is shown only once',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_api_key,
    ai: { tool: 'delete_api_key' },
    summary: 'Delete an API key',
    tags: ['api-keys'],
    permission: 'apikey.manage',
    locked: true,
    params: z.object({ id: z.string() }),
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/api-keys/{id}', outputDescription: 'Archived' },
  }),
};

/** The agent's per-workspace settings. Changing what it may do without asking is never left to itself. */
export const aiSettingsActions = {
  get: defineActionSpec({
    id: coreIds.actions.get_ai_settings,
    ai: { tool: 'get_ai_settings' },
    summary: 'Get AI settings',
    tags: ['ai'],
    permission: 'metadata.read',
    sessionOnly: true,
    output: AiSettingsSchema,
    http: { method: 'get', path: '/api/workspaces/{workspaceId}/ai/settings', outputDescription: 'The default agent' },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_ai_settings,
    ai: {
      tool: 'update_ai_settings',
      description:
        "Choose the agent Home and new conversations use (an active agent, or null for the first by name). How an agent's tools ask is set on the agent with update_agent. Always asks for approval.",
    },
    summary: 'Update AI settings',
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    body: AiSettingsPatchSchema,
    output: AiSettingsSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/ai/settings',
      outputDescription: 'Updated settings (owners and admins only)',
    },
  }),
};

/** Agents: their own instructions, tools, starter prompts and approvals. Shaping one is never automatic. */
export const aiAgentActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_agents,
    ai: { tool: 'list_agents' },
    summary: 'List agents',
    description: 'The agents of this workspace with their tools; archived ones only when asked for.',
    tags: ['ai'],
    permission: 'metadata.read',
    sessionOnly: true,
    query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
    output: z.array(AiAgentSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/agents',
      outputDescription: 'The agents of this workspace',
    },
  }),
  usage: defineActionSpec({
    id: coreIds.actions.get_agent_usage,
    ai: { tool: 'get_agent_usage' },
    summary: 'Get agent usage',
    description:
      "How many conversations each agent has had (everyone's) and the tokens they used, for every agent including archived ones.",
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    output: z.array(AiAgentUsageSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/agents/usage',
      outputDescription: 'Usage per agent (owners and admins only)',
    },
  }),
  activity: defineActionSpec({
    id: coreIds.actions.get_agent_activity,
    ai: {
      tool: 'get_agent_activity',
      description:
        'How much one agent has been used: conversations started, replies given and tokens used per day over the last `days` days (default 30). Use get_agent_usage for every agent at once.',
    },
    summary: 'Get agent activity',
    description:
      "One agent's conversations started, replies given and tokens used (input and output) per day over the last `days` days counted in `tz`.",
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    params: z.object({ id: z.string() }),
    query: AiAgentActivityQuerySchema,
    output: AiAgentActivitySchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/agents/{id}/activity',
      outputDescription: "The agent's activity per day (owners and admins only)",
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_agent,
    ai: {
      tool: 'create_agent',
      description:
        'Create an agent: a name, what it is for, instructions added to its prompt, starter prompts, the tools it may use (null for all) and which of its tools ask first. Always asks for approval.',
    },
    summary: 'Create an agent',
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    body: AiAgentInputSchema,
    output: AiAgentSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/ai/agents',
      status: 201,
      outputDescription: 'The new agent (owners and admins only)',
    },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_agent,
    ai: {
      tool: 'update_agent',
      description:
        'Change an agent; only the given fields change. archived: true archives it, false restores it. Always asks for approval.',
    },
    summary: 'Update an agent',
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    params: z.object({ id: z.string() }),
    body: AiAgentPatchSchema,
    output: AiAgentSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/ai/agents/{id}',
      outputDescription: 'The updated agent',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.archive_agent,
    ai: {
      tool: 'archive_agent',
      description:
        'Archive an agent: it takes no new messages, and its conversations stay readable. Always asks for approval.',
    },
    summary: 'Archive an agent',
    tags: ['ai'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    params: z.object({ id: z.string() }),
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/ai/agents/{id}', outputDescription: 'Deleted' },
  }),
};

/**
 * Skills: procedures the workspace writes once and its agents load when a request calls for them. Writing one is
 * shaping what an agent is told, so it is `ai.manage` and always asks, as shaping an agent does.
 */
export const aiSkillActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_skills,
    ai: {
      tool: 'list_skills',
      description:
        'The skills of this workspace: label and when each is for, without the text. Archived ones only when asked for. get_skill reads one in full.',
    },
    summary: 'List skills',
    tags: ['skills'],
    permission: 'ai.manage',
    sessionOnly: true,
    query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
    output: z.array(AiSkillSummarySchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/skills',
      outputDescription: 'The skills of this workspace (owners and admins only)',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_skill,
    ai: { tool: 'get_skill', description: 'One skill in full, with its text, by id.' },
    summary: 'Get a skill',
    tags: ['skills'],
    permission: 'ai.manage',
    sessionOnly: true,
    params: z.object({ id: z.string() }),
    output: AiSkillSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/skills/{id}',
      outputDescription: 'The skill, with its text',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_skill,
    ai: {
      tool: 'create_skill',
      description:
        'Write a skill: a label, one line saying when to use it, and the procedure as Markdown. Agents that may use all skills see it at once. Always asks for approval.',
    },
    summary: 'Create a skill',
    tags: ['skills'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    body: AiSkillInputSchema,
    output: AiSkillSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/ai/skills',
      status: 201,
      outputDescription: 'The new skill (owners and admins only)',
    },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_skill,
    ai: {
      tool: 'update_skill',
      description:
        'Change a skill; only the given fields change. archived: true archives it, false restores it. Always asks for approval.',
    },
    summary: 'Update a skill',
    tags: ['skills'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    params: z.object({ id: z.string() }),
    body: AiSkillPatchSchema,
    output: AiSkillSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/ai/skills/{id}',
      outputDescription: 'The updated skill',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.archive_skill,
    ai: {
      tool: 'archive_skill',
      description: 'Archive a skill: no agent lists or loads it any more. Always asks for approval.',
    },
    summary: 'Archive a skill',
    tags: ['skills'],
    permission: 'ai.manage',
    sessionOnly: true,
    locked: true,
    params: z.object({ id: z.string() }),
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/ai/skills/{id}', outputDescription: 'Archived' },
  }),
};

export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'member']).meta({ id: 'WorkspaceRole' });

export const WorkspaceMemberSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    role: z.string(),
    createdAt: z.string(),
    user: z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable() }),
  })
  .meta({ id: 'WorkspaceMember' });

export const WorkspaceInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    status: z.enum(['pending', 'accepted', 'rejected', 'canceled']),
    expiresAt: z.string(),
    createdAt: z.string(),
    inviterId: z.string(),
  })
  .meta({ id: 'WorkspaceInvitation' });

const MemberParams = z.object({ memberId: z.string() });

/**
 * People in the workspace. Owners and admins manage them; only owners grant, change or remove the owner role, and a
 * workspace always keeps one owner. Who gets access is never left to a workspace override.
 */
export const memberActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_members,
    ai: { tool: 'list_members' },
    summary: 'List members',
    tags: ['members'],
    permission: 'member.read',
    output: z.array(WorkspaceMemberSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/members',
      outputDescription: 'Members with their role, oldest first',
    },
  }),
  updateRole: defineActionSpec({
    id: coreIds.actions.change_member_role,
    ai: { tool: 'change_member_role' },
    summary: "Change a member's role",
    tags: ['members'],
    permission: 'member.manage',
    sessionOnly: true,
    locked: true,
    params: MemberParams,
    body: z.object({ role: WorkspaceRoleSchema }).meta({ id: 'UpdateMemberRole' }),
    output: WorkspaceMemberSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/members/{memberId}',
      outputDescription: 'The member',
    },
  }),
  remove: defineActionSpec({
    id: coreIds.actions.remove_member,
    ai: { tool: 'remove_member' },
    summary: 'Remove a member',
    description: 'They lose access to the workspace at once. Records they created stay.',
    tags: ['members'],
    permission: 'member.manage',
    sessionOnly: true,
    locked: true,
    params: MemberParams,
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/members/{memberId}', outputDescription: 'Removed' },
  }),
  listInvitations: defineActionSpec({
    id: coreIds.actions.list_invitations,
    ai: { tool: 'list_invitations' },
    summary: 'List pending invitations',
    tags: ['members'],
    permission: 'member.read',
    output: z.array(WorkspaceInvitationSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/invitations',
      outputDescription: 'Pending invitations',
    },
  }),
  invite: defineActionSpec({
    id: coreIds.actions.invite_member,
    ai: { tool: 'invite_member' },
    summary: 'Invite someone',
    description:
      'They join with the given role when they accept, after signing up with this email if they have no account. Invitations expire after 48 hours.',
    tags: ['members'],
    permission: 'member.manage',
    sessionOnly: true,
    locked: true,
    body: z.object({ email: z.email(), role: WorkspaceRoleSchema.default('member') }).meta({ id: 'CreateInvitation' }),
    output: WorkspaceInvitationSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/invitations',
      status: 201,
      outputDescription: 'The invitation',
    },
  }),
  cancelInvitation: defineActionSpec({
    id: coreIds.actions.cancel_invitation,
    ai: { tool: 'cancel_invitation' },
    summary: 'Cancel an invitation',
    tags: ['members'],
    permission: 'member.manage',
    sessionOnly: true,
    locked: true,
    params: z.object({ invitationId: z.string() }),
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/invitations/{invitationId}',
      outputDescription: 'Canceled',
    },
  }),
};
