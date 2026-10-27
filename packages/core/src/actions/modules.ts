import { z } from 'zod';
import { coreIds } from '../core-ids';
import { ModuleManifestSchema } from '../manifest/manifest';
import { ApplyResultSchema, PlanResultSchema } from '../manifest/plan';
import { InstalledModuleSchema } from '../metadata/schema';
import {
  ConnectionAuthorizeResultSchema,
  ConnectionAuthorizeSchema,
  ConnectionCreateSchema,
  ConnectionListSchema,
  ConnectionPatchSchema,
  ConnectionQuerySchema,
  ConnectionSchema,
  ConnectionTestResultSchema,
  ModuleVariableSchema,
  ModuleVariablesPatchSchema,
  WebhookEventPageSchema,
  WebhookEventQuerySchema,
} from '../module-runtime';
import { defineActionSpec, type ErrorStatus } from './define';

const tags = ['modules'];
const ModuleParams = z.object({ moduleId: z.string() });
const ConnectionParams = z.object({ id: z.string() });
/** Plan and apply may also fail with 422 when the manifest references something missing. */
const RECONCILE_ERRORS: ErrorStatus[] = [400, 401, 403, 404, 409, 422];

export const PlanRequestSchema = z.object({ manifest: ModuleManifestSchema }).meta({ id: 'PlanRequest' });
export const ApplyRequestSchema = z
  .object({
    manifest: ModuleManifestSchema,
    expectedPlanHash: z.string().optional(),
    allowDestructive: z.boolean().optional(),
  })
  .meta({ id: 'ApplyRequest' });

