import type {
  ActionDefinition,
  Actor,
  ConnectionKind,
  ConnectionVisibility,
  ModuleManifest,
  NotificationInput,
  NotificationSendResult,
} from '@devias/core';
import type { Logger, ScopedEngine } from '@devias/data-engine';
import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * Authoring API for the server side of a module. It pairs a manifest with the code behind
 * its declared actions, its connections' tests and hooks, and the parser of its webhook, plus
 * optional HTTP routes mounted at `/api/workspaces/:workspaceId/mod/<moduleId>/*`. The agent reaches a module
 * through its declared actions (each one a tool, a route and a workflow step) and through core's
 * actions, never through tools of its own: what a module can do is declared once, for people, workflows and agents alike.
 */

/** Variables every module route can read: the caller's engine context and workspace id. */
export type ModuleRouteEnv = {
  Variables: {
    workspaceId: string;
    actor: Actor;
    engine: ScopedEngine;
  };
};

export type ModuleRouter = Hono<ModuleRouteEnv>;

export type { NotificationInput, NotificationSendResult, NotificationTarget } from '@devias/core';

// ---------------------------------------------------------------------------------------------
// Connections, actions and webhooks
// ---------------------------------------------------------------------------------------------

/** The subset of `fetch` module code uses to reach outside services; tests pass a stub. */
export type ModuleFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A connection as module code sees it: who it is for, and its decrypted credentials. */
export interface ConnectionContext {
  id: string;
  providerId: string;
  kind: ConnectionKind;
  visibility: ConnectionVisibility;
  /** Who it is connected as at the outside service, when known. */
  account: string | null;
  /** An API key connection's values by field key; missing optional ones are absent. Empty for OAuth. */
  values: Record<string, string>;
  /** An OAuth connection's access token, refreshed when it was about to run out. Empty for API keys. */
  accessToken: string;
}

/** What a module's code sees wherever it runs: its variables, its connections and a way out. */
export interface ModuleContext {
  workspaceId: string;
  /** The module's variables in effect, by id: the workspace's values, then the defaults. Unset ones are absent. */
  variables: Record<string, string>;
  /**
   * The connection to use. In an action: the one the caller picked (`connectionId`), else the acting person's own,
   * else the workspace's. In a webhook: the one whose URL received it. In a test or hook: the one concerned.
   * `providerId` picks among several kinds; a module with one needs none. Throws when there is none to use.
   */
  connection(providerId?: string): Promise<ConnectionContext>;
  /**
   * The outside service refused the credentials (a revoked key, an expired grant): the connection is marked
   * `auth_failed` once the code finishes, so people are asked to connect again. Throw afterwards as usual.
   */
  reportAuthFailure(message?: string): void;
  /** The module's own small state in this workspace (sync cursors and the like), as JSON by key. */
  kv: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** `ttlMs` makes the entry expire. */
    set(key: string, value: unknown, options?: { ttlMs?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  };
  fetch: ModuleFetch;
  logger: Logger;
}

/** What an action handler sees while it runs: its connections and variables, plus an engine acting as the action itself. */
export interface ActionContext extends ModuleContext {
  /** `{ kind: 'function', id: '<moduleId>.<actionId>' }`: what the engine records as the actor. */
  actor: Actor;
  /** Engine methods pre-bound to this workspace and actor. */
  engine: ScopedEngine;
  /**
   * Notify people in the workspace: a title, an optional Markdown body, a level, where it points and who gets it
   * (`to.all`, `to.roles`, `to.users`; `to.me` is for people and fails here). Sent as the action; use a `key` so a
   * repeated send replaces the unread notification instead of piling up. See `NotificationInput` in `@devias/core`.
   */
  notify: (input: NotificationInput) => Promise<NotificationSendResult>;
  /**
   * Set when a workflow step runs the action. The action may run again for the same step (a retry, or a run another
   * server took over after one stopped), so what it does should be safe to repeat: `step.key` is the same on every try.
   */
  step?: {
    runId: string;
    stepId: string;
    /** The try this call is: 1 for the first. */
    attempt: number;
    /** Tries the step gets in all: the first and its retries. */
    maxAttempts: number;
    key: string;
  };
}

/**
 * Thrown by an action for a failure worth trying again (a rate limit, a timeout). When a workflow step runs the action,
 * the step is tried again with exponential backoff, from 30 seconds up to an hour, or after `retryAfterMs` when the
 * service says when, up to five times. Any other error fails the run at once; a person or the API that runs the action
 * by hand sees the error either way.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** The code behind an action the manifest declares (`manifest.actions`), matched by `id`. */
export interface ActionHandler<I = unknown> {
  /** The `id` of the declared action it implements (`ids.actions.transfer`). */
  id: string;
  /**
   * Validates the (template-rendered) input before `run`. It must match the declared `input`: the same keys, and a
   * declared `required` one is not optional here (the server checks this when it loads the module).
   */
  input: z.ZodType<I>;
  /** Return plain JSON; throw to fail with the message. */
  run: (input: I, ctx: ActionContext) => Promise<unknown> | unknown;
}

export const defineActionHandler = <I>(handler: ActionHandler<I>): ActionHandler<I> => handler;

/**
 * Checks a connection against the outside service (`ctx.connection()` is the one tested): when it is made, and when
 * someone tests it. `account` names who it is connected as (an email, an account id); for OAuth it is how the
 * connection learns who agreed.
 */
export type ConnectionTest = (ctx: ModuleContext) => Promise<{ ok: boolean; message?: string; account?: string }>;

/** The code behind one connection provider the manifest declares (`manifest.connections`), matched by `id`. */
export interface ConnectionHandler {
  /** The `id` of the declared provider it serves (`ids.connections.default`). */
  id: string;
  test?: ConnectionTest;
  /** After a connection is removed (its credentials are still readable here): revoke a token, remove a webhook. */
  onDisconnect?: (ctx: ModuleContext) => Promise<void> | void;
}

export const defineConnectionHandler = (handler: ConnectionHandler): ConnectionHandler => handler;

/** One event as a webhook delivery carries it, before storage. */
export interface IncomingEvent {
  type: string;
  /** The outside service's id for the event; deliveries with an id seen before are dropped. */
  externalId?: string | undefined;
  payload: unknown;
}

export interface WebhookRequest {
  headers: Headers;
  /** The raw body, exactly as received, for signature checks. */
  body: string;
}

/** Thrown by `parse` to refuse a delivery; the server answers 400 with the message. */
export class WebhookRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookRejected';
  }
}

