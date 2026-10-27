import {
  type ApplyResult,
  CONNECTION_VISIBILITIES,
  type Connection,
  type ConnectionList,
  type ConnectionVisibility,
  coreIds,
  declaresRuntime,
  defaultVisibility,
  hashManifest,
  type InstalledModule,
  type ManifestEntityKind,
  type ModuleManifest,
  OAUTH_STATE_TTL_MS,
  type PlanChange,
  type PlanResult,
  personOf,
  providerOf,
} from '@devias/core';
import { type DataEngine, type EngineContext, EngineError } from '@devias/data-engine';
import { z } from 'zod';
import { invokeAction } from '../actions';
import { defineTool, type ToolRunContext } from '../types';

/**
 * Modules as the agent sees them: what is installed (with, for those that connect to a service, their
 * connections and how they are doing, the actions a workflow step can call, each also a tool of its own called by
 * the action's name, and with its id for a layout button, and the events a workflow can start from), what the server could install, installing one
 * (the person consents on a card that shows what it may do), and connecting one. Both lists say who publishes each
 * module, what its code may do (its role) and what it says needs review (its policies), so the agent can explain a
 * module before proposing to install it. Credentials are typed into a secure form or given on the provider's own
 * consent page, never through the agent.
 */

const canRead = (ctx: EngineContext, engine: DataEngine) => engine.permissions.can(ctx, 'module.read');
const canManage = (ctx: EngineContext, engine: DataEngine) => engine.permissions.can(ctx, 'module.manage');

/** A module's defaults for what needs review, where it declares them. */
const consentSummary = (declarations: Pick<ModuleManifest, 'policies'>) => ({
  ...(declarations.policies?.length
    ? {
        policies: declarations.policies.map((policy) => ({
          description: policy.description,
          decision: policy.decision,
        })),
      }
    : {}),
});

/** How a connection reads for the model: who, whose, and whether it works. Credentials never appear. */
const connectionSummary = (connection: Connection) => ({
  id: connection.id,
  provider: connection.providerId,
  belongsTo: connection.visibility === 'workspace' ? 'workspace' : 'you',
  ...(connection.account ? { account: connection.account } : {}),
  status: connection.status,
  ...(connection.lastError ? { lastError: connection.lastError } : {}),
});

const runtimeSummary = (module: InstalledModule, connections: Connection[]) => ({
  ...(module.connections.length > 0
    ? {
        status:
          connections.length === 0
            ? 'not connected'
            : connections.some((connection) => connection.status === 'auth_failed')
              ? 'needs reconnecting'
              : 'connected',
        connections: connections.map(connectionSummary),
      }
    : {}),
  actions: module.actions.map((action) => ({
    name: action.name,
    id: action.id,
    label: action.label,
    ...(action.description ? { description: action.description } : {}),
    input: action.input.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      // A `record` field takes the id of a record of this object (id).
      ...(field.objectId ? { object: field.objectId } : {}),
      required: field.required,
      ...(field.help ? { help: field.help } : {}),
    })),
    output: action.output.map((field) => ({
      name: field.name,
      type: field.type,
      // A `record` output is the id of a record of this object (id).
      ...(field.objectId ? { object: field.objectId } : {}),
      ...(field.description ? { description: field.description } : {}),
    })),
  })),
  events: module.events.map((event) => event.name),
});

export const listModules = defineTool({
  name: 'list_modules',
  area: 'modules',
  description:
    "List the installed modules with their version, role (the permissions and object access their code asks for: record access is per object, by id) and policies (what they say needs review). Module code runs with its role; policies are defaults the module declares, not applied yet. For those that connect to an outside service (a payment provider, a mail service, a Google account, …): their status (not connected, connected or needs reconnecting) with the connections you may see (the workspace's and the person's own, with lastError), the actions a workflow action step can call with their input fields, and the event types an event trigger can start from. Each action can also be run now through its own tool, called by the action's name; its id is what a layout's `actions` entry names. A field of type `record` takes the id of a record of the object it names; a layout's `actions` list offers such an action as a button on that object's record pages (see list_layouts, update_layout). Connect one with connect_module.",
  input: z.object({}),
  approval: 'auto',
  readOnly: true,
  moduleId: null,
  available: canRead,
  run: async (_input, { engine, ctx }) => {
    const snapshot = await engine.metadata.getSnapshot(ctx.workspaceId);
    const connections = await engine.connections.list(ctx);

    return {
      modules: snapshot.schema.modules.map((module) => ({
        id: module.id,
        name: module.label,
        version: module.version,
        ...(module.core ? { core: true } : {}),
        ...(module.description ? { description: module.description } : {}),
        ...consentSummary(module),
        ...(declaresRuntime(module)
          ? runtimeSummary(
              module,
              connections.filter((connection) => connection.moduleId === module.id),
            )
          : {}),
      })),
    };
  },
});

