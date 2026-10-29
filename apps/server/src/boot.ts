import { createAiService, createModelClient, type ModelClient } from '@devias/ai';
import { ACTIONS, type ModuleManifest } from '@devias/core';
import {
  createDataEngine,
  createFileUrlSigner,
  createLocalBus,
  createLocalFileStore,
  createPgNotifyBus,
  type EngineContext,
  type ImageProcessor,
} from '@devias/data-engine';
import type { ModuleFetch, ModuleServer } from '@devias/server';
import { declaredActionSpecs } from './actions/declared';
import { type ActionRegistry, createActionRegistry } from './actions/registry';
import { createAuth } from './auth/auth';
import { createDirectory } from './auth/directory';
import type { ServerConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import * as authSchema from './db/schema/auth';
import { createApp } from './http/app';
import { createSharpProcessor } from './images/sharp-processor';
import { createLogger } from './logger';
import { createNotifier } from './notifications/notifier';
import {
  createInvitationAcceptedNotifier,
  createInvitationSentNotifier,
  createWorkspaceUpdateNotifier,
  type InvitationAccepted,
  type InvitationSent,
  type WorkspaceChange,
} from './notifications/workspace-updates';
import { createAgentRunner } from './runtime/agent-runner';
import { createModuleRuntime } from './runtime/module-runtime';
import { createModuleRegistry } from './runtime/registry';
import { createWorkflowRunner } from './runtime/workflow-runner';

export interface CreateServerOptions {
  /** The server side of every module to register; their manifests become available for plan/apply and routes. */
  modules: ModuleServer[];
  /**
   * Manifests applied to every new workspace besides the core modules'. None by default: a workspace starts with
   * the core modules only, and installs the rest (the CRM, invoicing, …) from Settings → Modules.
   */
  builtin?: ModuleManifest[];
  /** Override the PGlite data dir (tests use `memory://`). */
  pgliteDataDir?: string;
  /** Start the workflow runner (record events, module events, schedules, retries); tests leave it off. */
  startTriggers?: boolean;
  /** Where files are kept, instead of `FILES_DIR` (tests keep them in a temporary folder). */
  filesDir?: string;
  /** The image library; leave it out for `sharp`, or pass `null` to run without one (pictures are served as uploaded). */
  imageProcessor?: ImageProcessor | null;
  /** Inject a model (tests use a scripted fake); `null` disables AI regardless of config. */
  modelClient?: ModelClient | null;
  /** How module code (and OAuth token requests) reach outside services; tests pass a stub. */
  moduleFetch?: ModuleFetch;
}

/** Wire database → migrations → engine → auth → runtime → HTTP app. */
export const createServer = async (config: ServerConfig, options: CreateServerOptions) => {
  const logger = createLogger(config.logLevel);

  for (const warning of config.warnings) {
    logger.warn(warning);
  }

  const db = await createDb({
    databaseUrl: config.databaseUrl,
    pgliteDataDir: options.pgliteDataDir ?? config.pgliteDataDir,
  });

  if (config.migrateOnBoot) {
    await runMigrations(db);
  }

  const bus =
    db.kind === 'pg' && db.createListenClient
      ? createPgNotifyBus({ createClient: db.createListenClient, logger })
      : createLocalBus();
  const registry = createModuleRegistry();

  for (const module of options.modules) {
    registry.register(module);
  }

  const imageProcessor =
    options.imageProcessor === null ? undefined : (options.imageProcessor ?? (await createSharpProcessor(logger)));

  const engine = createDataEngine({
    db: db.db,
    bus,
    logger,
    // Core modules come with every workspace; the product's starting set is configurable.
    seedManifests: [
      ...options.modules.map((module) => module.manifest).filter((manifest) => manifest.core),
      ...(options.builtin ?? []),
    ],
    encryptionKey: config.encryptionKey,
    fileStore: createLocalFileStore(options.filesDir ?? config.files.dir),
    fileUrls: createFileUrlSigner({
      secret: `${config.authSecret}:file-urls`,
      baseUrl: config.authUrl,
      bucketSeconds: config.files.urlBucketSeconds,
      maxLinkSeconds: config.files.linkMaxTtlSeconds,
    }),
    ...(imageProcessor ? { imageProcessor } : {}),
    fileMaxBytes: config.files.maxBytes,
    ...(config.files.quotaBytes === null ? {} : { fileQuotaBytes: config.files.quotaBytes }),
  });

  const modelClient =
    options.modelClient !== undefined
      ? options.modelClient
      : config.ai.apiKey
        ? createModelClient({
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            model: config.ai.model,
            effort: config.ai.effort,
            maxTokens: config.ai.maxTokens,
            fallbacks: config.ai.fallbacks,
            timeoutMs: config.ai.requestTimeoutMs,
            ...(config.ai.baseUrl ? { baseURL: config.ai.baseUrl } : {}),
          })
        : null;

  // Workflows and the agent run actions, and some actions need them (running a workflow, the agent's
  // settings), so their port to the registry resolves late.
  const late: { actions?: ActionRegistry } = {};
  const lateActions = {
    invoke: (ctx: EngineContext, id: string, input: unknown) => {
      if (!late.actions) {
        throw new Error('Actions are not ready yet');
      }

      return late.actions.invoke(ctx, id, input);
    },
    inputSchema: (id: string) => late.actions?.get(id)?.spec.input,
  };

  const workflows = createWorkflowRunner({ engine, actions: lateActions, logger });

  const moduleActions = declaredActionSpecs(options.modules);

  const ai = createAiService({
    engine,
    db: db.db,
    workflows,
    actions: {
      specs: [...ACTIONS, ...moduleActions.map((action) => action.spec)],
      invoke: lateActions.invoke,
    },
    model: modelClient,
    modelName: config.ai.model,
    effort: config.ai.effort,
    maxIterations: config.ai.maxIterations,
    logger,
  });
  const interruptedTurns = await ai.recover();

  if (interruptedTurns > 0) {
    logger.warn(`failed ${interruptedTurns} agent turn(s) interrupted by the last shutdown`);
  }

  // The notifier needs the directory, which needs the auth instance: bound once both exist.
  let workspaceUpdatedNotifier: ((change: WorkspaceChange) => Promise<unknown>) | null = null;
  let invitationSentNotifier: ((invite: InvitationSent) => Promise<unknown>) | null = null;
  let invitationAcceptedNotifier: ((joined: InvitationAccepted) => Promise<unknown>) | null = null;

  const auth = createAuth({
    db: db.db,
    schema: authSchema,
    config: {
      baseURL: config.authUrl,
      secret: config.authSecret,
      trustedOrigins: [config.studioOrigin],
      google: config.google,
    },
    onHookError: (hook, error) => {
      logger.warn(`notification for ${hook} failed: ${error instanceof Error ? error.message : String(error)}`);
    },
    onWorkspaceCreated: (id) => engine.workspaces.initialize(id),
    onWorkspaceDeleted: async (id) => {
      await ai.purgeWorkspace(id);
      await engine.workspaces.purge(id);
    },
    onWorkspaceUpdated: async (change) => {
      await workspaceUpdatedNotifier?.(change);
    },
    onInvitationSent: async (invite) => {
      await invitationSentNotifier?.(invite);
    },
    onInvitationAccepted: async (joined) => {
      await invitationAcceptedNotifier?.(joined);
    },
  });

  const directory = createDirectory(auth, {
    onInvitationCreated: async (invite) => {
      await invitationSentNotifier?.(invite);
    },
  });

  // Who a task may be assigned to is the directory's to say: the members of the workspace, and its agents.
  engine.tasks.bindAssignees({
    exists: async (ctx, assignee) =>
      assignee.kind === 'user'
        ? (await directory.members.list(ctx.workspaceId)).some((member) => member.userId === assignee.id)
        : (await ai.store.agents.list(ctx.workspaceId)).some((agent) => agent.id === assignee.id && agent.takesTasks),
  });

  // A file's cell naming a member (an email, a name) is looked up in the same directory.
  engine.records.bindMembers({
    list: async (ctx) =>
      (await directory.members.list(ctx.workspaceId)).map((member) => ({
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
      })),
  });

  // Module actions notify people through the runtime, and notifying resolves them through the directory.
  const notifier = createNotifier({ engine, directory });
  workspaceUpdatedNotifier = createWorkspaceUpdateNotifier({ notifier, directory });
  invitationSentNotifier = createInvitationSentNotifier({ notifier, directory });
  invitationAcceptedNotifier = createInvitationAcceptedNotifier({ notifier, directory });

  const runtime = createModuleRuntime({
    engine,
    registry,
    logger,
    notifier,
    publicUrl: config.authUrl,
    ...(options.moduleFetch ? { fetch: options.moduleFetch } : {}),
  });

  const actions = createActionRegistry({
    engine,
    workflows,
    registry,
    runtime,
    publicUrl: config.authUrl,
    directory,
    notifier,
    declared: moduleActions,
    ai,
  });

  late.actions = actions;

  const app = createApp({ auth, engine, db, registry, runtime, ai, actions, config, logger });

  const agentRunner = createAgentRunner({ engine, ai, directory, logger });

  if (options.startTriggers) {
    workflows.start();
    agentRunner.start();
  }

  return {
    app,
    auth,
    engine,
    ai,
    actions,
    db,
    registry,
    workflows,
    agentRunner,
    runtime,
    logger,
    close: async () => {
      agentRunner.stop();
      workflows.stop();
      await ai.close();
      await engine.close();
      await db.close();
    },
  };
};

export type Server = Awaited<ReturnType<typeof createServer>>;