export interface WebhookHandler {
  /**
   * Verify a delivery with the receiving connection (`ctx.connection()`) and return the events it carries (types the
   * manifest declares in `events`, though any type is stored). Throw `WebhookRejected` for a bad signature or an
   * unreadable body.
   */
  parse: (request: WebhookRequest, ctx: ModuleContext) => Promise<IncomingEvent[]> | IncomingEvent[];
}

// ---------------------------------------------------------------------------------------------
// Server side
// ---------------------------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: each handler takes its own input type
export type AnyActionHandler = ActionHandler<any>;

export interface ModuleServer {
  manifest: ModuleManifest;
  /** The folder of the module's package, set when it is loaded from one: where its `manifest.logo` is read from. */
  directory?: string;
  /** Register routes on a router mounted at `/api/workspaces/:workspaceId/mod/<moduleId>`; they run as the caller. */
  routes?: (router: ModuleRouter) => void;
  /** One handler per action the manifest declares. */
  actions: AnyActionHandler[];
  /** The code behind the providers that have some. */
  connections: ConnectionHandler[];
  webhook?: WebhookHandler;
}

export interface ModuleServerDefinition {
  routes?: (router: ModuleRouter) => void;
  /** The code behind `manifest.actions`, one handler per declared action. */
  actions?: AnyActionHandler[];
  /** The code behind `manifest.connections`: tests and hooks. */
  connections?: ConnectionHandler[];
  /** Verifies and reads deliveries of the events `manifest.events` declares. */
  webhook?: WebhookHandler;
}

/**
 * Why a handler's zod input does not fit the input its manifest declares, or `null` when it does: the same keys, and
 * what is declared `required` is required here too. Only an object schema can be compared; any other is left alone.
 */
export const inputMismatch = (declared: ActionDefinition['input'], schema: z.ZodType): string | null => {
  if (!(schema instanceof z.ZodObject)) {
    return null;
  }

  const shape = schema.shape as Record<string, z.ZodType>;
  const keys = declared.map((field) => field.name);

  for (const key of Object.keys(shape)) {
    if (!keys.includes(key)) {
      return `the handler takes "${key}", which the manifest does not declare as input`;
    }
  }

  for (const field of declared) {
    const own = shape[field.name];

    if (!own) {
      return `the manifest declares the input "${field.name}", which the handler does not take`;
    }

    if (field.required && own.safeParse(undefined).success) {
      return `the input "${field.name}" is declared required, but the handler accepts it missing`;
    }
  }

  return null;
};

/** Validate the server side against its manifest (a handler for exactly each declared action), then freeze it. */
export const defineModuleServer = (manifest: ModuleManifest, definition: ModuleServerDefinition = {}): ModuleServer => {
  const actions = definition.actions ?? [];
  const declaredActions = new Set(manifest.actions.map((action) => action.id));
  const implemented = new Set<string>();

  for (const handler of actions) {
    if (!declaredActions.has(handler.id)) {
      throw new Error(
        `Server side "${manifest.id}" implements the action "${handler.id}", which its manifest does not declare`,
      );
    }

    if (implemented.has(handler.id)) {
      throw new Error(`Server side "${manifest.id}" implements the action "${handler.id}" twice`);
    }

    implemented.add(handler.id);
    const declaration = manifest.actions.find((action) => action.id === handler.id);

    if (declaration) {
      const problem = inputMismatch(declaration.input, handler.input);

      if (problem) {
        throw new Error(`Action "${handler.id}" of "${manifest.id}": ${problem}`);
      }
    }
  }

  for (const action of manifest.actions) {
    if (!implemented.has(action.id)) {
      throw new Error(`Server side "${manifest.id}" declares the action "${action.name}" but has no handler for it`);
    }
  }

  const connections = definition.connections ?? [];
  const served = new Set<string>();

  for (const handler of connections) {
    if (!manifest.connections.some((provider) => provider.id === handler.id)) {
      throw new Error(
        `Server side "${manifest.id}" has code for the connection "${handler.id}", which its manifest does not declare`,
      );
    }

    if (served.has(handler.id)) {
      throw new Error(`Server side "${manifest.id}" has code for the connection "${handler.id}" twice`);
    }

    served.add(handler.id);
  }

  if (Boolean(definition.webhook) !== manifest.events.length > 0) {
    throw new Error(
      definition.webhook
        ? `Server side "${manifest.id}" has a webhook but its manifest declares no events`
        : `Server side "${manifest.id}" declares events but has no webhook to receive them`,
    );
  }

  return {
    manifest,
    routes: definition.routes,
    actions,
    connections,
    ...(definition.webhook ? { webhook: definition.webhook } : {}),
  };
};

export type { Logger, ScopedEngine } from '@devias/data-engine';

export { loadModules, logoFileOf } from './load-modules';