export const listModuleCatalog = defineTool({
  name: 'list_module_catalog',
  area: 'modules',
  description:
    'List the modules this server can install, with whether each is installed and at which version, who publishes it, what it brings, its role (the permissions and object access its code asks for: record access is per object, by id; an empty role touches no workspace data) and its policies (what it says needs review). Its code runs with its role; policies are defaults it declares, not applied yet: say so when it matters. Install one with install_module.',
  input: z.object({}),
  approval: 'auto',
  readOnly: true,
  moduleId: null,
  available: canRead,
  run: async (_input, context) => {
    const catalog = (await invokeAction(context, coreIds.actions.list_module_catalog, {})) as ModuleManifest[];
    const { schema } = await context.engine.metadata.getSnapshot(context.workspaceId);
    const installed = new Map(schema.modules.map((module) => [module.id, module.version]));

    return {
      modules: catalog.map((manifest) => ({
        id: manifest.id,
        name: manifest.label,
        version: manifest.version,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...consentSummary(manifest),
        installedVersion: installed.get(manifest.id) ?? null,
        brings: {
          objects: manifest.objects.length,
          connections: manifest.connections.map((provider) => `${provider.label} (${provider.kind})`),
          actions: manifest.actions.map((action) => action.name),
          agents: manifest.agents.map((agent) => agent.label),
          events: manifest.events.map((event) => event.name),
        },
      })),
    };
  },
});

const changeLine = (change: PlanChange) =>
  `${change.action} ${change.kind} ${change.label}${change.destructive ? ' (destructive)' : ''}${change.reason ? `: ${change.reason}` : ''}`;

const KIND_WORDS: Record<ManifestEntityKind, [one: string, many: string]> = {
  object: ['object', 'objects'],
  field: ['field', 'fields'],
  view: ['view', 'views'],
  layout: ['layout', 'layouts'],
  nav_item: ['navigation item', 'navigation items'],
  command_item: ['command', 'commands'],
  workflow: ['workflow', 'workflows'],
};
const VERBS = { create: 'Adds', update: 'Changes', delete: 'Removes' } as const;

/** A plan in words for the consent card: "Adds 2 objects, 13 fields", "Removes 1 field". */
const planWords = (plan: PlanResult): string[] =>
  (['create', 'update', 'delete'] as const).flatMap((action) => {
    const counts = new Map<ManifestEntityKind, number>();

    for (const change of plan.changes) {
      if (change.action === action) {
        counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
      }
    }

    if (counts.size === 0) {
      return [];
    }

    const parts = [...counts].map(([kind, count]) => `${count} ${KIND_WORDS[kind][count === 1 ? 0 : 1]}`);

    return [`${VERBS[action]} ${parts.join(', ')}`];
  });

/** A manifest from the server's catalog, by id or display name. */
const fromCatalog = async (context: ToolRunContext, ref: string): Promise<ModuleManifest> => {
  const catalog = (await invokeAction(context, coreIds.actions.list_module_catalog, {})) as ModuleManifest[];
  const needle = ref.trim().toLowerCase();
  const manifest = catalog.find((candidate) => candidate.id === needle || candidate.label.toLowerCase() === needle);

  if (!manifest) {
    throw new EngineError(
      'NOT_FOUND',
      `No module "${ref}" in the catalog. Available: ${catalog.map((m) => m.id).join(', ')}`,
    );
  }

  return manifest;
};

/** The plan for installing a manifest, or why it cannot be applied as it is. */
const installPlan = async (context: ToolRunContext, manifest: ModuleManifest, allowDestructive?: boolean) => {
  const plan = (await invokeAction(context, coreIds.actions.plan_module, { manifest })) as PlanResult;
  const changes = plan.changes.filter((change) => change.action !== 'noop');

  if (plan.hasConflicts) {
    throw new EngineError('CONFLICT', 'The plan has conflicts, so nothing can be applied', {
      conflicts: changes.filter((change) => change.action === 'conflict').map(changeLine),
    });
  }

  if (plan.hasDestructive && !allowDestructive) {
    throw new EngineError(
      'VALIDATION',
      'The plan deletes data, so nothing was applied. Confirm with the person, then call again with allowDestructive.',
      { destructive: changes.filter((change) => change.destructive).map(changeLine) },
    );
  }

  return plan;
};

