import { z } from 'zod';
import { IdSchema } from './ids';
import { keyOfId } from './manifest/entities';

/**
 * What a module declares besides metadata: the connections a workspace or a person makes to outside services (API
 * keys typed once, OAuth accounts; credentials are encrypted at rest and never come back), the variables that
 * configure it, the actions workflows and the agent can call, and the events it delivers. Declarations are
 * manifest data; the code behind them (action handlers, connection tests, the webhook parser) lives in the module's
 * server side.
 */

/** Field keys, provider ids, action ids and action field keys: identifier-like, so they work as template paths. */
export const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const KeySchema = z.string().regex(MODULE_KEY_PATTERN, 'Keys are lowercase identifiers like "api_key"');

// ---------------------------------------------------------------------------------------------
// Fields a person types where the model never sees them
// ---------------------------------------------------------------------------------------------

/** A value typed into a form: an API key connection's fields, or a secure card's in the agent. */
export const SettingFieldSchema = z
  .object({
    name: KeySchema,
    label: z.string().min(1),
    /** Secrets are write-only: clients only get a masked hint back. */
    secret: z.boolean().default(true),
    required: z.boolean().default(true),
    placeholder: z.string().optional(),
    help: z.string().optional(),
  })
  .meta({ id: 'SettingField' });
export type SettingField = z.infer<typeof SettingFieldSchema>;
/** As modules declare it: `secret` and `required` default to true. */
export type SettingFieldInput = z.input<typeof SettingFieldSchema>;

// ---------------------------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------------------------

/** Variable keys read like environment variables, since server variables come from there. */
export const VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Configuration a module reads (`ctx.variables`). A workspace variable is set per workspace and is plain, non-secret
 * data: credentials belong in a connection. A server variable is set on the server, in its environment as
 * `DEVIAS_MOD_<MODULE>_<KEY>`, and never by a workspace: an OAuth client's id and secret, say.
 */
export const VariableDefinitionSchema = z
  .object({
    key: z.string().regex(VARIABLE_KEY_PATTERN, 'Variable keys look like "CLIENT_ID"'),
    label: z.string().min(1),
    description: z.string().optional(),
    /** Only server variables may be secret; they never leave the server. */
    secret: z.boolean().default(false),
    server: z.boolean().default(false),
    default: z.string().optional(),
  })
  .meta({ id: 'VariableDefinition' });
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;
export type VariableDefinitionInput = z.input<typeof VariableDefinitionSchema>;

/** The environment variable a server variable is read from: `DEVIAS_MOD_GOOGLE_CLIENT_ID`. */
export const serverVariableEnv = (moduleId: string, key: string): string =>
  `DEVIAS_MOD_${moduleId.toUpperCase().replace(/-/g, '_')}_${key}`;

// ---------------------------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------------------------

