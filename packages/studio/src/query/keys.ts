import type { Query } from '@devias/core';

/**
 * TanStack Query keys. Everything workspace-scoped lives under `['workspace', workspaceId]` so live updates and
 * polling can invalidate a whole workspace, one object, or one record with prefix matching.
 */
export const keys = {
  workspace: (ws: string) => ['workspace', ws] as const,
  schema: (ws: string) => ['workspace', ws, 'schema'] as const,
  records: (ws: string, object: string) => ['workspace', ws, 'records', object] as const,
  list: (ws: string, query: Query) => ['workspace', ws, 'records', query.object, 'list', query] as const,
  detail: (ws: string, object: string, id: string) => ['workspace', ws, 'records', object, 'detail', id] as const,
  count: (ws: string, object: string) => ['workspace', ws, 'records', object, 'count'] as const,
  /** Under the object's records, so anything that refreshes a record's data refreshes its activity too. */
  activity: (ws: string, object: string, id: string) => ['workspace', ws, 'records', object, 'activity', id] as const,
  /** Under the object's records too: deleting a record refreshes its comments. */
  comments: (ws: string, object: string, id: string) => ['workspace', ws, 'records', object, 'comments', id] as const,
  labels: (ws: string, object: string, ids: readonly string[] = []) =>
    ['workspace', ws, 'labels', object, ids] as const,
  documents: (ws: string) => ['workspace', ws, 'documents'] as const,
  documentList: (ws: string, query: unknown) => ['workspace', ws, 'documents', 'list', query] as const,
  documentActivity: (ws: string, id: string) => ['workspace', ws, 'documents', 'activity', id] as const,
  documentComments: (ws: string, id: string) => ['workspace', ws, 'documents', 'comments', id] as const,
  document: (ws: string, id: string) => ['workspace', ws, 'documents', 'detail', id] as const,
  tasks: (ws: string) => ['workspace', ws, 'tasks'] as const,
  taskList: (ws: string, query: unknown) => ['workspace', ws, 'tasks', 'list', query] as const,
  task: (ws: string, id: string) => ['workspace', ws, 'tasks', 'detail', id] as const,
  taskActivity: (ws: string, id: string) => ['workspace', ws, 'tasks', 'activity', id] as const,
  taskRuns: (ws: string, id: string) => ['workspace', ws, 'tasks', 'runs', id] as const,
  taskCounts: (ws: string) => ['workspace', ws, 'tasks', 'counts'] as const,
  modules: (ws: string) => ['workspace', ws, 'modules'] as const,
  workflows: (ws: string) => ['workspace', ws, 'workflows'] as const,
  /** Under the workflows key, so a workflow change refreshes its runs too. */
  workflowRuns: (ws: string, id: string) => ['workspace', ws, 'workflows', id, 'runs'] as const,
  /** Also under the workflows key: a finished run refreshes the counts. */
  workflowActivity: (ws: string, days: number) => ['workspace', ws, 'workflows', 'activity', days] as const,
  plan: (ws: string, moduleId: string) => ['workspace', ws, 'modules', 'plan', moduleId] as const,
  /** Under the modules key, so installing or removing a module refreshes the catalog and settings too. */
  moduleCatalog: (ws: string) => ['workspace', ws, 'modules', 'catalog'] as const,
  connections: (ws: string) => ['workspace', ws, 'modules', 'connections'] as const,
  moduleVariables: (ws: string, id: string) => ['workspace', ws, 'modules', 'variables', id] as const,
  jobs: (ws: string, moduleId?: string) =>
    (moduleId ? ['workspace', ws, 'jobs', moduleId] : ['workspace', ws, 'jobs']) as readonly string[],
  /** Under the settings key, so one invalidation refreshes the states and every events list. */
  moduleEvents: (ws: string, id: string) => ['workspace', ws, 'modules', 'connections', id, 'events'] as const,
  /** The person's notifications; the lists and the unread count sit under it, so one invalidation refreshes both. */
  notifications: (ws: string) => ['workspace', ws, 'notifications'] as const,
  notificationList: (ws: string, unread: boolean) =>
    ['workspace', ws, 'notifications', 'list', unread ? 'unread' : 'all'] as const,
  unreadNotifications: (ws: string) => ['workspace', ws, 'notifications', 'unread'] as const,
  organizations: () => ['auth', 'organizations'] as const,
  invitation: (id: string) => ['auth', 'invitation', id] as const,
  members: (organizationId: string) => ['auth', 'members', organizationId] as const,
  invitations: (organizationId: string) => ['auth', 'invitations', organizationId] as const,
  apiKeys: (organizationId: string) => ['auth', 'api-keys', organizationId] as const,
  aiStatus: (ws: string) => ['workspace', ws, 'ai', 'status'] as const,
  aiConversations: (ws: string) => ['workspace', ws, 'ai', 'conversations'] as const,
  aiSettings: (ws: string) => ['workspace', ws, 'ai', 'settings'] as const,
  /** The workspace's active agents; invalidating it also refreshes `aiAgentsAll`, which it prefixes. */
  aiAgents: (ws: string) => ['workspace', ws, 'ai', 'agents'] as const,
  /** Conversations and tokens per agent, for those who manage agents. */
  aiAgentUsage: (ws: string) => ['workspace', ws, 'ai', 'agent-usage'] as const,
  /** One agent's activity per day over `days` days. */
  aiAgentActivity: (ws: string, id: string, days: number) =>
    ['workspace', ws, 'ai', 'agent-activity', id, days] as const,
  /** Active and archived agents, to name who acted and to manage them. */
  aiAgentsAll: (ws: string) => ['workspace', ws, 'ai', 'agents', 'all'] as const,
  /** The workspace's skills, active and archived, without their text; invalidating it refreshes every skill read. */
  aiSkills: (ws: string) => ['workspace', ws, 'ai', 'skills'] as const,
  /** One skill in full. */
  aiSkill: (ws: string, id: string) => ['workspace', ws, 'ai', 'skills', id] as const,
};