export const moduleActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_modules,
    ai: { tool: 'list_modules' },
    summary: 'List installed modules',
    tags,
    permission: 'metadata.read',
    output: z.array(InstalledModuleSchema),
    http: { method: 'get', path: '/api/workspaces/{workspaceId}/modules', outputDescription: 'Installed modules' },
  }),
  plan: defineActionSpec({
    id: coreIds.actions.plan_module,
    ai: { tool: 'install_module' },
    summary: 'Plan a module install',
    tags,
    permission: 'module.manage',
    approval: 'auto',
    body: PlanRequestSchema,
    output: PlanResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/modules/plan',
      errors: RECONCILE_ERRORS,
      bodyDescription: 'The manifest to reconcile',
      outputDescription: 'The plan',
    },
  }),
  apply: defineActionSpec({
    id: coreIds.actions.apply_module,
    ai: { tool: 'install_module' },
    summary: 'Apply a module manifest',
    tags,
    permission: 'module.manage',
    body: ApplyRequestSchema,
    output: ApplyResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/modules/apply',
      errors: RECONCILE_ERRORS,
      bodyDescription: 'The manifest to apply, optionally pinned to a reviewed plan',
      outputDescription: 'What was applied',
    },
  }),
  uninstall: defineActionSpec({
    id: coreIds.actions.uninstall_module,
    ai: {
      tool: 'uninstall_module',
      description:
        "Uninstall a module by id. Everything it added goes: objects with their records, fields, views, connections, variables and events. Pass allowDestructive: 'true'. Say what will be lost first; always asks for approval.",
    },
    summary: 'Uninstall a module',
    tags,
    permission: 'module.manage',
    locked: true,
    params: ModuleParams,
    query: z.object({ allowDestructive: z.enum(['true', 'false']).optional() }),
    output: ApplyResultSchema,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/modules/{moduleId}',
      status: 200,
      errors: RECONCILE_ERRORS,
      outputDescription: 'What was removed',
    },
  }),
  catalog: defineActionSpec({
    id: coreIds.actions.list_module_catalog,
    ai: { tool: 'list_module_catalog' },
    summary: 'List installable modules',
    description: 'The manifest of every module registered on this server, installed in the workspace or not.',
    tags,
    permission: 'module.read',
    output: z.array(ModuleManifestSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/modules/catalog',
      outputDescription: 'Every registered module',
    },
  }),
  listConnections: defineActionSpec({
    id: coreIds.actions.list_connections,
    ai: {
      tool: 'list_connections',
      description:
        "List the connections of installed modules to their outside services: the workspace's and the caller's own, with each one's status (connected or auth_failed), lastError, account and when it was last tested or used, plus the providers each module offers and whether this server can use them. Credentials never appear.",
    },
    summary: 'List connections',
    description:
      "The workspace's connections and the caller's own, and the providers installed modules offer. Credentials never come back; `hints` carries masked previews.",
    tags,
    permission: 'module.read',
    query: ConnectionQuerySchema,
    output: ConnectionListSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/connections',
      outputDescription: 'Providers and connections',
    },
  }),
  getConnection: defineActionSpec({
    id: coreIds.actions.get_connection,
    ai: { tool: null, category: 'covered_by', reason: 'list_modules returns every connection the caller may see' },
    summary: 'Get a connection',
    tags,
    permission: 'module.read',
    params: ConnectionParams,
    output: ConnectionSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/connections/{id}',
      outputDescription: 'The connection',
    },
  }),
  createConnection: defineActionSpec({
    id: coreIds.actions.connect_module,
    ai: { tool: 'connect_module' },
    summary: 'Connect with an API key',
    description:
      "Store an API key connection, encrypted, and test it against the outside service: the returned `status` is `connected` or `auth_failed` (see `lastError`). A person's own connection needs `module.connect`; a workspace one, owners and admins. OAuth providers connect through `connections.authorize`.",
    tags,
    permission: 'module.connect',
    body: ConnectionCreateSchema,
    output: ConnectionSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/connections',
      status: 201,
      bodyDescription: 'The module, its provider and the values',
      outputDescription: 'The connection, tested',
    },
  }),
  updateConnection: defineActionSpec({
    id: coreIds.actions.update_connection,
    ai: { tool: 'connect_module' },
    summary: 'Change a connection',
    description: 'Replace some of its values, or its label; the connection is tested again.',
    tags,
    permission: 'module.connect',
    params: ConnectionParams,
    body: ConnectionPatchSchema,
    output: ConnectionSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/connections/{id}',
      outputDescription: 'The connection, tested',
    },
  }),
  authorizeConnection: defineActionSpec({
    id: coreIds.actions.authorize_connection,
    ai: { tool: 'connect_module' },
    summary: 'Start connecting an account',
    description:
      "The OAuth provider's consent page for the caller to open. Once they agree, the provider sends them to the server's callback, which stores the connection and sends them back to `returnTo`.",
    tags,
    permission: 'module.connect',
    sessionOnly: true,
    body: ConnectionAuthorizeSchema,
    output: ConnectionAuthorizeResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/connections/authorize',
      bodyDescription: 'The module and its OAuth provider',
      outputDescription: 'The consent page',
    },
  }),
  testConnection: defineActionSpec({
    id: coreIds.actions.test_connection,
    ai: {
      tool: 'test_connection',
      description:
        "Check a connection against its outside service and record the outcome: ok, or why not (an expired grant, a revoked key). A failure marks it auth_failed. Use it when a module's actions fail, then explain the message.",
    },
    summary: 'Test a connection',
    tags,
    permission: 'module.connect',
    approval: 'auto',
    params: ConnectionParams,
    output: ConnectionTestResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/connections/{id}/test',
      outputDescription: 'The outcome',
    },
  }),
  disconnect: defineActionSpec({
    id: coreIds.actions.disconnect_connection,
    ai: {
      tool: 'disconnect_connection',
      description:
        "Remove a connection: its credentials are forgotten and actions that used it fail until someone connects again. A workspace connection's webhook URL stops working. Always asks for approval.",
    },
    summary: 'Disconnect',
    tags,
    permission: 'module.connect',
    approval: 'approve',
    params: ConnectionParams,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/connections/{id}',
      outputDescription: 'Disconnected',
    },
  }),
  listVariables: defineActionSpec({
    id: coreIds.actions.list_module_variables,
    ai: { tool: 'list_module_variables' },
    summary: "List a module's variables",
    description:
      'What is in effect for each variable the module declares, and where it comes from: this workspace, the default, or nowhere. Each has an id; set values by it. A secret never comes back, only whether it is set.',
    tags,
    permission: 'module.read',
    params: ModuleParams,
    output: z.array(ModuleVariableSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/modules/{moduleId}/variables',
      outputDescription: 'The variables',
    },
  }),
  updateVariables: defineActionSpec({
    id: coreIds.actions.set_module_variables,
    ai: { tool: 'set_module_variables' },
    summary: "Set a module's variables",
    description:
      "Owners and admins only. Sets this workspace's values of the module's variables, by the ids list_module_variables gives (an empty string goes back to the default). A secret variable is typed in Settings → Modules, never through the agent: this refuses it.",
    tags,
    permission: 'module.manage',
    params: ModuleParams,
    body: ModuleVariablesPatchSchema,
    output: z.array(ModuleVariableSchema),
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/modules/{moduleId}/variables',
      outputDescription: 'The variables',
    },
  }),
  listEvents: defineActionSpec({
    id: coreIds.actions.list_webhook_events,
    externalContent: true,
    ai: { tool: 'list_webhook_events' },
    summary: "List a module's events",
    description: 'Events the module delivered through its webhook, newest first. Page with `nextCursor`.',
    tags,
    permission: 'module.read',
    params: ModuleParams,
    query: WebhookEventQuerySchema,
    output: WebhookEventPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/modules/{moduleId}/events',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'A page of events',
    },
  }),
};