export const CONNECTION_KINDS = ['api_key', 'oauth2'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** Who a connection belongs to: one person (their own Google account), or the whole workspace (the Stripe key). */
export const CONNECTION_VISIBILITIES = ['user', 'workspace'] as const;
export type ConnectionVisibility = (typeof CONNECTION_VISIBILITIES)[number];

/** Which connections a provider allows. */
export const PROVIDER_VISIBILITIES = ['user', 'workspace', 'both'] as const;
export type ProviderVisibility = (typeof PROVIDER_VISIBILITIES)[number];

const VariableRefSchema = z.object({ variable: z.string().regex(VARIABLE_KEY_PATTERN) });
const HttpUrlSchema = z.url({ protocol: /^https?$/ });

export const OAuthConfigSchema = z
  .object({
    authorizeUrl: HttpUrlSchema,
    tokenUrl: HttpUrlSchema,
    scopes: z.array(z.string().min(1)).default([]),
    /** Proof key for code exchange (S256); on unless the provider refuses it. */
    pkce: z.boolean().default(true),
    /** More query parameters for the consent page, such as Google's `access_type: offline`. */
    extraAuthorizeParams: z.record(z.string(), z.string()).optional(),
    /** Server variables the module declares. */
    clientId: VariableRefSchema,
    clientSecret: VariableRefSchema.optional(),
  })
  .meta({ id: 'OAuthConfig' });
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

const providerBase = {
  id: IdSchema,
  /** How people see it: "Google account". A manifest may leave it out; it is then the module's name. */
  label: z.string().min(1),
  help: z.string().optional(),
};

/** One way to connect a module to its outside service: an API key a person types, or an OAuth account. */
export const ConnectionProviderSchema = z
  .discriminatedUnion('kind', [
    z.object({
      ...providerBase,
      kind: z.literal('api_key'),
      visibility: z.enum(PROVIDER_VISIBILITIES).default('workspace'),
      fields: z.array(SettingFieldSchema).min(1),
    }),
    z.object({
      ...providerBase,
      kind: z.literal('oauth2'),
      visibility: z.enum(PROVIDER_VISIBILITIES).default('user'),
      oauth: OAuthConfigSchema,
    }),
  ])
  .meta({ id: 'ConnectionProvider' });
export type ConnectionProvider = z.infer<typeof ConnectionProviderSchema>;

/**
 * Whose a new connection is when the request does not say: what the provider allows, and when it allows both, the
 * workspace's for an API key and the person's own for an account.
 */
export const defaultVisibility = (provider: Pick<ConnectionProvider, 'kind' | 'visibility'>): ConnectionVisibility =>
  provider.visibility === 'both' ? (provider.kind === 'api_key' ? 'workspace' : 'user') : provider.visibility;

/** May a provider have connections of this visibility? */
export const providerAllows = (provider: Pick<ConnectionProvider, 'visibility'>, visibility: ConnectionVisibility) =>
  provider.visibility === 'both' || provider.visibility === visibility;

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/** `record`: the id of a record of the field's `objectId`; a record page fills it with the page's own record. */
export const ACTION_FIELD_TYPES = ['text', 'long_text', 'email', 'number', 'boolean', 'json', 'record'] as const;
export type ActionFieldType = (typeof ACTION_FIELD_TYPES)[number];

export const ActionFieldSchema = z
  .object({
    name: KeySchema,
    label: z.string().min(1),
    type: z.enum(ACTION_FIELD_TYPES).default('text'),
    /** The object a `record` field takes a record of, by id. */
    objectId: z.string().min(1).optional(),
    required: z.boolean().default(false),
    placeholder: z.string().optional(),
    help: z.string().optional(),
  })
  .refine((field) => (field.type === 'record') === (field.objectId !== undefined), {
    message: 'A "record" field names its `objectId`, and only a "record" field does',
    path: ['objectId'],
  })
  .meta({ id: 'ActionField' });
export type ActionField = z.infer<typeof ActionFieldSchema>;
/** As modules declare it: `type` defaults to text, `required` to false. */
export type ActionFieldInput = z.input<typeof ActionFieldSchema>;

/** What an action can return, field by field. */
export const ACTION_OUTPUT_TYPES = ['text', 'number', 'boolean', 'json', 'record'] as const;
export type ActionOutputType = (typeof ACTION_OUTPUT_TYPES)[number];

/** One field of what an action returns: the agent reads each on its own, and `{{steps.<id>.<key>}}` takes it into a later step. */
export const ActionOutputFieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(ACTION_OUTPUT_TYPES).default('text'),
    /** The object a `record` field is a record of, by id. */
    objectId: z.string().min(1).optional(),
    /** What it holds, and when it is empty. */
    description: z.string().optional(),
  })
  .refine((field) => (field.type === 'record') === (field.objectId !== undefined), {
    message: 'A "record" field names its `objectId`, and only a "record" field does',
    path: ['objectId'],
  })
  .meta({ id: 'ActionOutputField' });
export type ActionOutputField = z.infer<typeof ActionOutputFieldSchema>;
/** As modules declare it: `type` defaults to text. */
export type ActionOutputFieldInput = z.input<typeof ActionOutputFieldSchema>;

/** `approve` pauses the agent for the user's go-ahead before it runs the action. */
export const ACTION_APPROVALS = ['auto', 'approve'] as const;
export type ActionApproval = (typeof ACTION_APPROVALS)[number];

