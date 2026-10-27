import {
  CONNECTION_ID_INPUT,
  type Connection,
  type ConnectionAuthorize,
  type ConnectionList,
  type ConnectionProvider,
  type ConnectionProviderStatus,
  type ConnectionQuery,
  type ConnectionTestResult,
  type InstalledModule,
  type ModuleVariable,
  type OAuthConfig,
  personOf,
  providerOf,
  type WebhookResult,
} from '@devias/core';
import {
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
  /** How module code (and the OAuth token exchange) reaches outside services; tests pass a stub. */
  fetch?: ModuleFetch;
  clock?: () => Date;
}

/** Webhook bodies larger than this are refused before any signature work. */
export const WEBHOOK_MAX_BYTES = 1_000_000;

/** Access tokens this close to running out are refreshed before use. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Where providers send people back after consent, for every module and provider: it is registered with the service as
 * is, and the stored `state` says whose consent it finishes.
 */
export const OAUTH_CALLBACK_PATH = '/api/oauth/callback';

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
      (candidate) => candidate.id === moduleId || candidate.label.toLowerCase() === moduleId.toLowerCase(),
    );

    if (!module) {
      throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
    }

    return module;
  };

  // --- variables ------------------------------------------------------------------------------

  /** A module's variables in effect in a workspace, by id: the workspace's own values, then the module's defaults. */
  const variablesOf = async (workspaceId: string, module: InstalledModule): Promise<Record<string, string>> => {
    const own = module.variables.length > 0 ? await engine.variables.values(workspaceId, module.id) : {};
    const values: Record<string, string> = {};

    for (const variable of module.variables) {
      const value = own[variable.id] ?? variable.defaultValue;

      if (value !== undefined) {
        values[variable.id] = value;
      }
    }

    return values;
  };

  /** What a person or the agent may know of each variable: whether it is set, and, unless it is secret, its value. */
  const describeVariables = async (workspaceId: string, module: InstalledModule): Promise<ModuleVariable[]> => {
    const own = await engine.variables.values(workspaceId, module.id);

    return module.variables.map((variable) => {
      const set = own[variable.id];
      const value = set ?? variable.defaultValue;

      return {
        id: variable.id,
        label: variable.label,
        ...(variable.description ? { description: variable.description } : {}),
        secret: variable.secret,
        required: variable.required,
        value: variable.secret || value === undefined ? null : value,
        source: set !== undefined ? 'workspace' : value !== undefined ? 'default' : 'unset',
      };
    });
  };

  // --- providers --------------------------------------------------------------------------------

  /** The module's code for one of its providers, when it has some. */
  const handlerOf = (moduleId: string, providerId: string) =>
    registry.get(moduleId)?.connections.find((handler) => handler.id === providerId);

  /** The OAuth app a workspace set up for a provider, from the variables the provider names, or what is missing. */
  const oauthClientOf = async (
    workspaceId: string,
    module: InstalledModule,
    provider: { id: string; oauth: OAuthConfig },
  ): Promise<{ client: OAuthClient } | { problem: string }> => {
    const values = await variablesOf(workspaceId, module);
    const refs = [provider.oauth.clientId, provider.oauth.clientSecret].filter((ref) => ref !== undefined);
    const missing = refs.filter((ref) => !values[ref.variable]);

    if (missing.length > 0) {
      const labels = missing.map(
        (ref) => module.variables.find((variable) => variable.id === ref.variable)?.label ?? ref.variable,
      );

      return { problem: `Needs ${labels.join(' and ')} in Variables` };
    }

    return {
      client: {
        clientId: values[provider.oauth.clientId.variable] ?? '',
        clientSecret: provider.oauth.clientSecret ? values[provider.oauth.clientSecret.variable] : undefined,
        redirectUri: `${origin}${OAUTH_CALLBACK_PATH}`,
      },
    };
  };

  const providerStatus = async (
    workspaceId: string,
    module: InstalledModule,
    provider: ConnectionProvider,
  ): Promise<ConnectionProviderStatus> => {
    const found = provider.kind === 'oauth2' ? await oauthClientOf(workspaceId, module, provider) : null;

    return {
      moduleId: module.id,
      providerId: provider.id,
      kind: provider.kind,
      label: provider.label,
      visibility: provider.visibility,
      available: !found || !('problem' in found),
      ...(found && 'problem' in found ? { problem: found.problem } : {}),
      ...(provider.kind === 'oauth2' ? { redirectUrl: `${origin}${OAUTH_CALLBACK_PATH}` } : {}),
    };
  };

  const requireClient = async (
    workspaceId: string,
    module: InstalledModule,
    provider: { id: string; oauth: OAuthConfig },
  ): Promise<OAuthClient> => {
    const found = await oauthClientOf(workspaceId, module, provider);

    if ('problem' in found) {
      throw new EngineError('VALIDATION', `${module.label}: ${found.problem}`);
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
      // Read before the row is locked: a query from inside the locked section would wait on its own transaction.
      const client = await requireClient(workspaceId, module, provider);

      return await engine.connections.refresh(workspaceId, stored.connection.id, async (current) =>
        expiresSoon(current) && current.credentials.refreshToken
          ? refreshTokens(fetch, provider.oauth, client, current.credentials.refreshToken, clock())
          : null,
      );
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant') {
        const message = `${module.label} no longer accepts this connection; connect it again (${error.message})`;
        await engine.connections.markAuthFailed(workspaceId, stored.connection.id, message);

        throw new EngineError('VALIDATION', message, { connectionId: stored.connection.id });
      }

      throw new EngineError('NETWORK', `Refreshing the ${module.label} connection failed: ${describe(error)}`);
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

  /**
   * What module code sees: its variables, its own state (`kv`), connections resolved on first use (and remembered, so
   * the outcome can be stamped on them), and a flag for credentials the outside service refused.
   */
  const moduleContext = async (
    workspaceId: string,
    module: InstalledModule,
    resolve: (providerId: string | undefined) => Promise<StoredConnection>,
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
        get: async <T>(key: string) => (await engine.kv.get(workspaceId, module.id, key)) as T | undefined,
        set: (key, value, options) => engine.kv.set(workspaceId, module.id, key, value, options),
        delete: (key) => engine.kv.delete(workspaceId, module.id, key),
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
    actionName: string,
    input: unknown,
  ): Promise<unknown> => {
    const { workspaceId } = ctx;
    const module = await installed(workspaceId, moduleId);
    const declared = module.actions.find((candidate) => candidate.name === actionName);

    if (!declared) {
      throw new EngineError('NOT_FOUND', `${module.label} has no action "${actionName}"`);
    }

    // The handler is paired with the declaration by id, so a name the module changed still finds it.
    const handler = moduleOf(moduleId).actions.find((candidate) => candidate.id === declared.id);

    if (!handler) {
      throw new EngineError('MISSING_DEPENDENCY', `${module.label} has no handler for "${actionName}" on this server`);
    }

    const { [CONNECTION_ID_INPUT]: connectionId, ...rest } = (input ?? {}) as Record<string, unknown>;
    const parsed = handler.input.safeParse(rest);

    if (!parsed.success) {
      throw fromZodError(parsed.error, `Invalid input for ${declared.label}`);
    }

    const userId = personOf(ctx.actor);
    const { context: base, settle } = await moduleContext(workspaceId, module, async (providerId) => {
      const stored = await engine.connections.resolve(workspaceId, module.id, {
        providerId,
        connectionId: typeof connectionId === 'string' && connectionId ? connectionId : undefined,
        userId,
      });

      if (!stored) {
        throw new EngineError('VALIDATION', `${module.label} has no connections`);
      }

      return stored;
    });

    // A module with one kind of connection needs it whatever the handler does first: say so before it runs.
    if (module.connections.length === 1) {
      await base.connection();
    }

    // The module acts with its own role; the person who ran it is recorded with it.
    const actionCtx = moduleActorContext(workspaceId, module.id, userId);
    const context: ActionContext = {
      ...base,
      actor: actionCtx.actor,
      engine: scopeEngine(engine, actionCtx),
      notify: (notification) => notifier.send(actionCtx, notification),
      ...(ctx.step ? { step: ctx.step } : {}),
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

      // A failure the action says is worth another try (a rate limit, a timeout) keeps saying so: a workflow step
      // is tried again later.
      const retryable = error instanceof RetryableError || (error as Error | null)?.name === 'RetryableError';
      const retryAfterMs = retryable ? (error as RetryableError).retryAfterMs : undefined;

      // The outside service refused or could not be reached: a bad gateway from the caller's point of view.
      throw new EngineError(
        'NETWORK',
        `${declared.label} failed: ${message}`,
        retryable ? { retryable: true, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } : undefined,
      );
    }
  };

  // --- connection lifecycle -------------------------------------------------------------------

  /** Test a connection and stamp the outcome; providers without a test pass. */
  const test = async (workspaceId: string, stored: StoredConnection): Promise<ConnectionTestResult> => {
    const check = handlerOf(stored.module.id, stored.provider.id)?.test;
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

  /** Run a disconnect hook with what the connection held; a failure is logged, never thrown. */
  const onDisconnect = async (workspaceId: string, stored: StoredConnection) => {
    const run = handlerOf(stored.module.id, stored.provider.id)?.onDisconnect;

    if (!run) {
      return;
    }

    try {
      const { context } = await contextFor(workspaceId, stored);
      await run(context);
    } catch (error) {
      logger.warn(
        `onDisconnect of ${stored.module.label} failed: ${describe(error)} (workspace ${workspaceId}, connection ${stored.connection.id})`,
      );
    }
  };

  /** Store an API key connection and test it. */
  const connect = async (ctx: EngineContext, input: unknown): Promise<Connection> => {
    const created = await engine.connections.create(ctx, input);
    await test(ctx.workspaceId, await engine.connections.open(ctx.workspaceId, created.id));

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
    const providers = await Promise.all(
      snapshot.schema.modules
        .filter((module) => !query.module || module.id === query.module)
        .flatMap((module) => module.connections.map((provider) => providerStatus(ctx.workspaceId, module, provider))),
    );

    return { providers, connections };
  };

  // --- OAuth --------------------------------------------------------------------------------

  /** The consent page for the caller; the callback finishes the connection. */
  const authorize = async (ctx: EngineContext, input: ConnectionAuthorize): Promise<{ url: string }> => {
    const module = await installed(ctx.workspaceId, input.module);
    const provider = providerOf(module, input.provider, 'oauth2');

    if (!provider) {
      throw new EngineError('VALIDATION', `${module.label} has no account to connect`, { path: 'provider' });
    }

    const client = await requireClient(ctx.workspaceId, module, provider);
    const pkce = provider.oauth.pkce ? pkcePair() : null;
    // A path on the studio only: `//host` and `/\host` would leave it.
    const returnTo = input.returnTo && /^\/(?![/\\])/.test(input.returnTo) ? input.returnTo : undefined;
    const { state } = await engine.connections.beginOAuth(ctx, {
      module: module.id,
      provider: provider.id,
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
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    errorDescription?: string | undefined;
    /** The signed-in person the callback request came from. */
    userId: string | null;
  }): Promise<OAuthOutcome> => {
    const record = input.state ? await engine.connections.takeOAuthState(input.state) : null;

    if (!record) {
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
        return fail(`${module.label} no longer offers this connection`);
      }

      const tokens = await exchangeCode(
        fetch,
        provider.oauth,
        await requireClient(record.workspaceId, module, provider),
        { code: input.code, codeVerifier: record.codeVerifier },
        clock(),
      );
      // Who the person connected as: the provider's own test says, before anything is stored.
      const check = handlerOf(module.id, provider.id)?.test;
      let account: string | null = null;

      if (check) {
        const pending: StoredConnection = {
          connection: {
            id: '',
            moduleId: module.id,
            providerId: provider.id,
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
          return fail(result.message ?? `${module.label} refused the new connection`);
        }

        account = result.account ?? null;
      }

      const connection = await engine.connections.saveOAuth({
        workspaceId: record.workspaceId,
        moduleId: module.id,
        providerId: provider.id,
        visibility: record.visibility,
        userId: record.userId,
        account,
        tokens,
      });

      return { ok: true, connection, module, returnTo };
    } catch (error) {
      logger.warn(`OAuth callback for ${record.moduleId}/${record.providerId} failed: ${describe(error)}`);

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
    const webhook = registry.get(module.id)?.webhook;

    if (!webhook) {
      throw new EngineError('VALIDATION', `Module "${module.id}" does not accept webhooks on this server`);
    }

    let events: Awaited<ReturnType<typeof webhook.parse>>;

    try {
      const { context } = await contextFor(workspaceId, found);
      events = await webhook.parse(request, context);
    } catch (error) {
      if (error instanceof WebhookRejected) {
        logger.warn(`webhook for ${module.id} in ${workspaceId} rejected: ${error.message}`);

        throw new EngineError('VALIDATION', error.message);
      }

      throw error;
    }

    const result = await engine.webhookEvents.receive(workspaceId, module.id, events, found.connection.id);

    return { received: result.received, duplicates: result.duplicates };
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
      const module = await engine.variables.update(ctx, moduleId, patch);

      return describeVariables(ctx.workspaceId, module);
    },
    receiveWebhook,
  };
};

export type ModuleRuntime = ReturnType<typeof createModuleRuntime>;
