import {
  CONNECTION_ID_INPUT,
  type Connection,
  type ConnectionAuthorize,
  type ConnectionList,
  type ConnectionProvider,
  type ConnectionProviderStatus,
  type ConnectionQuery,
  type ConnectionTestResult,
  type CronSchedule,
  type InstalledModule,
  JOB_DEFAULT_RETRY_LIMIT,
  keyOfId,
  type ModuleVariable,
  type OAuthConfig,
  parseCron,
  personOf,
  previousCronTime,
  providerOf,
  serverVariableEnv,
  type VariableDefinition,
  type WebhookResult,
} from '@devias/core';
import {
  type ClaimedJob,
  type DataEngine,
  type EngineContext,
  EngineError,
  fromZodError,
  isEngineError,
  type Logger,
  moduleActorContext,
  type StoredConnection,
  scopeEngine,
} from '@devias/data-engine';
import {
  type ActionContext,
  type ConnectionContext,
  type EnqueueOptions,
  type JobContext,
  type ModuleContext,
  type ModuleFetch,
  RetryableError,
  WebhookRejected,
} from '@devias/server';
import type { Notifier } from '../notifications/notifier';
import { authorizeUrl, exchangeCode, type OAuthClient, OAuthError, pkcePair, refreshTokens } from './oauth';
import type { ModuleRegistry } from './registry';

export interface ModuleRuntimeOptions {
  engine: DataEngine;
  registry: ModuleRegistry;
  logger: Logger;
  /** Behind `ctx.notify` in action handlers: sends as the action, to the members `to` names. */
  notifier: Notifier;
  /** The server's public origin: OAuth redirect URIs are built from it. */
  publicUrl: string;
  /** Modules' server variables by environment name (`DEVIAS_MOD_<MODULE>_<KEY>`). */
  env?: Record<string, string>;
  /** How module code (and the OAuth token exchange) reaches outside services; tests pass a stub. */
  fetch?: ModuleFetch;
  clock?: () => Date;
}

/** Webhook bodies larger than this are refused before any signature work. */
export const WEBHOOK_MAX_BYTES = 1_000_000;

/** Access tokens this close to running out are refreshed before use. */
const REFRESH_MARGIN_MS = 60_000;

/** The runtime's own job: a connection's `onConnect` hook, run in the background with the job's retries. */
export const ON_CONNECT_JOB = '$onConnect';

/** Between attempts of a job that asked to be retried: 30 seconds, doubling, at most an hour. */
const backoffMs = (attempt: number): number => Math.min(30_000 * 2 ** Math.max(attempt - 1, 0), 3_600_000);

/** Where providers send people back after consent; it must be registered with the provider as is. */
export const oauthCallbackPath = (moduleId: string, providerId: string): string =>
  `/api/oauth/callback/${moduleId}/${providerId}`;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a finished consent tells the person: who they connected as, or why it did not work. */
export type OAuthOutcome =
  | { ok: true; connection: Connection; module: InstalledModule; returnTo: string | null }
  | { ok: false; message: string; returnTo: string | null };

/**
 * Runs the code behind what modules declare: their actions (for workflows, the API and the agent), their
 * connections (tests, OAuth consents and token refreshes, connect and disconnect hooks), and their webhooks, whose
 * deliveries become stored events. Credentials are opened here and handed to the module's code only.
 */
