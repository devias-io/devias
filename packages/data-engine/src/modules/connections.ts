import { randomBytes } from 'node:crypto';
import {
  type Actor,
  type Connection,
  ConnectionCreateSchema,
  ConnectionPatchSchema,
  type ConnectionProvider,
  type ConnectionStatus,
  type ConnectionVisibility,
  defaultVisibility,
  type InstalledModule,
  keyOfId,
  type ModuleConnectionEventType,
  maskSecret,
  newId,
  OAUTH_STATE_TTL_MS,
  personOf,
  providerAllows,
  providerOf,
  settingsProblem,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import { actorString, type EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso } from '../db/exec';
import { EngineError, fromZodError, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, lockWorkspace, writeEvents } from '../events/feed';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import type { SecretBox } from './secret-box';

/**
 * Connections of installed modules to their outside services. An API key connection holds the values a person typed
 * for the provider's fields; an OAuth connection holds the tokens the provider granted. Either belongs to the
 * workspace or to one person. Credentials are sealed with the engine's secret box before they touch the database and
 * only opened for the server runtime (`resolve`, `open`, `findByWebhookToken`); callers get masked hints. Talking to
 * the outside service (tests, token exchange and refresh) is the runtime's job: it has the modules' code.
 */
export interface ConnectionsService {
  /** The workspace's connections and the caller's own, optionally of one module. */
  list(ctx: EngineContext, query?: { module?: string | undefined }): Promise<Connection[]>;
  get(ctx: EngineContext, id: string): Promise<Connection>;
  /** Store an API key connection; testing it is the runtime's job. */
  create(ctx: EngineContext, input: unknown): Promise<Connection>;
  /** Replace some values (an empty string clears an optional field) or the label. */
  update(ctx: EngineContext, id: string, patch: unknown): Promise<Connection>;
  /** Forget a connection; returns what it held, for the module's `onDisconnect` (null when its provider is gone). */
  disconnect(ctx: EngineContext, id: string): Promise<StoredConnection | null>;
  /** Open a connection the caller may change (to test it). */
  openAs(ctx: EngineContext, id: string): Promise<StoredConnection>;

  /** Remember an OAuth consent the caller starts; returns its `state`. */
  beginOAuth(ctx: EngineContext, input: BeginOAuth): Promise<{ state: string; module: InstalledModule }>;
  /** The consent `state` names, once: it is deleted, and expired ones answer null. */
  takeOAuthState(state: string): Promise<OAuthStateRecord | null>;
  /** Store what a finished consent granted: a new connection, or fresh tokens for the same person and account. */
  saveOAuth(input: SaveOAuth): Promise<Connection>;

  /**
   * Internal, unauthenticated readers and writers for the runtime. `resolve` picks the connection an action uses:
   * the one named, else the acting person's own, else the workspace's; null for a module that declares none.
   */
  resolve(workspaceId: string, moduleId: string, options: ResolveOptions): Promise<StoredConnection | null>;
  open(workspaceId: string, id: string): Promise<StoredConnection>;
  findByWebhookToken(token: string): Promise<(StoredConnection & { workspaceId: string }) | null>;
  /**
   * Replace an OAuth connection's tokens under a row lock, so concurrent callers refresh once: `fetch` sees the
   * tokens as they are once the lock is held, and returns new ones, or null when they are fresh already.
   */
  refresh(
    workspaceId: string,
    id: string,
    fetch: (stored: StoredConnection) => Promise<GrantedTokens | null>,
  ): Promise<StoredConnection>;
  /** Stamp a test's outcome: a failure marks the connection `auth_failed`. */
  recordTest(
    workspaceId: string,
    id: string,
    result: { ok: boolean; message?: string | undefined; account?: string | undefined },
  ): Promise<Connection>;
  /** Stamp `lastUsedAt` after an action; a success clears `auth_failed`, an error is kept as `lastError`. */
  recordUse(workspaceId: string, id: string, error?: string | null): Promise<void>;
  /** The outside service refused the credentials (an expired grant, a revoked key). */
  markAuthFailed(workspaceId: string, id: string, message: string): Promise<void>;
}

export interface StoredConnection {
  connection: Connection;
  module: InstalledModule;
  provider: ConnectionProvider;
  /** Decrypted: an API key connection's values by field key, or an OAuth connection's tokens (`OAuthCredentials`). */
  credentials: Record<string, string>;
}

/** What an OAuth connection's credentials hold. */
export interface OAuthCredentials extends Record<string, string> {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export interface GrantedTokens {
  accessToken: string;
  /** Kept from before when the provider sends none. */
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  expiresAt: Date | null;
  scopes?: string[] | undefined;
}

export interface ResolveOptions {
  providerId?: string | undefined;
  /** An explicit choice: the input's or the workflow step's `connectionId`. */
  connectionId?: string | undefined;
  /** The person acting, whose own connection comes before the workspace's. */
  userId?: string | null | undefined;
}

export interface BeginOAuth {
  module: string;
  provider?: string | undefined;
  visibility?: ConnectionVisibility | undefined;
  codeVerifier: string | null;
  returnTo?: string | undefined;
}

export interface OAuthStateRecord {
  workspaceId: string;
  userId: string;
  moduleId: string;
  providerId: string;
  visibility: ConnectionVisibility;
  codeVerifier: string | null;
  returnTo: string | null;
}

export interface SaveOAuth {
  workspaceId: string;
  moduleId: string;
  providerId: string;
  visibility: ConnectionVisibility;
  /** The person who agreed; owner of a `user` connection. */
  userId: string;
  account: string | null;
  tokens: GrantedTokens;
}

export interface ConnectionsServiceDeps {
  db: Db;
  bus: EventBus;
  clock: () => Date;
  secrets: SecretBox;
  /** Where the installed modules and their declarations come from. */
  metadata: Pick<MetadataService, 'getSnapshot'>;
}

interface ConnectionRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  module_id: string;
  provider_id: string;
  kind: string;
  visibility: string;
  owner_user_id: string | null;
  label: string | null;
  account: string | null;
  sealed: string;
  hints: unknown;
  scopes: unknown;
  expires_at: unknown;
  status: string;
  auth_failed_at: unknown;
  last_error: string | null;
  last_tested_at: unknown;
  last_used_at: unknown;
  webhook_token: string | null;
  created_by: string | null;
  created_at: unknown;
  updated_at: unknown;
}

const COLUMNS = sql.raw(
  'id, workspace_id, module_id, provider_id, kind, visibility, owner_user_id, label, account, sealed, hints, scopes, ' +
    'expires_at, status, auth_failed_at, last_error, last_tested_at, last_used_at, webhook_token, created_by, ' +
    'created_at, updated_at',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where outside services post webhooks; the server mounts the route at this path. */
export const WEBHOOK_PATH_PREFIX = '/api/webhooks/';
export const webhookPathOf = (token: string): string => `${WEBHOOK_PATH_PREFIX}${token}`;

const nullableIso = (value: unknown): string | null => (value === null || value === undefined ? null : toIso(value));

const toConnection = (row: ConnectionRow): Connection => ({
  id: row.id,
  moduleId: row.module_id,
  providerId: row.provider_id,
  kind: row.kind === 'oauth2' ? 'oauth2' : 'api_key',
  visibility: row.visibility === 'user' ? 'user' : 'workspace',
  ownerUserId: row.owner_user_id,
  label: row.label,
  account: row.account,
  status: row.status === 'auth_failed' ? 'auth_failed' : 'connected',
  hints: parseJson<Record<string, string>>(row.hints) ?? {},
  scopes: parseJson<string[]>(row.scopes) ?? [],
  expiresAt: nullableIso(row.expires_at),
  lastError: row.last_error,
  authFailedAt: nullableIso(row.auth_failed_at),
  lastTestedAt: nullableIso(row.last_tested_at),
  lastUsedAt: nullableIso(row.last_used_at),
  webhookPath: row.webhook_token ? webhookPathOf(row.webhook_token) : null,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const hintsOf = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, maskSecret(value)]));

/** The runtime's own writes (tests, token refreshes, webhook use) are recorded as the module. */
const moduleActor = (moduleId: string): Actor => ({ kind: 'system', id: `module:${moduleId}` });

/** Drop everything a module keeps per workspace at runtime; uninstalling calls it inside its own transaction. */
export const deleteModuleRuntime = async (tx: Db, workspaceId: string, moduleId: string): Promise<void> => {
  for (const table of ['module_event', 'module_connection', 'module_variable', 'oauth_state', 'job', 'module_kv']) {
    await runRaw(
      tx,
      sql`DELETE FROM ${sql.identifier(table)} WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}`,
    );
  }
};

export const createConnectionsService = (deps: ConnectionsServiceDeps): ConnectionsService => {
  const { db, bus, clock, secrets, metadata } = deps;

  /** The installed module, or NOT_FOUND. */
  const installed = async (workspaceId: string, moduleId: string): Promise<InstalledModule> => {
    const snapshot = await metadata.getSnapshot(workspaceId);
    const module = snapshot.schema.modules.find(
      (candidate) => candidate.moduleId === moduleId || candidate.name.toLowerCase() === moduleId.toLowerCase(),
    );

    if (!module) {
      throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
    }

    return module;
  };

  const readRow = async (tx: Db, where: SQL, lock = false): Promise<ConnectionRow | null> => {
    const rows = await runRaw<ConnectionRow>(
      tx,
      sql`SELECT ${COLUMNS} FROM module_connection WHERE ${where} ${lock ? sql`FOR UPDATE` : sql``}`,
    );

    return rows[0] ?? null;
  };

  const byId = (workspaceId: string, id: string): SQL =>
    sql`workspace_id = ${workspaceId} AND id = ${UUID.test(id) ? id : '00000000-0000-0000-0000-000000000000'}::uuid`;

  const openRow = (module: InstalledModule, row: ConnectionRow): Record<string, string> => {
    try {
      return parseJson<Record<string, string>>(secrets.open(row.sealed)) ?? {};
    } catch {
      throw new EngineError(
        'INTERNAL',
        `The connection to ${module.name} cannot be decrypted; was the encryption key changed? Connect it again.`,
      );
    }
  };

  const stored = async (row: ConnectionRow): Promise<StoredConnection> =>
    storedIn(await installed(row.workspace_id, row.module_id), row);

  /** A row with the module it belongs to: no query, so it can run inside a transaction. */
  const storedIn = (module: InstalledModule, row: ConnectionRow): StoredConnection => {
    const provider = providerOf(module, row.provider_id);

    if (!provider) {
      throw new EngineError(
        'MISSING_DEPENDENCY',
        `${module.name} no longer declares the connection "${row.provider_id}"; connect it again`,
      );
    }

    return { connection: toConnection(row), module, provider, credentials: openRow(module, row) };
  };

  /** Who may see a connection: everyone with `module.read` for the workspace's, only its owner for a person's. */
  const visibleTo = (ctx: EngineContext, row: Pick<ConnectionRow, 'visibility' | 'owner_user_id'>): boolean =>
    row.visibility === 'workspace' || (row.owner_user_id !== null && row.owner_user_id === personOf(ctx.actor));

  /** May the caller change it: admins the workspace's, the owner their own. */
  const authorizeChange = (ctx: EngineContext, visibility: ConnectionVisibility) =>
    authorize(ctx, visibility === 'workspace' ? 'module.manage' : 'module.connect');

  /** The connection the caller may see, or NOT_FOUND (other people's connections are not theirs to know about). */
  const visibleRow = async (ctx: EngineContext, id: string): Promise<ConnectionRow> => {
    authorize(ctx, 'module.read');
    const row = await readRow(db, byId(ctx.workspaceId, id));

    if (!row || !visibleTo(ctx, row)) {
      throw new EngineError('NOT_FOUND', `No connection "${id}"`);
    }

    return row;
  };

  /** One write transaction: lock the workspace, mutate, announce the connection on the feed. */
  const write = async <T>(
    workspaceId: string,
    actor: Actor,
    mutate: (
      tx: Db,
      now: Date,
    ) => Promise<{ result: T; event?: { type: ModuleConnectionEventType; row: ConnectionRow } }>,
  ): Promise<T> => {
    const now = clock();
    const outcome = await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      const { result, event } = await mutate(tx, now);

      if (!event) {
        return { result, sequence: null };
      }

      const sequence = await allocateSequences(tx, workspaceId, 1);
      await writeEvents(tx, workspaceId, [
        {
          sequence,
          type: event.type,
          actor,
          occurredAt: now,
          moduleId: event.row.module_id,
          entity: 'connection',
          entityId: event.row.id,
          payload: { providerId: event.row.provider_id },
        },
      ]);
      await bus.publish(tx, workspaceId, { seq: sequence });

      return { result, sequence };
    });

    if (outcome.sequence !== null) {
      bus.emitLocal(workspaceId, { seq: outcome.sequence });
    }

    return outcome.result;
  };

  const requireRow = (row: ConnectionRow | undefined, id: string): ConnectionRow => {
    if (!row) {
      throw new EngineError('NOT_FOUND', `No connection "${id}"`);
    }

    return row;
  };

  /** The values an API key connection ends up with, checked against the provider's fields. */
  const mergeValues = (
    provider: Extract<ConnectionProvider, { kind: 'api_key' }>,
    current: Record<string, string>,
    given: Record<string, string>,
  ): Record<string, string> => {
    const unknown = settingsProblem(provider.fields, given, { partial: true });

    if (unknown) {
      throw validationError(unknown.message, { path: `values.${unknown.name}` });
    }

    const merged = { ...current };

    for (const [key, value] of Object.entries(given)) {
      if (value.trim() === '') {
        delete merged[key];
      } else {
        merged[key] = value.trim();
      }
    }

    const problem = settingsProblem(provider.fields, merged);

    if (problem) {
      throw validationError(problem.message, { path: `values.${problem.name}` });
    }

    return merged;
  };

  const webhookTokenFor = (module: InstalledModule): string | null =>
    module.events.length > 0 ? randomBytes(16).toString('hex') : null;

  /** Visibility a request ends up with: what it asks for, else the provider's default; it must be one it allows. */
  const visibilityFor = (
    provider: ConnectionProvider,
    asked: ConnectionVisibility | undefined,
  ): ConnectionVisibility => {
    const visibility = asked ?? defaultVisibility(provider);

    if (!providerAllows(provider, visibility)) {
      throw validationError(
        `${provider.label} connections belong to ${provider.visibility === 'user' ? 'each person' : 'the workspace'}`,
        { path: 'visibility' },
      );
    }

    return visibility;
  };

  const ownerFor = (ctx: EngineContext, visibility: ConnectionVisibility): string | null => {
    if (visibility === 'workspace') {
      return null;
    }

    const person = personOf(ctx.actor);

    if (!person) {
      throw new EngineError('FORBIDDEN', 'Only a person can have a connection of their own');
    }

    return person;
  };

  return {
    list: async (ctx, query = {}) => {
      authorize(ctx, 'module.read');
      const snapshot = await metadata.getSnapshot(ctx.workspaceId);
      const installedIds = new Set(snapshot.schema.modules.map((module) => module.moduleId));
      const rows = await runRaw<ConnectionRow>(
        db,
        sql`SELECT ${COLUMNS} FROM module_connection WHERE workspace_id = ${ctx.workspaceId}
            ${query.module ? sql`AND module_id = ${query.module}` : sql``}
            ORDER BY module_id, visibility DESC, created_at`,
      );

      return rows.filter((row) => installedIds.has(row.module_id) && visibleTo(ctx, row)).map(toConnection);
    },

    get: async (ctx, id) => toConnection(await visibleRow(ctx, id)),

    create: async (ctx, input) => {
      authorize(ctx, 'module.connect');
      const parsed = ConnectionCreateSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid connection');
      }

      const module = await installed(ctx.workspaceId, parsed.data.module);
      const provider = providerOf(module, parsed.data.provider, 'api_key');

      if (!provider) {
        throw validationError(
          parsed.data.provider
            ? `${module.name} has no API key connection "${parsed.data.provider}"`
            : `${module.name} has no single API key connection; name the provider`,
          { path: 'provider' },
        );
      }

      const visibility = visibilityFor(provider, parsed.data.visibility);
      authorizeChange(ctx, visibility);
      const owner = ownerFor(ctx, visibility);
      const values = mergeValues(provider, {}, parsed.data.values);
      const taken = await readRow(
        db,
        sql`workspace_id = ${ctx.workspaceId} AND module_id = ${module.moduleId} AND provider_id = ${keyOfId(provider.id)}
            AND owner_user_id IS NOT DISTINCT FROM ${owner} AND account IS NULL`,
      );

      if (taken) {
        throw new EngineError(
          'CONFLICT',
          `${module.name} is already connected${owner ? ' for you' : ' for the workspace'}; replace its values instead`,
          { connectionId: taken.id },
        );
      }

      return write(ctx.workspaceId, ctx.actor, async (tx, now) => {
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`INSERT INTO module_connection (id, workspace_id, module_id, provider_id, kind, visibility, owner_user_id,
                label, sealed, hints, webhook_token, created_by, created_at, updated_at)
              VALUES (${newId()}::uuid, ${ctx.workspaceId}, ${module.moduleId}, ${keyOfId(provider.id)}, 'api_key', ${visibility},
                ${owner}, ${parsed.data.label || null}, ${secrets.seal(JSON.stringify(values))},
                ${JSON.stringify(hintsOf(values))}::jsonb, ${webhookTokenFor(module)}, ${actorString(ctx.actor)},
                ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
              RETURNING ${COLUMNS}`,
        );
        const row = requireRow(rows[0], 'new');

        return { result: toConnection(row), event: { type: 'module.connected', row } };
      });
    },

    update: async (ctx, id, rawPatch) => {
      const parsed = ConnectionPatchSchema.safeParse(rawPatch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid connection');
      }

      const row = await visibleRow(ctx, id);
      const current = await stored(row);
      authorizeChange(ctx, current.connection.visibility);
      const { values, label } = parsed.data;

      if (values && current.provider.kind !== 'api_key') {
        throw validationError(`${current.module.name} connects through its consent page; connect it again`, {
          path: 'values',
        });
      }

      const merged =
        values && current.provider.kind === 'api_key'
          ? mergeValues(current.provider, current.credentials, values)
          : current.credentials;

      return write(ctx.workspaceId, ctx.actor, async (tx, now) => {
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`UPDATE module_connection SET
                ${label === undefined ? sql`` : sql`label = ${label || null},`}
                ${
                  values
                    ? sql`sealed = ${secrets.seal(JSON.stringify(merged))}, hints = ${JSON.stringify(hintsOf(merged))}::jsonb,
                      status = 'connected', auth_failed_at = NULL, last_error = NULL,`
                    : sql``
                }
                updated_at = ${now.toISOString()}::timestamptz
              WHERE ${byId(ctx.workspaceId, id)} RETURNING ${COLUMNS}`,
        );
        const updated = requireRow(rows[0], id);

        return { result: toConnection(updated), event: { type: 'module.connected', row: updated } };
      });
    },

    disconnect: async (ctx, id) => {
      const row = await visibleRow(ctx, id);
      const current = await stored(row).catch(() => null);
      authorizeChange(ctx, row.visibility === 'user' ? 'user' : 'workspace');
      await write(ctx.workspaceId, ctx.actor, async (tx) => {
        await runRaw(tx, sql`DELETE FROM module_connection WHERE ${byId(ctx.workspaceId, id)}`);

        return { result: undefined, event: { type: 'module.disconnected', row } };
      });

      return current;
    },

    openAs: async (ctx, id) => {
      const row = await visibleRow(ctx, id);
      authorizeChange(ctx, row.visibility === 'user' ? 'user' : 'workspace');

      return stored(row);
    },

    beginOAuth: async (ctx, input) => {
      authorize(ctx, 'module.connect');
      const module = await installed(ctx.workspaceId, input.module);
      const provider = providerOf(module, input.provider, 'oauth2');

      if (!provider) {
        throw validationError(
          input.provider
            ? `${module.name} has no account to connect named "${input.provider}"`
            : `${module.name} has no single account to connect; name the provider`,
          { path: 'provider' },
        );
      }

      const visibility = visibilityFor(provider, input.visibility);
      authorizeChange(ctx, visibility);
      const person = personOf(ctx.actor);

      if (!person) {
        throw new EngineError('FORBIDDEN', 'Only a person can connect an account');
      }

      const state = randomBytes(24).toString('base64url');
      const now = clock();
      await runRaw(db, sql`DELETE FROM oauth_state WHERE expires_at < ${now.toISOString()}::timestamptz`);
      await runRaw(
        db,
        sql`INSERT INTO oauth_state (state, workspace_id, user_id, module_id, provider_id, visibility, code_verifier,
              return_to, expires_at, created_at)
            VALUES (${state}, ${ctx.workspaceId}, ${person}, ${module.moduleId}, ${keyOfId(provider.id)}, ${visibility},
              ${input.codeVerifier ? secrets.seal(input.codeVerifier) : null}, ${input.returnTo ?? null},
              ${new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`,
      );

      return { state, module };
    },

    takeOAuthState: async (state) => {
      const rows = await runRaw<{
        workspace_id: string;
        user_id: string;
        module_id: string;
        provider_id: string;
        visibility: string;
        code_verifier: string | null;
        return_to: string | null;
        expires_at: unknown;
      }>(db, sql`DELETE FROM oauth_state WHERE state = ${state} RETURNING *`);
      const row = rows[0];

      if (!row || new Date(toIso(row.expires_at)).getTime() < clock().getTime()) {
        return null;
      }

      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        moduleId: row.module_id,
        providerId: row.provider_id,
        visibility: row.visibility === 'workspace' ? 'workspace' : 'user',
        codeVerifier: row.code_verifier ? secrets.open(row.code_verifier) : null,
        returnTo: row.return_to,
      };
    },

    saveOAuth: async (input) => {
      const module = await installed(input.workspaceId, input.moduleId);
      const owner = input.visibility === 'user' ? input.userId : null;
      const credentials: OAuthCredentials = {
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken ?? '',
        tokenType: input.tokens.tokenType ?? 'Bearer',
      };
      const scopes = JSON.stringify(input.tokens.scopes ?? []);
      const expires = input.tokens.expiresAt ? input.tokens.expiresAt.toISOString() : null;
      const actor: Actor = { kind: 'user', id: input.userId };

      return write(input.workspaceId, actor, async (tx, now) => {
        const previous = await readRow(
          tx,
          sql`workspace_id = ${input.workspaceId} AND module_id = ${module.moduleId} AND provider_id = ${input.providerId}
              AND owner_user_id IS NOT DISTINCT FROM ${owner} AND account IS NOT DISTINCT FROM ${input.account}`,
        );

        // A provider that sends no refresh token on a second consent keeps the one it sent before.
        if (!credentials.refreshToken && previous) {
          credentials.refreshToken =
            parseJson<Record<string, string>>(secrets.open(previous.sealed))?.refreshToken ?? '';
        }

        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`INSERT INTO module_connection (id, workspace_id, module_id, provider_id, kind, visibility, owner_user_id,
                account, sealed, scopes, expires_at, webhook_token, created_by, created_at, updated_at)
              VALUES (${newId()}::uuid, ${input.workspaceId}, ${module.moduleId}, ${input.providerId}, 'oauth2',
                ${input.visibility}, ${owner}, ${input.account}, ${secrets.seal(JSON.stringify(credentials))},
                ${scopes}::jsonb, ${expires}::timestamptz, ${webhookTokenFor(module)}, ${actorString(actor)},
                ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
              ON CONFLICT ON CONSTRAINT module_connection_owner_account_uq DO UPDATE SET
                sealed = EXCLUDED.sealed, scopes = EXCLUDED.scopes, expires_at = EXCLUDED.expires_at,
                status = 'connected', auth_failed_at = NULL, last_error = NULL, updated_at = EXCLUDED.updated_at
              RETURNING ${COLUMNS}`,
        );
        const row = requireRow(rows[0], 'new');

        return { result: toConnection(row), event: { type: 'module.connected', row } };
      });
    },

    resolve: async (workspaceId, moduleId, options) => {
      const module = await installed(workspaceId, moduleId);

      if (options.connectionId) {
        const row = await readRow(db, byId(workspaceId, options.connectionId));

        if (!row || row.module_id !== module.moduleId) {
          throw new EngineError('NOT_FOUND', `${module.name} has no connection "${options.connectionId}"`);
        }

        // A person's connection serves them only (and agents acting for them), never someone else's run.
        if (row.visibility === 'user' && row.owner_user_id !== options.userId) {
          throw new EngineError('FORBIDDEN', `That ${module.name} connection belongs to someone else`);
        }

        return stored(row);
      }

      if (module.connections.length === 0) {
        return null;
      }

      const provider = providerOf(module, options.providerId);

      if (!provider) {
        throw new EngineError(
          'VALIDATION',
          options.providerId
            ? `${module.name} has no connection "${options.providerId}"`
            : `${module.name} has several kinds of connection; the action must name one`,
        );
      }

      // The person's own connection first, then the workspace's; the most recently connected of each.
      const rows = await runRaw<ConnectionRow>(
        db,
        sql`SELECT ${COLUMNS} FROM module_connection
            WHERE workspace_id = ${workspaceId} AND module_id = ${module.moduleId} AND provider_id = ${keyOfId(provider.id)}
              AND (visibility = 'workspace' ${options.userId ? sql`OR owner_user_id = ${options.userId}` : sql``})
            ORDER BY (visibility = 'user') DESC, (status = 'connected') DESC, updated_at DESC LIMIT 1`,
      );
      const row = rows[0];

      if (!row) {
        throw new EngineError(
          'VALIDATION',
          `${module.name} is not connected${provider.visibility === 'user' ? ' for you' : ''}; connect it first`,
          { module: module.moduleId, provider: keyOfId(provider.id) },
        );
      }

      return stored(row);
    },

    open: async (workspaceId, id) => {
      const row = await readRow(db, byId(workspaceId, id));

      if (!row) {
        throw new EngineError('NOT_FOUND', `No connection "${id}"`);
      }

      return stored(row);
    },

    findByWebhookToken: async (token) => {
      if (!/^[0-9a-f]{32}$/.test(token)) {
        return null;
      }

      const row = await readRow(db, sql`webhook_token = ${token}`);

      if (!row) {
        return null;
      }

      try {
        return { workspaceId: row.workspace_id, ...(await stored(row)) };
      } catch (error) {
        if (error instanceof EngineError && error.code === 'NOT_FOUND') {
          return null;
        }

        throw error;
      }
    },

    refresh: async (workspaceId, id, fetch) => {
      // The module is looked up first: inside the transaction only `tx` may query (PGlite holds every other query
      // until the transaction ends).
      const before = await readRow(db, byId(workspaceId, id));

      if (!before) {
        throw new EngineError('NOT_FOUND', `No connection "${id}"`);
      }

      const module = await installed(workspaceId, before.module_id);
      const result = await db.transaction(async (tx) => {
        const row = await readRow(tx, byId(workspaceId, id), true);

        if (!row) {
          throw new EngineError('NOT_FOUND', `No connection "${id}"`);
        }

        const current = storedIn(module, row);
        const tokens = await fetch(current);

        if (!tokens) {
          return current;
        }

        const credentials: OAuthCredentials = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? current.credentials.refreshToken ?? '',
          tokenType: tokens.tokenType ?? current.credentials.tokenType ?? 'Bearer',
        };
        const now = clock();
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`UPDATE module_connection SET sealed = ${secrets.seal(JSON.stringify(credentials))},
                expires_at = ${tokens.expiresAt ? tokens.expiresAt.toISOString() : null}::timestamptz,
                ${tokens.scopes ? sql`scopes = ${JSON.stringify(tokens.scopes)}::jsonb,` : sql``}
                updated_at = ${now.toISOString()}::timestamptz
              WHERE ${byId(workspaceId, id)} RETURNING ${COLUMNS}`,
        );
        const updated = requireRow(rows[0], id);

        return { ...current, connection: toConnection(updated), credentials };
      });

      return result;
    },

    recordTest: async (workspaceId, id, result) => {
      const status: ConnectionStatus = result.ok ? 'connected' : 'auth_failed';
      const current = await readRow(db, byId(workspaceId, id));

      if (!current) {
        throw new EngineError('NOT_FOUND', `No connection "${id}"`);
      }

      return write(workspaceId, moduleActor(current.module_id), async (tx, now) => {
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`UPDATE module_connection SET status = ${status},
                last_error = ${result.ok ? null : (result.message ?? 'The test failed')},
                auth_failed_at = ${result.ok ? null : now.toISOString()}::timestamptz,
                ${result.ok && result.account ? sql`account = ${result.account},` : sql``}
                last_tested_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
              WHERE ${byId(workspaceId, id)} RETURNING ${COLUMNS}`,
        );
        const row = requireRow(rows[0], id);

        return {
          result: toConnection(row),
          event: { type: result.ok ? 'module.connected' : 'module.connection.failed', row },
        };
      });
    },

    recordUse: async (workspaceId, id, error = null) => {
      const row = await readRow(db, byId(workspaceId, id));

      if (!row) {
        return;
      }

      const now = clock().toISOString();

      if (error || row.status === 'connected') {
        await runRaw(
          db,
          sql`UPDATE module_connection SET last_used_at = ${now}::timestamptz, last_error = ${error}
              WHERE ${byId(workspaceId, id)}`,
        );

        return;
      }

      // It works again: worth announcing, so pages showing it as failed recover.
      await write(workspaceId, moduleActor(row.module_id), async (tx) => {
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`UPDATE module_connection SET status = 'connected', auth_failed_at = NULL, last_error = NULL,
                last_used_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
              WHERE ${byId(workspaceId, id)} RETURNING ${COLUMNS}`,
        );

        return { result: undefined, event: { type: 'module.connected', row: requireRow(rows[0], id) } };
      });
    },

    markAuthFailed: async (workspaceId, id, message) => {
      const row = await readRow(db, byId(workspaceId, id));

      if (!row) {
        return;
      }

      await write(workspaceId, moduleActor(row.module_id), async (tx, now) => {
        const rows = await runRaw<ConnectionRow>(
          tx,
          sql`UPDATE module_connection SET status = 'auth_failed', last_error = ${message},
                auth_failed_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
              WHERE ${byId(workspaceId, id)} RETURNING ${COLUMNS}`,
        );
        const updated = requireRow(rows[0], id);

        // Announced once, when it starts failing; later failures only refresh the message.
        return row.status === 'auth_failed'
          ? { result: undefined }
          : { result: undefined, event: { type: 'module.connection.failed', row: updated } };
      });
    },
  };
};
