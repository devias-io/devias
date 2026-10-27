import {
  actionInputProblem,
  CONNECTION_ID_INPUT,
  type Connection,
  type ConnectionAuthorizeResult,
  ConnectionAuthorizeSchema,
  ConnectionCreateSchema,
  type ConnectionList,
  ConnectionPatchSchema,
  type ConnectionProvider,
  type ConnectionQuery,
  type ConnectionTestResult,
  type ConnectionVisibility,
  DeviasApiError,
  defaultVisibility,
  type InstalledModule,
  type ModuleConnectionEventType,
  type ModuleManifest,
  type ModuleVariable,
  ModuleVariablesPatchSchema,
  maskSecret,
  personOf,
  providerAllows,
  providerOf,
  settingsProblem,
  WEBHOOK_EVENT_DEFAULT_LIMIT,
  type WebhookEvent,
  type WebhookEventPage,
  type WebhookEventQuery,
} from '@devias/core';
import type { MockStore } from './store';

/**
 * Module connections over the store: the same validation and visibility rules as the server, API keys that always
 * test fine, OAuth consents that connect at once (there is no provider to visit), actions that answer with a mock
 * output, and `receiveWebhookEvent` to push a webhook event in from tests or dev tools. Credentials are kept as masked
 * hints only; the mock never calls an outside service.
 */

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

const WEBHOOK_ORIGIN = 'https://mock.devias.local';
const WEBHOOK_PREFIX = '/api/webhooks/';