export const installModule = defineTool({
  name: 'install_module',
  area: 'modules',
  escalates: true,
  description:
    "Install a module from the server's catalog by id or label (see list_module_catalog), or upgrade an installed one to the catalog's version. The person is shown a card with what its code may do (its role), what it says needs review (its policies) and what it adds; installing from the card is their consent, so say why you propose it and point out anything that matters (a wide role, data an upgrade deletes). A plan with conflicts is not applied. An upgrade that deletes objects or fields with their data needs allowDestructive, once the person agreed.",
  input: z.object({
    module: z.string().min(1).describe('Module id or label from list_module_catalog, e.g. mailer'),
    allowDestructive: z.boolean().optional().describe('Allow an upgrade that deletes objects or fields and their data'),
  }),
  approval: 'approve',
  moduleId: null,
  available: canManage,
  requestInput: async ({ module, allowDestructive }, context) => {
    const manifest = await fromCatalog(context, module);
    const label = manifest.label;
    const { schema } = await context.engine.metadata.getSnapshot(context.workspaceId);
    const installed = schema.modules.find((candidate) => candidate.id === manifest.id);

    if (installed?.manifestHash === hashManifest(manifest)) {
      throw new EngineError('VALIDATION', `${label} ${installed.version} is installed: nothing to do`);
    }

    const plan = await installPlan(context, manifest, allowDestructive);

    return {
      title: plan.fromVersion ? `Update ${label} to ${manifest.version}` : `Install ${label}`,
      ...(manifest.description ? { description: manifest.description } : {}),
      fields: [],
      consent: {
        module: manifest.id,
        label,
        version: manifest.version,
        fromVersion: plan.fromVersion,
        policies: (manifest.policies ?? []).map((policy) => ({
          description: policy.description,
          decision: policy.decision,
        })),
        changes: [
          ...planWords(plan),
          // Agents are not plan changes (they are made from the manifest), but installing adds them.
          ...(manifest.agents.length > 0
            ? [`Adds ${manifest.agents.length} ${manifest.agents.length === 1 ? 'agent' : 'agents'}`]
            : []),
        ],
        manifestHash: plan.manifestHash,
      },
    };
  },
  run: async ({ module, allowDestructive }, context) => {
    const manifest = await fromCatalog(context, module);
    const plan = await installPlan(context, manifest, allowDestructive);

    // The person agreed to what the card showed; a module that changed on the server since needs asking again.
    if (plan.manifestHash !== context.request?.consent?.manifestHash) {
      throw new EngineError(
        'CONFLICT',
        `${manifest.label} changed on the server since the person was asked, so nothing was applied. Call install_module again to show them what it asks for now.`,
      );
    }

    const result = (await invokeAction(context, coreIds.actions.apply_module, {
      manifest,
      expectedPlanHash: plan.planHash,
      ...(plan.hasDestructive ? { allowDestructive: true } : {}),
    })) as ApplyResult;

    return {
      installed: true,
      module: manifest.id,
      from: plan.fromVersion,
      version: result.version,
      changes: result.applied.map(changeLine),
      ...(manifest.connections.length > 0
        ? { next: 'It must be connected before its actions work: offer to do it now with connect_module.' }
        : {}),
    };
  },
});

/** An installed module by id or label, or NOT_FOUND. */
const installedModule = async (engine: DataEngine, ctx: EngineContext, ref: string): Promise<InstalledModule> => {
  const { schema } = await engine.metadata.getSnapshot(ctx.workspaceId);
  const needle = ref.trim().toLowerCase();
  const installed = schema.modules.find((module) => module.id === needle || module.label.toLowerCase() === needle);

  if (!installed) {
    throw new EngineError('NOT_FOUND', `"${ref}" is not installed; install it first`);
  }

  return installed;
};

const ConnectInput = z.object({
  module: z.string().min(1).describe('Module id or label, e.g. stripe'),
  provider: z.string().optional().describe('Which connection, when the module offers several (see list_connections)'),
  visibility: z
    .enum(CONNECTION_VISIBILITIES)
    .optional()
    .describe("Whose connection: 'user' for the person's own, 'workspace' for everyone's (owners and admins)"),
  connectionId: z.string().optional().describe('An existing API key connection whose key to replace'),
});
type ConnectInput = z.infer<typeof ConnectInput>;

/** What a connect call is about: the module, its provider, and the connection to replace if any. */
const connectTarget = async ({ engine, ctx }: { engine: DataEngine; ctx: EngineContext }, input: ConnectInput) => {
  const module = await installedModule(engine, ctx, input.module);
  const name = module.label;
  const existing = input.connectionId ? await engine.connections.get(ctx, input.connectionId) : null;

  if (existing && existing.moduleId !== module.id) {
    throw new EngineError('VALIDATION', `That connection belongs to ${existing.moduleId}, not ${name}`);
  }

  if (module.connections.length === 0) {
    throw new EngineError('VALIDATION', `${name} has nothing to connect`);
  }

  const provider = providerOf(module, existing?.providerId ?? input.provider);

  if (!provider) {
    throw new EngineError(
      'VALIDATION',
      `Name the provider: ${name} offers ${module.connections.map((candidate) => `${candidate.id} (${candidate.label})`).join(', ')}`,
    );
  }

  const visibility: ConnectionVisibility = existing?.visibility ?? input.visibility ?? defaultVisibility(provider);

  return { module, name, provider, existing, visibility, label: provider.label };
};

