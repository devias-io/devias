import {
  type ActionDefinition,
  type Actor,
  AI_TOOL_NAME_PATTERN,
  type ConnectionKind,
  type ConnectionVisibility,
  keyOfId,
  MODULE_KEY_PATTERN,
  type ModuleManifest,
  type NotificationInput,
  type NotificationSendResult,
  namespacedToolName,
  parseCron,
} from '@devias/core';
import type { Logger, ScopedEngine } from '@devias/data-engine';
import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * Authoring API for the server side of a module. It pairs a manifest with the code behind
 * its declared actions, its connections' tests and hooks, its background jobs and schedules, and the parser of its
 * webhook, plus
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
/** Re-exported for modules that name their action tools: `<module>__<action>`. */
export { namespacedToolName };

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
  /** The module's variables in effect: the workspace's values, the server's, then the defaults. Unset ones are absent. */
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
  /** Run one of the module's jobs in the background: now, or after `delayMs`. */
  jobs: {
    enqueue(name: string, payload?: unknown, options?: EnqueueOptions): Promise<{ id: string; status: string }>;
  };
  fetch: ModuleFetch;
  logger: Logger;
}

export interface EnqueueOptions {
  /** One job per key in the workspace: enqueuing the same key again returns the first job. */
  key?: string;
  delayMs?: number;
  /** Retries after the first attempt when it throws `RetryableError` (default 5). */
  retryLimit?: number;
  /** The connection it should use (`ctx.connection()` in the job); otherwise the workspace's. */
  connectionId?: string;
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
}

/**
 * Thrown by a job for a failure worth trying again (a rate limit, a timeout): the job is retried with exponential
 * backoff, from 30 seconds up to an hour, or after `retryAfterMs` when the service says when. Any other error fails the
 * job at once.
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

/** What a job sees: everything an action does, plus which job and attempt this is. */
export interface JobContext extends ActionContext {
  job: { id: string; name: string; attempt: number; maxAttempts: number; schedule: string | null };
}

/** The code behind one of the module's jobs, by name in `defineModuleServer({ jobs })`. */
export interface JobHandler<I = unknown> {
  /** Validates the payload before `run`; a payload that does not fit fails the job without retries. */
  input?: z.ZodType<I>;
  /** Return plain JSON (kept with the job); throw to fail, `RetryableError` to try again later. */
  run: (payload: I, ctx: JobContext) => Promise<unknown> | unknown;
}

export const defineJobHandler = <I>(handler: JobHandler<I>): JobHandler<I> => handler;

/** Run a job on a cron schedule (`0 3 * * *`, UTC) in every workspace where the module is installed. */
export interface ScheduleDefinition {
  /** An identifier, unique in the module: the jobs it starts name it. */
  name: string;
  cron: string;
  job: string;
  payload?: unknown;
}

/** The code behind an action the manifest declares (`manifest.actions`), matched by `id`. */
export interface ActionHandler<I = unknown> {
  /** The `id` of the declared action it implements, such as `inventory.transfer`. */
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

/** The code behind one connection provider the manifest declares (`manifest.connections`), matched by its id. */
export interface ConnectionHandlers {
  test?: ConnectionTest;
  /** After a connection is made: start a first sync, register a webhook. A failure is logged and kept as `lastError`. */
  onConnect?: (ctx: ModuleContext) => Promise<void> | void;
  /** After a connection is removed (its credentials are still readable here): revoke a token, remove a webhook. */
  onDisconnect?: (ctx: ModuleContext) => Promise<void> | void;
}

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
  /** By provider id. */
  connections: Record<string, ConnectionHandlers>;
  /** By job name. */
  // biome-ignore lint/suspicious/noExplicitAny: each handler takes its own payload type
  jobs: Record<string, JobHandler<any>>;
  schedules: ScheduleDefinition[];
  webhook?: WebhookHandler;
}

export interface ModuleServerDefinition {
  routes?: (router: ModuleRouter) => void;
  /** The code behind `manifest.actions`, one handler per declared action. */
  actions?: AnyActionHandler[];
  /** The code behind `manifest.connections`, by provider id: tests and hooks. */
  connections?: Record<string, ConnectionHandlers>;
  /** Background work, by name: run through `ctx.jobs.enqueue(name, payload)` or a schedule, with retries. */
  // biome-ignore lint/suspicious/noExplicitAny: each handler takes its own payload type
  jobs?: Record<string, JobHandler<any>>;
  /** Jobs to run on a cron schedule in every workspace where the module is installed. */
  schedules?: ScheduleDefinition[];
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

    // Every action is also an agent tool, `<module>__<action>`.
    if (!AI_TOOL_NAME_PATTERN.test(namespacedToolName(manifest.id, keyOfId(handler.id)))) {
      throw new Error(`Action "${handler.id}" of "${manifest.id}" makes a tool name over the 64-character limit`);
    }
  }

  for (const action of manifest.actions) {
    if (!implemented.has(action.id)) {
      throw new Error(
        `Server side "${manifest.id}" declares the action "${keyOfId(action.id)}" but has no handler for it`,
      );
    }
  }

  for (const providerId of Object.keys(definition.connections ?? {})) {
    if (!manifest.connections.some((provider) => keyOfId(provider.id) === providerId)) {
      throw new Error(
        `Server side "${manifest.id}" has code for the connection "${providerId}", which its manifest does not declare`,
      );
    }
  }

  const jobs = definition.jobs ?? {};

  for (const name of Object.keys(jobs)) {
    if (!MODULE_KEY_PATTERN.test(name)) {
      throw new Error(`Server side "${manifest.id}" names a job "${name}": job names are identifiers like "sync"`);
    }
  }

  const schedules = definition.schedules ?? [];
  const scheduleNames = new Set<string>();

  for (const schedule of schedules) {
    if (!MODULE_KEY_PATTERN.test(schedule.name) || scheduleNames.has(schedule.name)) {
      throw new Error(
        `Server side "${manifest.id}" has a missing, malformed or repeated schedule name "${schedule.name}"`,
      );
    }

    scheduleNames.add(schedule.name);

    if (!jobs[schedule.job]) {
      throw new Error(
        `Schedule "${schedule.name}" of "${manifest.id}" runs the job "${schedule.job}", which it does not define`,
      );
    }

    try {
      parseCron(schedule.cron);
    } catch (error) {
      throw new Error(
        `Schedule "${schedule.name}" of "${manifest.id}": ${error instanceof Error ? error.message : error}`,
      );
    }
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
    connections: definition.connections ?? {},
    jobs,
    schedules,
    ...(definition.webhook ? { webhook: definition.webhook } : {}),
  };
};

export type { Logger, ScopedEngine } from '@devias/data-engine';

export { loadModules, logoFileOf } from './load-modules';