export const ActionDefinitionSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    description: z.string().optional(),
    /** The icon of its button where a page offers it; a layout's entry can pick another. */
    icon: z.string().optional(),
    /** What the action takes, field by field: how the studio asks for it and how the agent fills it. */
    input: z.array(ActionFieldSchema).default([]),
    /** What the action returns, field by field, for the agent and for people writing `{{steps.<id>.…}}` templates. */
    output: z.array(ActionOutputFieldSchema).default([]),
    approval: z.enum(ACTION_APPROVALS).default('approve'),
    /**
     * The action calls an outside service and returns its answer (the default). Set false for an action that only works
     * inside the workspace: its output is then not treated as outside content by the agent.
     */
    external: z.boolean().default(true),
  })
  .meta({ id: 'ActionDefinition' });
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export const EventDefinitionSchema = z
  .object({
    id: IdSchema,
    description: z.string().optional(),
  })
  .meta({ id: 'EventDefinition' });
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** A secret for display: the first and last four characters of a long value, nothing of a short one. */
export const maskSecret = (value: string): string =>
  value.length >= 16 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '••••';

/** Why a settings map does not fit the declared fields, or `null` when it does. */
export const settingsProblem = (
  fields: SettingField[],
  values: Record<string, string>,
  options: { partial?: boolean } = {},
): { message: string; name: string } | null => {
  const known = new Set(fields.map((field) => field.name));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      return { message: `Unknown setting "${key}"`, name: key };
    }
  }

  if (!options.partial) {
    for (const field of fields) {
      if (field.required && !values[field.name]?.trim()) {
        return { message: `${field.label} is required`, name: field.name };
      }
    }
  }

  return null;
};

/** Why an action's input does not fit its fields, or `null` when it does. Templates (`{{…}}`) always pass. */
export const actionInputProblem = (
  action: Pick<ActionDefinition, 'input'>,
  input: Record<string, unknown>,
): { message: string; name: string } | null => {
  const known = new Set(action.input.map((field) => field.name));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      return { message: `Unknown input "${key}"`, name: key };
    }
  }

  for (const field of action.input) {
    const value = input[field.name];

    if (field.required && (value === undefined || value === null || value === '')) {
      return { message: `${field.label} is required`, name: field.name };
    }
  }

  return null;
};

// ---------------------------------------------------------------------------------------------
// Connections as a workspace has them
// ---------------------------------------------------------------------------------------------