export const connectModule = defineTool({
  name: 'connect_module',
  area: 'modules',
  description:
    "Connect an installed module to its outside service, or replace an API key. For an API key, the person types it into a secure form shown with this call: you never see, ask for or type it, and you get back whether it works (status connected, or auth_failed with lastError). For an account (OAuth, such as a Google account), the call shows a button that opens the provider's consent page; once the person agrees, you get back who they connected as. A module's connections belong to the workspace or to each person, as the module says; pass visibility to choose when it allows both (workspace connections are for owners and admins). Use it when a module is not connected, needs reconnecting, or the person wants to replace a key (pass connectionId).",
  input: ConnectInput,
  approval: 'approve',
  moduleId: null,
  available: (ctx, engine) => engine.permissions.can(ctx, 'module.connect'),
  requestInput: async (input, context) => {
    const { module, provider, existing, visibility, label } = await connectTarget(context, input);

    if (provider.kind === 'oauth2') {
      if (existing) {
        throw new EngineError('VALIDATION', 'An account is replaced by connecting it again');
      }

      // The server knows whether it can reach the provider (its OAuth client is set); say so before the person tries.
      const list = (await invokeAction(context, coreIds.actions.list_connections, {
        module: module.id,
      })) as ConnectionList;
      const status = list.providers.find((candidate) => candidate.providerId === provider.id);

      if (status && !status.available) {
        throw new EngineError('VALIDATION', `${label}: ${status.problem}`);
      }

      return {
        title: `Connect ${visibility === 'user' ? 'your ' : "the workspace's "}${label}`,
        ...(provider.help ? { description: provider.help } : {}),
        fields: [],
        connect: { module: module.id, provider: provider.id, visibility, label },
      };
    }

    return {
      title: `Connect ${label}`,
      ...(existing
        ? { description: 'Leave a field empty to keep what is saved.' }
        : provider.help
          ? { description: provider.help }
          : {}),
      // What is already saved can be kept, so it is never required again.
      fields: provider.fields.map((field) => (existing?.hints[field.name] ? { ...field, required: false } : field)),
    };
  },
  run: async (input, context) => {
    const { module, provider, existing, visibility } = await connectTarget(context, input);

    if (provider.kind === 'oauth2') {
      // The person approved by connecting; find what that made.
      const person = personOf(context.ctx.actor);
      const since = Date.now() - OAUTH_STATE_TTL_MS;
      const list = (await invokeAction(context, coreIds.actions.list_connections, {
        module: module.id,
      })) as ConnectionList;
      const made = list.connections
        .filter(
          (connection) =>
            connection.providerId === provider.id &&
            connection.ownerUserId === (visibility === 'user' ? person : null) &&
            Date.parse(connection.updatedAt) >= since,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

      if (made?.status !== 'connected') {
        return {
          module: module.id,
          connected: false,
          reason: made?.lastError ?? 'The account was not connected: the consent page was closed or refused.',
        };
      }

      return { module: module.id, connected: true, ...connectionSummary(made) };
    }

    const values = context.secrets ?? {};

    if (Object.keys(values).length === 0) {
      return { module: module.id, changed: false, note: 'Nothing was entered; what is saved stays.' };
    }

    const save = async (id: string) =>
      (await invokeAction(context, coreIds.actions.update_connection, { id, values })) as Connection;
    let connection: Connection;

    if (existing) {
      connection = await save(existing.id);
    } else {
      try {
        connection = (await invokeAction(context, coreIds.actions.connect_module, {
          module: module.id,
          provider: provider.id,
          visibility,
          values,
        })) as Connection;
      } catch (error) {
        // Already connected: the person just typed a new key for it, so it replaces the old one.
        const taken = (error as { details?: { connectionId?: unknown } }).details?.connectionId;

        if (!(error instanceof EngineError && error.code === 'CONFLICT' && typeof taken === 'string')) {
          throw error;
        }

        connection = await save(taken);
      }
    }

    return {
      module: module.id,
      ...connectionSummary(connection),
      /** Which fields are saved; their values never reach you. */
      saved: Object.keys(connection.hints),
      ...(connection.webhookUrl
        ? { webhookUrl: connection.webhookUrl, ...(module.webhookHelp ? { webhookHelp: module.webhookHelp } : {}) }
        : {}),
    };
  },
});