export const createModuleRuntime = (options: ModuleRuntimeOptions) => {
  const { engine, registry, logger, notifier } = options;
  const fetch: ModuleFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const clock = options.clock ?? (() => new Date());
  const env = options.env ?? {};
  const origin = options.publicUrl.replace(/\/+$/, '');

  /** The registered server side of an installed module, or MISSING_DEPENDENCY. */
  const moduleOf = (moduleId: string) => {
    const module = registry.get(moduleId);

    if (!module) {
      throw new EngineError('MISSING_DEPENDENCY', `Module "${moduleId}" has no server side on this server`);
    }

    return module;
  };

  const installed = async (workspaceId: string, moduleId: string): Promise<InstalledModule> => {
    const snapshot = await engine.metadata.getSnapshot(workspaceId);
    const module = snapshot.schema.modules.find(
      (candidate) => candidate.moduleId === moduleId || candidate.name.toLowerCase() === moduleId.toLowerCase(),
    );

    if (!module) {
      throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
    }

    return module;
  };

  // --- variables ------------------------------------------------------------------------------

  const serverValue = (moduleId: string, variable: VariableDefinition): string | undefined =>
    env[serverVariableEnv(moduleId, variable.key)];

  const variablesOf = async (workspaceId: string, module: InstalledModule): Promise<Record<string, string>> => {
    const own = module.variables.some((variable) => !variable.server)
      ? await engine.moduleVariables.values(workspaceId, module.moduleId)
      : {};
    const values: Record<string, string> = {};

    for (const variable of module.variables) {
      const value = (variable.server ? serverValue(module.moduleId, variable) : own[variable.key]) ?? variable.default;

      if (value !== undefined) {
        values[variable.key] = value;
      }
    }

    return values;
  };

  const describeVariables = async (workspaceId: string, module: InstalledModule): Promise<ModuleVariable[]> => {
    const own = await engine.moduleVariables.values(workspaceId, module.moduleId);

    return module.variables.map((variable) => {
      const set = variable.server ? serverValue(module.moduleId, variable) : own[variable.key];
      const value = set ?? variable.default;

      return {
        key: variable.key,
        label: variable.label,
        ...(variable.description ? { description: variable.description } : {}),
        server: variable.server,
        secret: variable.secret,
        value: variable.secret || value === undefined ? null : value,
        source:
          set !== undefined ? (variable.server ? 'server' : 'workspace') : value !== undefined ? 'default' : 'unset',
      };
    });
  };

  // --- providers --------------------------------------------------------------------------------

  /** The OAuth client this server uses for a provider, or why it cannot. */
  const oauthClientOf = (
    module: InstalledModule,
    provider: { id: string; oauth: OAuthConfig },
  ): { client: OAuthClient } | { problem: string } => {
    const resolved = (key: string) => {
      const variable = module.variables.find((candidate) => candidate.key === key);

      return variable ? (serverValue(module.moduleId, variable) ?? variable.default) : undefined;
    };
    const refs = [provider.oauth.clientId, provider.oauth.clientSecret].filter((ref) => ref !== undefined);
    const missing = refs.filter((ref) => !resolved(ref.variable));

    if (missing.length > 0) {
      return {
        problem: `Not configured on this server: set ${missing.map((ref) => serverVariableEnv(module.moduleId, ref.variable)).join(' and ')}`,
      };
    }

    return {
      client: {
        clientId: resolved(provider.oauth.clientId.variable) ?? '',
        clientSecret: provider.oauth.clientSecret ? resolved(provider.oauth.clientSecret.variable) : undefined,
        redirectUri: `${origin}${oauthCallbackPath(module.moduleId, keyOfId(provider.id))}`,
      },
    };
  };

  const providerStatus = (module: InstalledModule, provider: ConnectionProvider): ConnectionProviderStatus => {
    const problem = provider.kind === 'oauth2' ? oauthClientOf(module, provider) : null;

    return {
      moduleId: module.moduleId,
      providerId: keyOfId(provider.id),
      kind: provider.kind,
      label: provider.label,
      visibility: provider.visibility,
      available: !problem || !('problem' in problem),
      ...(problem && 'problem' in problem ? { problem: problem.problem } : {}),
    };
  };

  const requireClient = (module: InstalledModule, provider: { id: string; oauth: OAuthConfig }): OAuthClient => {
    const found = oauthClientOf(module, provider);

    if ('problem' in found) {
      throw new EngineError('VALIDATION', `${module.name}: ${found.problem}`);
    }

    return found.client;
  };

  // --- connections as module code sees them ---------------------------------------------------

  const expiresSoon = (stored: StoredConnection): boolean => {
    const expiresAt = stored.connection.expiresAt ? Date.parse(stored.connection.expiresAt) : null;

    return expiresAt !== null && expiresAt - clock().getTime() < REFRESH_MARGIN_MS;
  };

  /** The connection with a usable access token: refreshed once, under a row lock, when it is about to run out. */
  const fresh = async (workspaceId: string, stored: StoredConnection): Promise<StoredConnection> => {
    if (stored.provider.kind !== 'oauth2' || !expiresSoon(stored) || !stored.credentials.refreshToken) {
      return stored;
    }

    const { provider, module } = stored;

    try {
      return await engine.connections.refresh(workspaceId, stored.connection.id, async (current) =>
        expiresSoon(current) && current.credentials.refreshToken
          ? refreshTokens(
              fetch,
              provider.oauth,
              requireClient(module, provider),
              current.credentials.refreshToken,
              clock(),
            )
          : null,
      );
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant') {
        const message = `${module.name} no longer accepts this connection; connect it again (${error.message})`;
        await engine.connections.markAuthFailed(workspaceId, stored.connection.id, message);

        throw new EngineError('VALIDATION', message, { connectionId: stored.connection.id });
      }

      throw new EngineError('NETWORK', `Refreshing the ${module.name} connection failed: ${describe(error)}`);
    }
  };

  const connectionContextOf = (stored: StoredConnection): ConnectionContext => ({
    id: stored.connection.id,
    providerId: stored.connection.providerId,
    kind: stored.connection.kind,
    visibility: stored.connection.visibility,
    account: stored.connection.account,
    values: stored.connection.kind === 'api_key' ? stored.credentials : {},
    accessToken: stored.connection.kind === 'oauth2' ? (stored.credentials.accessToken ?? '') : '',
  });

  // --- jobs ---------------------------------------------------------------------------------

  /** Queue one of a module's jobs; `onBehalfOf` is the person whose action asked for it. */
  const enqueue = async (
    workspaceId: string,
    moduleId: string,
    name: string,
    payload: unknown,
    options: EnqueueOptions & { onBehalfOf?: string | null; schedule?: string } = {},
  ): Promise<{ id: string; status: string }> => {
    if (name !== ON_CONNECT_JOB && !registry.get(moduleId)?.jobs?.[name]) {
      throw new EngineError('VALIDATION', `Module "${moduleId}" has no job "${name}"`);
    }

    const retryLimit = options.retryLimit ?? JOB_DEFAULT_RETRY_LIMIT;

    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 20) {
      throw new EngineError('VALIDATION', 'retryLimit is a whole number from 0 to 20');
    }

    const job = await engine.jobs.enqueue(workspaceId, {
      moduleId,
      name,
      payload,
      key: options.key,
      runAt: options.delayMs ? new Date(clock().getTime() + options.delayMs) : undefined,
      maxAttempts: retryLimit + 1,
      schedule: options.schedule,
      connectionId: options.connectionId,
      onBehalfOf: options.onBehalfOf,
    });

    return { id: job.id, status: job.status };
  };

  /**
   * What module code sees: its variables, its own state (`kv`) and jobs, connections resolved on first use (and
   * remembered, so the outcome can be stamped on them), and a flag for credentials the outside service refused.
   * `person` is who started it, if anyone: jobs it queues remember them.
   */
  const moduleContext = async (
    workspaceId: string,
    module: InstalledModule,
    resolve: (providerId: string | undefined) => Promise<StoredConnection>,
    person: string | null = null,
  ) => {
    const used = new Map<string, StoredConnection>();
    const failure: { message: string | null } = { message: null };
    const context: ModuleContext = {
      workspaceId,
      variables: await variablesOf(workspaceId, module),
      connection: async (providerId) => {
        const key = providerId ?? '';
        const known = used.get(key);

        if (known) {
          return connectionContextOf(known);
        }

        const stored = await fresh(workspaceId, await resolve(providerId));
        used.set(key, stored);

        return connectionContextOf(stored);
      },
      reportAuthFailure: (message) => {
        failure.message = message ?? 'The outside service refused the credentials';
      },
      kv: {
        get: async <T>(key: string) => (await engine.moduleKv.get(workspaceId, module.moduleId, key)) as T | undefined,
        set: (key, value, options) => engine.moduleKv.set(workspaceId, module.moduleId, key, value, options),
        delete: (key) => engine.moduleKv.delete(workspaceId, module.moduleId, key),
      },
      jobs: {
        enqueue: (name, payload, options) =>
          enqueue(workspaceId, module.moduleId, name, payload, { ...options, onBehalfOf: person }),
      },
      fetch,
      logger,
    };
    /** Stamp how the run went on the connections it used. */
    const settle = async (error: string | null) => {
      for (const stored of used.values()) {
        if (failure.message) {
          await engine.connections.markAuthFailed(workspaceId, stored.connection.id, failure.message);
        } else {
          await engine.connections.recordUse(workspaceId, stored.connection.id, error);
        }
      }
    };

    return { context, settle };
  };

  /** The one connection a test or hook is about, as the only one its code can reach. */
  const contextFor = (workspaceId: string, stored: StoredConnection) =>
    moduleContext(workspaceId, stored.module, async () => stored);

  // --- actions ------------------------------------------------------------------------------

  /** Run an action as the caller: their own connection comes before the workspace's. */
  const runAction = async (
    ctx: EngineContext,
    moduleId: string,
    actionId: string,
    input: unknown,
  ): Promise<unknown> => {
    const { workspaceId } = ctx;
    const module = await installed(workspaceId, moduleId);
    const declared = module.actions.find((candidate) => keyOfId(candidate.id) === actionId);

    if (!declared) {
      throw new EngineError('NOT_FOUND', `${module.name} has no action "${actionId}"`);
    }

    const handler = moduleOf(moduleId).actions.find((candidate) => keyOfId(candidate.id) === actionId);

    if (!handler) {
      throw new EngineError('MISSING_DEPENDENCY', `${module.name} has no handler for "${actionId}" on this server`);
    }

    const { [CONNECTION_ID_INPUT]: connectionId, ...rest } = (input ?? {}) as Record<string, unknown>;
    const parsed = handler.input.safeParse(rest);

    if (!parsed.success) {
      throw fromZodError(parsed.error, `Invalid input for ${declared.label}`);
    }

    const userId = personOf(ctx.actor);
    const { context: base, settle } = await moduleContext(
      workspaceId,
      module,
      async (providerId) => {
        const stored = await engine.connections.resolve(workspaceId, module.moduleId, {
          providerId,
          connectionId: typeof connectionId === 'string' && connectionId ? connectionId : undefined,
          userId,
        });

        if (!stored) {
          throw new EngineError('VALIDATION', `${module.name} has no connections`);
        }

        return stored;
      },
      userId,
    );

    // A module with one kind of connection needs it whatever the handler does first: say so before it runs.
    if (module.connections.length === 1) {
      await base.connection();
    }

    // The module acts with its own role; the person who ran it is recorded with it.
    const actionCtx = moduleActorContext(workspaceId, module.moduleId, userId);
    const context: ActionContext = {
      ...base,
      actor: actionCtx.actor,
      engine: scopeEngine(engine, actionCtx),
      notify: (notification) => notifier.send(actionCtx, notification),
    };

    try {
      const output = await handler.run(parsed.data, context);
      await settle(null);

      return output ?? null;
    } catch (error) {
      const message = describe(error);
      await settle(message);

      if (isEngineError(error)) {
        throw error;
      }

      // The outside service refused or could not be reached: a bad gateway from the caller's point of view.
      throw new EngineError('NETWORK', `${declared.label} failed: ${message}`);
    }
  };

  // --- connection lifecycle -------------------------------------------------------------------

  /** Test a connection and stamp the outcome; providers without a test pass. */
  const test = async (workspaceId: string, stored: StoredConnection): Promise<ConnectionTestResult> => {
    const check = registry.get(stored.module.moduleId)?.connections?.[keyOfId(stored.provider.id)]?.test;
    let result: { ok: boolean; message?: string; account?: string };

    try {
      const { context } = await contextFor(workspaceId, await fresh(workspaceId, stored));
      result = check ? await check(context) : { ok: true, message: 'Connected' };
    } catch (error) {
      result = { ok: false, message: describe(error) };
    }

    await engine.connections.recordTest(workspaceId, stored.connection.id, result);

    return {
      ok: result.ok,
      ...(result.message ? { message: result.message } : {}),
      ...(result.account ? { account: result.account } : {}),
      testedAt: clock().toISOString(),
    };
  };

  /** A new connection's `onConnect` hook runs as a job: in the background, with retries, and listed with the others. */
  const startOnConnect = async (workspaceId: string, stored: StoredConnection, person: string | null) => {
    if (!registry.get(stored.module.moduleId)?.connections?.[keyOfId(stored.provider.id)]?.onConnect) {
      return;
    }

    await enqueue(workspaceId, stored.module.moduleId, ON_CONNECT_JOB, null, {
      connectionId: stored.connection.id,
      onBehalfOf: person,
    });
  };

  /** Run a disconnect hook with what the connection held; a failure is logged, never thrown. */
  const onDisconnect = async (workspaceId: string, stored: StoredConnection) => {
    const run = registry.get(stored.module.moduleId)?.connections?.[keyOfId(stored.provider.id)]?.onDisconnect;

    if (!run) {
      return;
    }

    try {
      const { context } = await contextFor(workspaceId, stored);
      await run(context);
    } catch (error) {
      logger.warn(
        `onDisconnect of ${stored.module.name} failed: ${describe(error)} (workspace ${workspaceId}, connection ${stored.connection.id})`,
      );
    }
  };

  /** Store an API key connection, test it and start its connect hook. */
  const connect = async (ctx: EngineContext, input: unknown): Promise<Connection> => {
    const created = await engine.connections.create(ctx, input);
    const stored = await engine.connections.open(ctx.workspaceId, created.id);
    const result = await test(ctx.workspaceId, stored);

    if (result.ok) {
      await startOnConnect(ctx.workspaceId, stored, personOf(ctx.actor));
    }

    return engine.connections.get(ctx, created.id);
  };

  /** Change a connection's values or label; new values are tested. */
  const update = async (ctx: EngineContext, id: string, patch: { values?: unknown }): Promise<Connection> => {
    await engine.connections.update(ctx, id, patch);

    if (patch.values !== undefined) {
      await test(ctx.workspaceId, await engine.connections.open(ctx.workspaceId, id));
    }

    return engine.connections.get(ctx, id);
  };

  const disconnect = async (ctx: EngineContext, id: string): Promise<void> => {
    const removed = await engine.connections.disconnect(ctx, id);

    if (removed) {
      await onDisconnect(ctx.workspaceId, removed);
    }
  };

  const listConnections = async (ctx: EngineContext, query: ConnectionQuery = {}): Promise<ConnectionList> => {
    const connections = await engine.connections.list(ctx, query);
    const snapshot = await engine.metadata.getSnapshot(ctx.workspaceId);
    const providers = snapshot.schema.modules
      .filter((module) => !query.module || module.moduleId === query.module)
      .flatMap((module) => module.connections.map((provider) => providerStatus(module, provider)));

    return { providers, connections };
  };

  // --- OAuth --------------------------------------------------------------------------------

  /** The consent page for the caller; the callback finishes the connection. */
  const authorize = async (ctx: EngineContext, input: ConnectionAuthorize): Promise<{ url: string }> => {
    const module = await installed(ctx.workspaceId, input.module);
    const provider = providerOf(module, input.provider, 'oauth2');

    if (!provider) {
      throw new EngineError('VALIDATION', `${module.name} has no account to connect`, { path: 'provider' });
    }

    const client = requireClient(module, provider);
    const pkce = provider.oauth.pkce ? pkcePair() : null;
    // A path on the studio only: `//host` and `/\host` would leave it.
    const returnTo = input.returnTo && /^\/(?![/\\])/.test(input.returnTo) ? input.returnTo : undefined;
    const { state } = await engine.connections.beginOAuth(ctx, {
      module: module.moduleId,
      provider: keyOfId(provider.id),
      visibility: input.visibility,
      codeVerifier: pkce?.verifier ?? null,
      returnTo,
    });

    return { url: authorizeUrl(provider.oauth, client, { state, codeChallenge: pkce?.challenge }) };
  };

  /**
   * The provider sent the person back: check the state is theirs and fresh, exchange the code, learn who they
   * connected as (the provider's test), store the connection and run its connect hook.
   */
  const completeOAuth = async (input: {
    moduleId: string;
    providerId: string;
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    errorDescription?: string | undefined;
    /** The signed-in person the callback request came from. */
    userId: string | null;
  }): Promise<OAuthOutcome> => {
    const record = input.state ? await engine.connections.takeOAuthState(input.state) : null;

    if (!record || record.moduleId !== input.moduleId || record.providerId !== input.providerId) {
      return {
        ok: false,
        message: 'This consent link expired or was already used; start connecting again',
        returnTo: null,
      };
    }

    const returnTo = record.returnTo;
    const fail = (message: string): OAuthOutcome => ({ ok: false, message, returnTo });

    if (record.userId !== input.userId) {
      return fail('Sign in as the person who started connecting, then try again');
    }

    if (input.error) {
      return fail(`The provider did not connect the account: ${input.errorDescription ?? input.error}`);
    }

    if (!input.code) {
      return fail('The provider sent no authorization code');
    }

    try {
      const module = await installed(record.workspaceId, record.moduleId);
      const provider = providerOf(module, record.providerId, 'oauth2');

      if (!provider) {
        return fail(`${module.name} no longer offers this connection`);
      }

      const tokens = await exchangeCode(
        fetch,
        provider.oauth,
        requireClient(module, provider),
        { code: input.code, codeVerifier: record.codeVerifier },
        clock(),
      );
      // Who the person connected as: the provider's own test says, before anything is stored.
      const check = registry.get(module.moduleId)?.connections?.[keyOfId(provider.id)]?.test;
      let account: string | null = null;

      if (check) {
        const pending: StoredConnection = {
          connection: {
            id: '',
            moduleId: module.moduleId,
            providerId: keyOfId(provider.id),
            kind: 'oauth2',
            visibility: record.visibility,
            ownerUserId: record.visibility === 'user' ? record.userId : null,
            label: null,
            account: null,
            status: 'connected',
            hints: {},
            scopes: tokens.scopes ?? [],
            expiresAt: tokens.expiresAt?.toISOString() ?? null,
            lastError: null,
            authFailedAt: null,
            lastTestedAt: null,
            lastUsedAt: null,
            webhookPath: null,
            createdBy: null,
            createdAt: clock().toISOString(),
            updatedAt: clock().toISOString(),
          },
          module,
          provider,
          credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? '', tokenType: '' },
        };
        const { context } = await contextFor(record.workspaceId, pending);
        const result = await check(context);

        if (!result.ok) {
          return fail(result.message ?? `${module.name} refused the new connection`);
        }

        account = result.account ?? null;
      }

      const connection = await engine.connections.saveOAuth({
        workspaceId: record.workspaceId,
        moduleId: module.moduleId,
        providerId: keyOfId(provider.id),
        visibility: record.visibility,
        userId: record.userId,
        account,
        tokens,
      });
      await startOnConnect(
        record.workspaceId,
        await engine.connections.open(record.workspaceId, connection.id),
        record.userId,
      );

      return { ok: true, connection, module, returnTo };
    } catch (error) {
      logger.warn(`OAuth callback for ${input.moduleId}/${input.providerId} failed: ${describe(error)}`);

      return fail(describe(error));
    }
  };

  // --- webhooks -----------------------------------------------------------------------------

  /** Verify a delivery with the connection whose URL received it and store the events it carries. */
  const receiveWebhook = async (token: string, request: { headers: Headers; body: string }): Promise<WebhookResult> => {
    if (request.body.length > WEBHOOK_MAX_BYTES) {
      throw new EngineError('VALIDATION', 'Webhook body is too large');
    }

    const found = await engine.connections.findByWebhookToken(token);

    if (!found) {
      throw new EngineError('NOT_FOUND', 'Unknown webhook');
    }

    const { workspaceId, module } = found;
    const webhook = registry.get(module.moduleId)?.webhook;

    if (!webhook) {
      throw new EngineError('VALIDATION', `Module "${module.moduleId}" does not accept webhooks on this server`);
    }

    let events: Awaited<ReturnType<typeof webhook.parse>>;

    try {
      const { context } = await contextFor(workspaceId, found);
      events = await webhook.parse(request, context);
    } catch (error) {
      if (error instanceof WebhookRejected) {
        logger.warn(`webhook for ${module.moduleId} in ${workspaceId} rejected: ${error.message}`);

        throw new EngineError('VALIDATION', error.message);
      }

      throw error;
    }

    const result = await engine.moduleEvents.receive(workspaceId, module.moduleId, events, found.connection.id);

    return { received: result.received, duplicates: result.duplicates };
  };

  // --- running jobs ---------------------------------------------------------------------------

  /**
   * Run one claimed job with the module's code, as the module with its role, and record the outcome. A
   * `RetryableError` puts it back with exponential backoff while attempts remain; anything else fails it for good.
   */
  const runJob = async (job: ClaimedJob): Promise<'succeeded' | 'retrying' | 'failed'> => {
    const giveUp = async (message: string) => {
      logger.warn(`job ${job.moduleId}/${job.name} (${job.id}) failed: ${message}`);
      await engine.jobs.fail(job, message, null);

      return 'failed' as const;
    };
    let module: InstalledModule;

    try {
      module = await installed(job.workspaceId, job.moduleId);
    } catch {
      return giveUp('The module is no longer installed');
    }

    // A worker that stopped mid-run leaves the job to be claimed again; that counts as an attempt too.
    if (job.attempts > job.maxAttempts) {
      return giveUp('It stopped while running too many times; it is not tried again');
    }

    const server = registry.get(job.moduleId);
    const isOnConnect = job.name === ON_CONNECT_JOB;
    const handler = isOnConnect ? undefined : server?.jobs?.[job.name];

    if (!isOnConnect && !handler) {
      return giveUp(`${module.name} has no job "${job.name}" on this server`);
    }

    let payload: unknown = job.payload;

    if (handler?.input) {
      const parsed = handler.input.safeParse(job.payload);

      if (!parsed.success) {
        return giveUp(`Invalid payload: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      }

      payload = parsed.data;
    }

    const { context: base, settle } = await moduleContext(
      job.workspaceId,
      module,
      async (providerId) => {
        if (job.connectionId) {
          return engine.connections.open(job.workspaceId, job.connectionId);
        }

        const stored = await engine.connections.resolve(job.workspaceId, module.moduleId, {
          providerId,
          userId: job.onBehalfOf,
        });

        if (!stored) {
          throw new EngineError('VALIDATION', `${module.name} has no connections`);
        }

        return stored;
      },
      job.onBehalfOf,
    );
    const actorCtx = moduleActorContext(job.workspaceId, job.moduleId, job.onBehalfOf);
    const context: JobContext = {
      ...base,
      actor: actorCtx.actor,
      engine: scopeEngine(engine, actorCtx),
      notify: (notification) => notifier.send(actorCtx, notification),
      job: {
        id: job.id,
        name: job.name,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        schedule: job.schedule,
      },
    };

    try {
      let result: unknown = null;

      if (isOnConnect) {
        const stored = await engine.connections.open(job.workspaceId, job.connectionId ?? '');
        await server?.connections?.[keyOfId(stored.provider.id)]?.onConnect?.(context);
      } else if (handler) {
        result = await handler.run(payload, context);
      }

      await settle(null);
      await engine.jobs.complete(job, result ?? null);

      return 'succeeded';
    } catch (error) {
      const message = describe(error);
      await settle(message);
      const retryable = error instanceof RetryableError || (error as Error | null)?.name === 'RetryableError';

      if (retryable && job.attempts < job.maxAttempts) {
        const wait = (error as RetryableError).retryAfterMs ?? backoffMs(job.attempts);
        await engine.jobs.fail(job, message, new Date(clock().getTime() + wait));

        return 'retrying';
      }

      return giveUp(message);
    }
  };

  // --- schedules ------------------------------------------------------------------------------

  const parsedCrons = new Map<string, CronSchedule>();
  /** The fire time each schedule last queued a job for, per workspace: most ticks then cost no write. */
  const queuedFor = new Map<string, string>();

  /**
   * Queue the job of every schedule that came due, in every workspace where its module is installed. A schedule
   * fires once per fire time: the job's key names it, so ticks, restarts and other servers add nothing twice, and a
   * fire time missed while the server was down runs once when it is back. Fire times before the install do not count.
   */
  const enqueueDueSchedules = async (now: Date = clock()): Promise<number> => {
    const scheduled = registry.list().filter((server) => (server.schedules?.length ?? 0) > 0);

    if (scheduled.length === 0) {
      return 0;
    }

    let queued = 0;

    for (const workspaceId of await engine.workspaces.list()) {
      const { schema } = await engine.metadata.getSnapshot(workspaceId);

      for (const server of scheduled) {
        const module = schema.modules.find((candidate) => candidate.moduleId === server.manifest.id);

        if (!module) {
          continue;
        }

        for (const schedule of server.schedules) {
          const cron = parsedCrons.get(schedule.cron) ?? parseCron(schedule.cron);
          parsedCrons.set(schedule.cron, cron);
          const at = previousCronTime(cron, now);

          if (!at || at.getTime() < Date.parse(module.installedAt)) {
            continue;
          }

          const key = `schedule:${schedule.name}:${at.toISOString()}`;
          const slot = `${workspaceId}:${module.moduleId}:${schedule.name}`;

          if (queuedFor.get(slot) === key) {
            continue;
          }

          await enqueue(workspaceId, module.moduleId, schedule.job, schedule.payload ?? null, {
            key,
            schedule: schedule.name,
          });
          queuedFor.set(slot, key);
          queued += 1;
        }
      }
    }

    return queued;
  };

  return {
    /** As the caller, who has `module.run` (the action registry checked). */
    runAction,
    listConnections,
    connect,
    update,
    disconnect,
    /** As the caller: the owner of a person's connection, an admin for the workspace's. */
    testAs: async (ctx: EngineContext, id: string) => test(ctx.workspaceId, await engine.connections.openAs(ctx, id)),
    authorize,
    completeOAuth,
    variables: async (ctx: EngineContext, moduleId: string) => {
      engine.permissions.authorize(ctx, 'module.read');

      return describeVariables(ctx.workspaceId, await installed(ctx.workspaceId, moduleId));
    },
    updateVariables: async (ctx: EngineContext, moduleId: string, patch: unknown) => {
      const module = await engine.moduleVariables.update(ctx, moduleId, patch);

      return describeVariables(ctx.workspaceId, module);
    },
    receiveWebhook,
    runJob,
    enqueueDueSchedules,
  };
};

export type ModuleRuntime = ReturnType<typeof createModuleRuntime>;