/** `auth_failed` after the outside service refused the credentials (a test, an expired grant); `lastError` says why. */
export const CONNECTION_STATUSES = ['connected', 'auth_failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const ConnectionSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    providerId: z.string(),
    kind: z.enum(CONNECTION_KINDS),
    /** A `workspace` connection serves everyone; a `user` one only its owner, and agents acting for them. */
    visibility: z.enum(CONNECTION_VISIBILITIES),
    /** The person a `user` connection belongs to; null for workspace connections. */
    ownerUserId: z.string().nullable(),
    label: z.string().nullable(),
    /** Who it is connected as at the outside service: an email, an account id. */
    account: z.string().nullable(),
    status: z.enum(CONNECTION_STATUSES),
    /** Masked previews of an API key connection's stored values (`sk_t…4f2a`); secrets never come back. */
    hints: z.record(z.string(), z.string()),
    /** What an OAuth connection was granted. */
    scopes: z.array(z.string()),
    /** When an OAuth access token runs out; it is refreshed before then when the provider allows. */
    expiresAt: z.string().nullable(),
    lastError: z.string().nullable(),
    authFailedAt: z.string().nullable(),
    lastTestedAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    /** Where the outside service posts webhooks, relative to the API origin; null for modules without events. */
    webhookPath: z.string().nullable(),
    /** The absolute webhook URL, filled in by the server from its public origin. */
    webhookUrl: z.string().nullable().optional(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Connection' });
export type Connection = z.infer<typeof ConnectionSchema>;

/** A provider as this server offers it: whether it can be used here, and why not. */
export const ConnectionProviderStatusSchema = z
  .object({
    moduleId: z.string(),
    providerId: z.string(),
    kind: z.enum(CONNECTION_KINDS),
    label: z.string(),
    visibility: z.enum(PROVIDER_VISIBILITIES),
    /** False when the server lacks what the provider needs (an OAuth client id); `problem` says what. */
    available: z.boolean(),
    problem: z.string().optional(),
  })
  .meta({ id: 'ConnectionProviderStatus' });
export type ConnectionProviderStatus = z.infer<typeof ConnectionProviderStatusSchema>;

export const ConnectionListSchema = z
  .object({
    providers: z.array(ConnectionProviderStatusSchema),
    /** The workspace's connections and the caller's own; other people's stay private. */
    connections: z.array(ConnectionSchema),
  })
  .meta({ id: 'ConnectionList' });
export type ConnectionList = z.infer<typeof ConnectionListSchema>;

export const ConnectionQuerySchema = z
  .object({ module: z.string().optional().describe('Only this module') })
  .meta({ id: 'ConnectionQuery' });
export type ConnectionQuery = z.infer<typeof ConnectionQuerySchema>;

export const SettingValuesSchema = z.record(z.string(), z.string().max(4096));
export type SettingValues = z.infer<typeof SettingValuesSchema>;

export const ConnectionCreateSchema = z
  .object({
    module: z.string().min(1),
    /** Defaults to the module's only API key provider. */
    provider: z.string().optional(),
    /** Defaults to what the provider allows, `workspace` when it allows both. */
    visibility: z.enum(CONNECTION_VISIBILITIES).optional(),
    label: z.string().trim().max(120).optional(),
    /** The provider's fields by key; tested against the outside service right away. */
    values: SettingValuesSchema,
  })
  .meta({ id: 'ConnectionCreate' });
export type ConnectionCreate = z.infer<typeof ConnectionCreateSchema>;

export const ConnectionPatchSchema = z
  .object({
    label: z.string().trim().max(120).nullable().optional(),
    /** Only the keys given are replaced; an empty string clears an optional field. Tested right away. */
    values: SettingValuesSchema.optional(),
  })
  .meta({ id: 'ConnectionPatch' });
export type ConnectionPatch = z.infer<typeof ConnectionPatchSchema>;

export const ConnectionAuthorizeSchema = z
  .object({
    module: z.string().min(1),
    /** Defaults to the module's only OAuth provider. */
    provider: z.string().optional(),
    visibility: z.enum(CONNECTION_VISIBILITIES).optional(),
    /** A studio path to come back to once the account is connected. */
    returnTo: z.string().max(2000).optional(),
  })
  .meta({ id: 'ConnectionAuthorize' });
export type ConnectionAuthorize = z.infer<typeof ConnectionAuthorizeSchema>;

export const ConnectionAuthorizeResultSchema = z
  .object({
    /** The provider's consent page; open it in the person's browser. Valid for ten minutes, once. */
    url: z.string(),
  })
  .meta({ id: 'ConnectionAuthorizeResult' });
export type ConnectionAuthorizeResult = z.infer<typeof ConnectionAuthorizeResultSchema>;

/** How long an OAuth consent may take before its state expires. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export const ConnectionTestResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
    /** Who the credentials are for, when the test can tell. */
    account: z.string().optional(),
    testedAt: z.string(),
  })
  .meta({ id: 'ConnectionTestResult' });
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;

// ---------------------------------------------------------------------------------------------
// Variables as a workspace has them
// ---------------------------------------------------------------------------------------------

export const ModuleVariableSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    description: z.string().optional(),
    server: z.boolean(),
    secret: z.boolean(),
    /** The value in effect; null for a secret or an unset one. */
    value: z.string().nullable(),
    /** Where the value comes from: set in this workspace, on the server, the module's default, or nowhere. */
    source: z.enum(['workspace', 'server', 'default', 'unset']),
  })
  .meta({ id: 'ModuleVariable' });
export type ModuleVariable = z.infer<typeof ModuleVariableSchema>;

export const ModuleVariablesPatchSchema = z
  .object({
    /** Workspace variables by key; an empty string goes back to the default. */
    values: z.record(z.string(), z.string().max(4096)),
  })
  .meta({ id: 'ModuleVariablesPatch' });
export type ModuleVariablesPatch = z.infer<typeof ModuleVariablesPatchSchema>;

// ---------------------------------------------------------------------------------------------
// Inbound events (webhooks)
// ---------------------------------------------------------------------------------------------

export const MODULE_EVENT_DEFAULT_LIMIT = 50;
export const MODULE_EVENT_MAX_LIMIT = 200;
/** Events kept per module and workspace; older ones are pruned. */
export const MODULE_EVENT_RETENTION = 1000;
/** A trigger that lists this event type reacts to every event of the module. */
export const ANY_EVENT = '*';