/** The installed module, or 404 like the server. */
const installedOf = (store: MockStore, ref: string): InstalledModule => {
  const module =
    store.modules.get(ref) ??
    [...store.modules.values()].find((candidate) => candidate.label.toLowerCase() === ref.toLowerCase());

  if (!module) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Module "${ref}" is not installed in this workspace`);
  }

  return module;
};

const person = (store: MockStore): string | null => personOf(store.actor);

const visible = (store: MockStore, connection: Connection): boolean =>
  connection.visibility === 'workspace' || connection.ownerUserId === person(store);

const connectionOf = (store: MockStore, id: string): Connection => {
  const connection = store.connections.get(id);

  if (!connection || !visible(store, connection)) {
    throw new DeviasApiError(404, 'NOT_FOUND', `No connection "${id}"`);
  }

  return connection;
};

const announce = (store: MockStore, type: ModuleConnectionEventType, connection: Connection) => {
  store.emit({ type, moduleId: connection.moduleId, connectionId: connection.id, providerId: connection.providerId });
  store.changed();
};

const withUrl = (connection: Connection): Connection => ({
  ...structuredClone(connection),
  webhookUrl: connection.webhookPath ? `${WEBHOOK_ORIGIN}${connection.webhookPath}` : null,
});

const visibilityFor = (provider: ConnectionProvider, asked: ConnectionVisibility | undefined): ConnectionVisibility => {
  const visibility = asked ?? defaultVisibility(provider);

  if (!providerAllows(provider, visibility)) {
    throw validation(`${provider.label} connections cannot belong to the ${visibility}`, {
      path: 'visibility',
    });
  }

  return visibility;
};

const newConnection = (
  store: MockStore,
  module: InstalledModule,
  provider: ConnectionProvider,
  visibility: ConnectionVisibility,
  extra: Partial<Connection>,
): Connection => {
  const now = store.now();

  return {
    id: store.newId(),
    moduleId: module.id,
    providerId: provider.id,
    kind: provider.kind,
    visibility,
    ownerUserId: visibility === 'user' ? person(store) : null,
    label: null,
    account: null,
    status: 'connected',
    hints: {},
    scopes: [],
    expiresAt: null,
    lastError: null,
    authFailedAt: null,
    lastTestedAt: now,
    lastUsedAt: null,
    webhookPath: module.events.length > 0 ? `${WEBHOOK_PREFIX}${store.newId().replace(/-/g, '')}` : null,
    createdBy: `${store.actor.kind}:${store.actor.id}`,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
};

const hintsOf = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, maskSecret(value)]));

/** What can be installed: core modules are always installed, so they are not offered. */
export const listCatalog = (store: MockStore): ModuleManifest[] =>
  structuredClone(store.catalog.filter((manifest) => !manifest.core));

/** The variables of an OAuth provider's app that are not set yet, as the server words it; null when it can be used. */
const oauthProblem = (store: MockStore, module: InstalledModule, provider: ConnectionProvider): string | null => {
  if (provider.kind !== 'oauth2') {
    return null;
  }

  const own = store.moduleVariables.get(module.id) ?? {};
  const missing = [provider.oauth.clientId, provider.oauth.clientSecret]
    .filter((ref) => ref !== undefined)
    .filter(
      (ref) => !(own[ref.variable] ?? module.variables.find((variable) => variable.id === ref.variable)?.defaultValue),
    )
    .map((ref) => module.variables.find((variable) => variable.id === ref.variable)?.label ?? ref.variable);

  return missing.length > 0 ? `Needs ${missing.join(' and ')} in Variables` : null;
};

export const listConnections = (store: MockStore, query: ConnectionQuery = {}): ConnectionList => {
  const modules = [...store.modules.values()].filter((module) => !query.module || module.id === query.module);

  return {
    providers: modules.flatMap((module) =>
      module.connections.map((provider) => {
        const problem = oauthProblem(store, module, provider);

        return {
          moduleId: module.id,
          providerId: provider.id,
          kind: provider.kind,
          label: provider.label,
          visibility: provider.visibility,
          available: problem === null,
          ...(problem ? { problem } : {}),
          ...(provider.kind === 'oauth2' ? { redirectUrl: `${WEBHOOK_ORIGIN}/api/oauth/callback` } : {}),
        };
      }),
    ),
    connections: [...store.connections.values()]
      .filter((connection) => modules.some((module) => module.id === connection.moduleId))
      .filter((connection) => visible(store, connection))
      .map(withUrl),
  };
};

export const getConnection = (store: MockStore, id: string): Connection => withUrl(connectionOf(store, id));

export const createConnection = (store: MockStore, input: unknown): Connection => {
  const parsed = ConnectionCreateSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid connection', { issues: parsed.error.issues });
  }

  const module = installedOf(store, parsed.data.module);
  const provider = providerOf(module, parsed.data.provider, 'api_key');

  if (!provider) {
    throw validation(`${module.label} has no API key connection to make`, { path: 'provider' });
  }

  const visibility = visibilityFor(provider, parsed.data.visibility);
  const problem = settingsProblem(provider.fields, parsed.data.values);

  if (problem) {
    throw validation(problem.message, { path: `values.${problem.name}` });
  }

  const owner = visibility === 'user' ? person(store) : null;
  const taken = [...store.connections.values()].find(
    (connection) =>
      connection.moduleId === module.id &&
      connection.providerId === provider.id &&
      connection.ownerUserId === owner &&
      connection.account === null,
  );

  if (taken) {
    throw new DeviasApiError(409, 'CONFLICT', `${module.label} is already connected; replace its values instead`, {
      connectionId: taken.id,
    });
  }

  const values = Object.fromEntries(Object.entries(parsed.data.values).filter(([, value]) => value.trim() !== ''));
  const connection = newConnection(store, module, provider, visibility, {
    label: parsed.data.label || null,
    hints: hintsOf(values),
  });
  store.connections.set(connection.id, connection);
  announce(store, 'module.connected', connection);

  return withUrl(connection);
};

export const updateConnection = (store: MockStore, id: string, rawPatch: unknown): Connection => {
  const parsed = ConnectionPatchSchema.safeParse(rawPatch);

  if (!parsed.success) {
    throw validation('Invalid connection', { issues: parsed.error.issues });
  }

  const connection = connectionOf(store, id);
  const module = installedOf(store, connection.moduleId);
  const provider = providerOf(module, connection.providerId);

  if (parsed.data.values) {
    if (provider?.kind !== 'api_key') {
      throw validation(`${module.label} connects through its consent page`);
    }

    const unknown = settingsProblem(provider.fields, parsed.data.values, { partial: true });

    if (unknown) {
      throw validation(unknown.message, { path: `values.${unknown.name}` });
    }

    const hints = { ...connection.hints };

    for (const [key, value] of Object.entries(parsed.data.values)) {
      if (value.trim() === '') {
        delete hints[key];
      } else {
        hints[key] = maskSecret(value.trim());
      }
    }

    const missing = provider.fields.find((field) => field.required && !hints[field.name]);

    if (missing) {
      throw validation(`${missing.label} is required`, { path: `values.${missing.name}` });
    }

    Object.assign(connection, { hints, status: 'connected', lastError: null, authFailedAt: null });
    connection.lastTestedAt = store.now();
  }

  if (parsed.data.label !== undefined) {
    connection.label = parsed.data.label || null;
  }

  connection.updatedAt = store.now();
  announce(store, 'module.connected', connection);

  return withUrl(connection);
};

/** No provider to visit: the consent succeeds at once, as the signed-in person. */
export const authorizeConnection = (store: MockStore, input: unknown): ConnectionAuthorizeResult => {
  const parsed = ConnectionAuthorizeSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid request', { issues: parsed.error.issues });
  }

  const module = installedOf(store, parsed.data.module);
  const provider = providerOf(module, parsed.data.provider, 'oauth2');

  if (!provider) {
    throw validation(`${module.label} has no account to connect`, { path: 'provider' });
  }

  const problem = oauthProblem(store, module, provider);

  if (problem) {
    throw validation(`${module.label}: ${problem}`);
  }

  const visibility = visibilityFor(provider, parsed.data.visibility);
  const owner = visibility === 'user' ? person(store) : null;
  const account = `${person(store) ?? 'someone'}@mock.devias.local`;
  const existing = [...store.connections.values()].find(
    (connection) =>
      connection.moduleId === module.id &&
      connection.providerId === provider.id &&
      connection.ownerUserId === owner &&
      connection.account === account,
  );
  const now = store.now();
  const connection = existing
    ? Object.assign(existing, { status: 'connected', lastError: null, authFailedAt: null, updatedAt: now })
    : newConnection(store, module, provider, visibility, { account, scopes: provider.oauth.scopes });
  store.connections.set(connection.id, connection);
  announce(store, 'module.connected', connection);

  return { url: 'about:blank#devias-mock-consent' };
};

export const testConnection = (store: MockStore, id: string): ConnectionTestResult => {
  const connection = connectionOf(store, id);
  const now = store.now();
  Object.assign(connection, { status: 'connected', lastError: null, authFailedAt: null, lastTestedAt: now });
  announce(store, 'module.connected', connection);

  return { ok: true, message: 'Connected (mock backend: nothing is called)', testedAt: now };
};

export const disconnectConnection = (store: MockStore, id: string): void => {
  const connection = connectionOf(store, id);
  store.connections.delete(id);
  announce(store, 'module.disconnected', connection);
};

export const listModuleVariables = (store: MockStore, moduleId: string): ModuleVariable[] => {
  const module = installedOf(store, moduleId);
  const own = store.moduleVariables.get(module.id) ?? {};

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

export const updateModuleVariables = (store: MockStore, moduleId: string, rawPatch: unknown): ModuleVariable[] => {
  const parsed = ModuleVariablesPatchSchema.safeParse(rawPatch);

  if (!parsed.success) {
    throw validation('Invalid variables', { issues: parsed.error.issues });
  }

  const module = installedOf(store, moduleId);
  const own = { ...(store.moduleVariables.get(module.id) ?? {}) };
  const typedByAMachine = store.actor.kind === 'agent' || store.actor.kind === 'workflow';

  for (const [id, value] of Object.entries(parsed.data.values)) {
    const variable = module.variables.find((candidate) => candidate.id === id);

    if (!variable) {
      throw validation(`Unknown variable "${id}"`, { path: `values.${id}` });
    }

    if (variable.secret && typedByAMachine) {
      throw validation(`${variable.label} is a secret: type it in Settings → Modules, not here`, {
        path: `values.${id}`,
      });
    }

    if (value.trim() === '') {
      delete own[id];
    } else {
      own[id] = value.trim();
    }
  }

  store.moduleVariables.set(module.id, own);
  store.changed();

  return listModuleVariables(store, moduleId);
};

/** Validate the input against the action's fields and answer with a mock output that names them (what the action returns). */
export const runModuleAction = (
  store: MockStore,
  moduleId: string,
  actionName: string,
  input: Record<string, unknown> = {},
): unknown => {
  const module = installedOf(store, moduleId);
  const action = module.actions.find((candidate) => candidate.name === actionName);

  if (!action) {
    throw new DeviasApiError(404, 'NOT_FOUND', `${module.label} has no action "${actionName}"`);
  }

  const { [CONNECTION_ID_INPUT]: connectionId, ...rest } = input;
  const usable = [...store.connections.values()].filter(
    (connection) =>
      connection.moduleId === module.id &&
      visible(store, connection) &&
      (connectionId === undefined || connection.id === connectionId),
  );

  if (module.connections.length > 0 && usable.length === 0) {
    throw validation(`${module.label} is not connected; connect it first`);
  }

  const problem = actionInputProblem(action, rest);

  if (problem) {
    throw validation(problem.message, { path: `input.${problem.name}` });
  }

  const used = usable.find((connection) => connection.visibility === 'user') ?? usable[0];

  if (used) {
    used.lastUsedAt = store.now();
    store.changed();
  }

  return { mock: true, module: moduleId, action: actionName, id: `mock_${store.newId()}`, input: rest };
};

export const listWebhookEvents = (
  store: MockStore,
  moduleId: string,
  query: WebhookEventQuery = {},
): WebhookEventPage => {
  installedOf(store, moduleId);
  const limit = query.limit ?? WEBHOOK_EVENT_DEFAULT_LIMIT;
  const newestFirst = store.webhookEvents
    .filter((event) => event.moduleId === moduleId && (!query.type || event.type === query.type))
    .reverse();
  let start = 0;

  if (query.cursor !== undefined) {
    const index = newestFirst.findIndex((event) => event.id === query.cursor);

    if (index < 0) {
      throw new DeviasApiError(400, 'INVALID_CURSOR', 'The events cursor is malformed');
    }

    start = index + 1;
  }

  const items = newestFirst.slice(start, start + limit);
  const last = items.at(-1);

  return { items: structuredClone(items), nextCursor: start + limit < newestFirst.length && last ? last.id : null };
};

/**
 * Push an event into an installed module, as the server does after verifying a webhook delivery. Returns the
 * stored event, or `null` when `externalId` arrived before. Workflows with a `module_event` trigger react through the feed.
 */
export const receiveWebhookEvent = (
  store: MockStore,
  moduleId: string,
  input: { type: string; externalId?: string; payload?: unknown },
): WebhookEvent | null => {
  installedOf(store, moduleId);

  if (
    input.externalId !== undefined &&
    store.webhookEvents.some((event) => event.moduleId === moduleId && event.externalId === input.externalId)
  ) {
    return null;
  }

  const event: WebhookEvent = {
    id: store.newId(),
    moduleId,
    type: input.type,
    externalId: input.externalId ?? null,
    payload: input.payload ?? null,
    receivedAt: store.now(),
  };
  store.webhookEvents.push(event);
  const receiver = [...store.connections.values()].find(
    (connection) => connection.moduleId === moduleId && connection.webhookPath !== null,
  );

  if (receiver) {
    receiver.lastUsedAt = event.receivedAt;
  }

  const caller = store.actor;
  store.actor = { kind: 'system', id: `module:${moduleId}` };

  try {
    store.emit({ type: 'module.event', moduleId, eventType: event.type, eventId: event.id });
  } finally {
    store.actor = caller;
  }

  store.changed();

  return structuredClone(event);
};