export const ModuleEventSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    type: z.string(),
    /** The outside service's own id for the event, used to drop duplicate deliveries. */
    externalId: z.string().nullable(),
    payload: z.unknown(),
    receivedAt: z.string(),
  })
  .meta({ id: 'ModuleEvent' });
export type ModuleEvent = z.infer<typeof ModuleEventSchema>;

export const ModuleEventPageSchema = z
  .object({ items: z.array(ModuleEventSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'ModuleEventPage' });
export type ModuleEventPage = z.infer<typeof ModuleEventPageSchema>;

export const ModuleEventQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(MODULE_EVENT_MAX_LIMIT).optional(),
    /** Only events of this type. */
    type: z.string().optional(),
  })
  .meta({ id: 'ModuleEventQuery' });
export type ModuleEventQuery = z.infer<typeof ModuleEventQuerySchema>;

export const WebhookResultSchema = z
  .object({
    /** Events stored from this delivery. */
    received: z.number().int(),
    /** Events dropped because the same external id had arrived before. */
    duplicates: z.number().int(),
  })
  .meta({ id: 'WebhookResult' });
export type WebhookResult = z.infer<typeof WebhookResultSchema>;

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

/**
 * `pending` until it is due and a worker takes it, `running` while one works on it, then `succeeded`, or `failed` once
 * its retries are spent or it threw an error not worth retrying.
 */
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Retries after the first attempt, unless the job says otherwise. */
export const JOB_DEFAULT_RETRY_LIMIT = 5;
export const JOB_DEFAULT_LIMIT = 50;
export const JOB_MAX_LIMIT = 200;
/** Finished jobs are kept this long, so people (and the agent) can see what ran and why something failed. */
export const JOB_RETENTION_DAYS = 30;

export const JobSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    /** The job as its module names it (`sync`); `$onConnect` is the runtime's own, running a connection's hook. */
    name: z.string(),
    status: z.enum(JOB_STATUSES),
    payload: z.unknown(),
    /** What the last successful attempt returned. */
    result: z.unknown(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    /** When it runs next (pending), or ran last. */
    runAt: z.string(),
    lastError: z.string().nullable(),
    /** The schedule that started it, if one did. */
    schedule: z.string().nullable(),
    /** The connection it works with, when it was started for one. */
    connectionId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'Job' });
export type Job = z.infer<typeof JobSchema>;

export const JobQuerySchema = z
  .object({
    module: z.string().optional().describe('Only this module'),
    status: z.enum(JOB_STATUSES).optional(),
    name: z.string().optional().describe('Only jobs of this name'),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(JOB_MAX_LIMIT).optional(),
  })
  .meta({ id: 'JobQuery' });
export type JobQuery = z.infer<typeof JobQuerySchema>;

export const JobPageSchema = z
  .object({ items: z.array(JobSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'JobPage' });
export type JobPage = z.infer<typeof JobPageSchema>;

// ---------------------------------------------------------------------------------------------
// Declarations as workspaces see them
// ---------------------------------------------------------------------------------------------

/** What an installed module declares besides metadata, as the workspace schema carries it. */
export interface ModuleDeclarations {
  connections: ConnectionProvider[];
  variables: VariableDefinition[];
  actions: ActionDefinition[];
  events: EventDefinition[];
}

/** Does the module declare anything a workspace connects, configures, calls or listens to? */
export const declaresRuntime = (declarations: ModuleDeclarations): boolean =>
  declarations.connections.length > 0 ||
  declarations.variables.some((variable) => !variable.server) ||
  declarations.actions.length > 0 ||
  declarations.events.length > 0;

/** The provider a request names, or the module's only one of that kind; undefined when that is ambiguous or missing. */
export const providerOf = <K extends ConnectionKind>(
  declarations: Pick<ModuleDeclarations, 'connections'>,
  providerId: string | undefined,
  kind?: K,
): Extract<ConnectionProvider, { kind: K }> | undefined => {
  const candidates = declarations.connections.filter((provider) => !kind || provider.kind === kind);
  const found = providerId
    ? candidates.find((provider) => keyOfId(provider.id) === providerId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;

  return found as Extract<ConnectionProvider, { kind: K }> | undefined;
};
