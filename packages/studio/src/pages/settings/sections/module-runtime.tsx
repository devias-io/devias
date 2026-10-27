import type {
  Connection,
  ConnectionProvider,
  ConnectionProviderStatus,
  ConnectionVisibility,
  InstalledModule,
  SettingField,
  WebhookEvent,
} from '@devias/core';
import { providerAllows } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
} from '@devias/ui';
import { format } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';
import { moduleIcon } from '../../../components/module-mark';
import {
  connectionName,
  type RuntimeModule,
  useAuthorizeConnection,
  useCreateConnection,
  useDisconnect,
  useModuleVariables,
  useTestConnection,
  useUpdateConnection,
  useUpdateModuleVariables,
  useWebhookEvents,
} from '../../../hooks/use-module-connections';
import { useWorkflowActivity, useWorkflows } from '../../../hooks/use-workflows';
import { ago } from '../../../lib/time';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { plural } from './plan-diff';

/**
 * What an installed module with connections, variables, actions or events shows: its connections to the outside
 * service (API keys typed here, encrypted on the server and never shown again; accounts connected on the provider's
 * consent page), a test, the webhook URL to register with the service, its variables, and the events it delivered.
 */

export { moduleIcon };

const copy = async (text: string, what = 'Copied to clipboard') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error('Could not copy; select the text and copy it manually');
  }
};

// ---------------------------------------------------------------------------------------------
// API key fields
// ---------------------------------------------------------------------------------------------

function SettingFields({
  fields,
  values,
  hints,
  onChange,
}: {
  fields: SettingField[];
  values: Record<string, string>;
  /** Stored masked values: an empty input keeps the stored one. */
  hints: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const id = `module-setting-${field.name}`;
        const stored = hints[field.name];

        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={id}>
              {field.label}
              {field.required && !stored ? null : <span className="ml-1 text-xs text-muted-foreground">optional</span>}
            </FieldLabel>
            <Input
              id={id}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={stored ? `Stored (${stored}); type to replace` : field.placeholder}
              value={values[field.name] ?? ''}
              onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
            />
            {field.help ? <FieldDescription>{field.help}</FieldDescription> : null}
          </Field>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

const pretty = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
};

function EventRow({ event }: { event: WebhookEvent }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-border last:border-b-0" data-slot="webhook-event">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-9 w-full items-center gap-3 px-1 py-1.5 text-left text-xs transition-colors hover:bg-background-hover/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{event.type}</span>
        {event.externalId ? (
          <span className="min-w-0 max-w-48 truncate font-mono text-xs text-muted-foreground">{event.externalId}</span>
        ) : null}
        <time
          dateTime={event.receivedAt}
          title={format(new Date(event.receivedAt), 'PPpp')}
          className="shrink-0 text-xs text-muted-foreground"
        >
          {ago(event.receivedAt)}
        </time>
        <Icon
          name="chevron-down"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto border-t border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
          {pretty(event.payload)}
        </pre>
      ) : null}
    </li>
  );
}

export function WebhookEvents({ item }: { item: RuntimeModule }) {
  const { module } = item;
  const events = useWebhookEvents(module.id);
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  // Webhooks arrive at a workspace connection's URL.
  const receiver = item.connections.find(
    (connection) => connection.visibility === 'workspace' && connection.webhookPath,
  );
  const url = receiver?.webhookUrl ?? receiver?.webhookPath ?? '';

  return (
    <div className="flex flex-col gap-3" data-slot="webhook-events">
      {url ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Webhook URL</span>
          <div className="flex items-center gap-2">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Copy webhook URL"
              onClick={() => void copy(url, 'Webhook URL copied')}
            >
              <Icon name="copy" />
            </Button>
          </div>
          {module.webhookHelp ? <p className="text-xs text-muted-foreground">{module.webhookHelp}</p> : null}
          {receiver &&
          !receiver.hints.webhook_secret &&
          module.connections.some(
            (provider) =>
              provider.kind === 'api_key' && provider.fields.some((field) => field.name === 'webhook_secret'),
          ) ? (
            <p className="text-xs text-warning">
              Add the webhook signing secret to the connection, or deliveries are refused.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Connect it for the workspace to get a webhook URL.</p>
      )}
      {events.isPending ? (
        <p className="text-xs text-muted-foreground">Loading events…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events received yet.</p>
      ) : (
        <ul className="border-y border-border" aria-label={`${module.label} events`}>
          {items.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
      {events.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------------------------

export type RuntimeStatus = 'ready' | 'error' | 'unconfigured';

/** Not connected yet, refused by its service, or fine (also for modules with nothing to connect). */
export const runtimeStatusOf = (item: Pick<RuntimeModule, 'module' | 'connections'>): RuntimeStatus => {
  if (item.module.connections.length === 0) {
    return 'ready';
  }

  if (item.connections.some((connection) => connection.status === 'auth_failed')) {
    return 'error';
  }

  return item.connections.length === 0 ? 'unconfigured' : 'ready';
};

/** The API key form: a new connection, or new values for an existing one (empty fields keep what is stored). */
function ApiKeyForm({
  module,
  provider,
  visibility,
  connection,
  onDone,
}: {
  module: InstalledModule;
  provider: Extract<ConnectionProvider, { kind: 'api_key' }>;
  visibility: ConnectionVisibility;
  connection?: Connection;
  onDone: () => void;
}) {
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const [values, setValues] = useState<Record<string, string>>({});
  const name = module.label;
  const hints = connection?.hints ?? {};
  const given = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
  const missing = provider.fields.some((field) => field.required && !hints[field.name] && !values[field.name]?.trim());
  const busy = create.isPending || update.isPending;
  const save = async () => {
    try {
      if (connection) {
        await update.mutateAsync({ id: connection.id, patch: { values: given }, name });
      } else {
        await create.mutateAsync({
          input: { module: module.id, provider: provider.id, visibility, values: given },
          name,
        });
      }

      onDone();
    } catch {
      // the hooks already toast
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-slot="api-key-form">
      <p className="text-xs text-muted-foreground">
        Values are encrypted on the server and tested right away; they are never shown again.
        {connection ? ' Leave a field empty to keep what is stored.' : ''}
      </p>
      <FieldGroup className="gap-3">
        <SettingFields fields={provider.fields} values={values} hints={hints} onChange={setValues} />
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || missing || Object.keys(given).length === 0} onClick={() => void save()}>
          {connection ? 'Save' : 'Connect'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function StatusDot({ connection }: { connection: Connection }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        connection.status === 'connected' ? 'bg-success' : 'bg-destructive',
      )}
    />
  );
}

/** One connection: who it is for, how it is doing, and what can be done with it. */
function ConnectionRow({
  module,
  provider,
  connection,
}: {
  module: InstalledModule;
  provider: ConnectionProvider;
  connection: Connection;
}) {
  const test = useTestConnection();
  const authorize = useAuthorizeConnection();
  const disconnect = useDisconnect();
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = module.label;
  const hints = Object.entries(connection.hints);

  return (
    <li
      className="flex flex-col gap-2 border-b border-border px-1 py-2.5 last:border-b-0"
      data-connection={connection.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <StatusDot connection={connection} />
        <span className="font-medium">{connectionName(connection)}</span>
        {connection.account && connection.label ? (
          <span className="text-xs text-muted-foreground">{connection.account}</span>
        ) : null}
        {connection.status === 'auth_failed' ? (
          <span className="min-w-0 truncate text-xs text-destructive">{connection.lastError ?? 'Refused'}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Connected
            {hints.length > 0
              ? ` · ${hints.map(([key, hint]) => `${provider.kind === 'api_key' ? (provider.fields.find((f) => f.name === key)?.label ?? key) : key} ${hint}`).join(', ')}`
              : ''}
            {connection.lastUsedAt ? ` · used ${ago(connection.lastUsedAt)}` : ''}
          </span>
        )}
        <span className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={test.isPending}
            onClick={() => test.mutate({ id: connection.id, name })}
          >
            Test
          </Button>
          {provider.kind === 'api_key' ? (
            <Button variant="ghost" size="xs" onClick={() => setReplacing((v) => !v)}>
              Replace key
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              disabled={authorize.isPending}
              onClick={() =>
                authorize.mutate({
                  module: module.id,
                  provider: provider.id,
                  visibility: connection.visibility,
                  returnTo: `${window.location.pathname}${window.location.search}`,
                })
              }
            >
              Reconnect
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            aria-label={`Disconnect ${connectionName(connection)}`}
            onClick={() => setRemoving(true)}
          >
            <Icon name="trash-2" />
          </Button>
        </span>
      </div>
      {replacing && provider.kind === 'api_key' ? (
        <ApiKeyForm
          module={module}
          provider={provider}
          visibility={connection.visibility}
          connection={connection}
          onDone={() => setReplacing(false)}
        />
      ) : null}
      <AlertDialog open={removing} onOpenChange={(open) => !open && setRemoving(false)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The credentials are forgotten. Actions and workflows that use this connection fail until someone connects
              again{connection.webhookPath ? ', and its webhook URL stops working' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setRemoving(false);
                disconnect.mutate({ id: connection.id, name });
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

const GROUPS: { visibility: ConnectionVisibility; title: string; connect: string }[] = [
  { visibility: 'workspace', title: 'Workspace', connect: 'Connect for the workspace' },
  { visibility: 'user', title: 'Mine', connect: 'Connect your account' },
];

/** One provider: its connections, grouped by whose they are, and connecting another. */
export function ProviderConnections({
  module,
  provider,
  status,
  connections,
  visibilities = ['workspace', 'user'],
}: {
  module: InstalledModule;
  provider: ConnectionProvider;
  status: ConnectionProviderStatus | undefined;
  connections: Connection[];
  /** Which groups to show: a person's own page shows only theirs. */
  visibilities?: ConnectionVisibility[];
}) {
  const authorize = useAuthorizeConnection();
  const [adding, setAdding] = useState<ConnectionVisibility | null>(null);
  const groups = GROUPS.filter(
    (group) => visibilities.includes(group.visibility) && providerAllows(provider, group.visibility),
  );
  const available = status?.available ?? true;
  const connect = (visibility: ConnectionVisibility) => {
    if (provider.kind === 'api_key') {
      setAdding(visibility);
    } else {
      authorize.mutate({
        module: module.id,
        provider: provider.id,
        visibility,
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
    }
  };

  return (
    <section className="flex flex-col gap-3" data-provider={provider.id}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium">
          {provider.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {provider.kind === 'api_key' ? 'API key' : 'Account'}
          </span>
        </h3>
        {provider.help ? <p className="text-xs text-muted-foreground">{provider.help}</p> : null}
        {!available ? <p className="text-xs text-warning">{status?.problem}</p> : null}
        {provider.kind === 'oauth2' && status?.redirectUrl ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-slot="redirect-url">
            Register this redirect URL with the service:
            <code className="rounded-xs bg-muted px-1.5 py-0.5 text-foreground">{status.redirectUrl}</code>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy the redirect URL"
              onClick={() => void copy(status.redirectUrl ?? '', 'Redirect URL copied')}
            >
              <Icon name="copy" />
            </Button>
          </p>
        ) : null}
      </div>
      {groups.map((group) => {
        const own = connections.filter(
          (connection) => connection.providerId === provider.id && connection.visibility === group.visibility,
        );

        return (
          <div key={group.visibility} className="flex flex-col gap-1.5" data-group={group.visibility}>
            {groups.length > 1 ? <h4 className="text-xs text-muted-foreground">{group.title}</h4> : null}
            {own.length > 0 ? (
              <ul className="border-y border-border">
                {own.map((connection) => (
                  <ConnectionRow key={connection.id} module={module} provider={provider} connection={connection} />
                ))}
              </ul>
            ) : null}
            {adding === group.visibility && provider.kind === 'api_key' ? (
              <ApiKeyForm
                module={module}
                provider={provider}
                visibility={group.visibility}
                onDone={() => setAdding(null)}
              />
            ) : (own.length === 0 || provider.kind === 'oauth2') && available ? (
              <Button
                variant={own.length === 0 ? 'outline' : 'ghost'}
                size="sm"
                className="self-start"
                disabled={authorize.isPending}
                onClick={() => connect(group.visibility)}
              >
                <Icon name="plus" /> {own.length === 0 ? group.connect : 'Connect another account'}
              </Button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** The workspace's values of the module's variables. A secret is typed here and never shown again. */
function ModuleVariables({ module }: { module: InstalledModule }) {
  const variables = useModuleVariables(module.id);
  const update = useUpdateModuleVariables();
  const [values, setValues] = useState<Record<string, string>>({});
  const items = variables.data ?? [];
  const changed = Object.keys(values).length > 0;

  return (
    <section className="flex flex-col gap-3" data-slot="module-variables">
      <h3 className="text-xs font-medium">Variables</h3>
      <FieldGroup className="gap-3">
        {items.map((variable) => {
          const id = `module-variable-${variable.id}`;
          const set = variable.source === 'workspace';

          return (
            <Field key={variable.id} data-variable={variable.id}>
              <FieldLabel htmlFor={id}>
                {variable.label}
                {variable.required && variable.source === 'unset' ? (
                  <span className="ml-1 text-xs text-warning">required</span>
                ) : null}
              </FieldLabel>
              <Input
                id={id}
                type={variable.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={variable.secret && set ? 'Set; type to replace' : 'Default'}
                value={values[variable.id] ?? (set && !variable.secret ? (variable.value ?? '') : '')}
                onChange={(e) => setValues({ ...values, [variable.id]: e.target.value })}
              />
              <FieldDescription>
                {variable.description ? `${variable.description} ` : ''}
                {variable.source === 'default' ? `Default: ${variable.value}` : ''}
              </FieldDescription>
            </Field>
          );
        })}
      </FieldGroup>
      <Button
        size="sm"
        className="self-start"
        disabled={!changed || update.isPending}
        onClick={() =>
          update.mutate({ moduleId: module.id, name: module.label, values }, { onSuccess: () => setValues({}) })
        }
      >
        Save
      </Button>
    </section>
  );
}

/** Everything a module connects to and is configured with, with a banner when a connection was refused. */
export function ModuleConnections({ item }: { item: RuntimeModule }) {
  const { module, providers, connections } = item;
  const failing = connections.filter((connection) => connection.status === 'auth_failed');

  return (
    <div className="flex flex-col gap-5" data-slot="module-connections" data-status={runtimeStatusOf(item)}>
      {failing.length > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <Icon name="triangle-alert" className="mt-0.5 size-4 shrink-0" />
          {module.label} refused {failing.length === 1 ? 'a connection' : `${failing.length} connections`}:{' '}
          {failing[0]?.lastError ?? 'the credentials no longer work'}. Replace the key or reconnect the account.
        </p>
      ) : null}
      {module.variables.length > 0 ? <ModuleVariables module={module} /> : null}
      {module.connections.map((provider) => (
        <ProviderConnections
          key={provider.id}
          module={module}
          provider={provider}
          status={providers.find((candidate) => candidate.providerId === provider.id)}
          connections={connections}
        />
      ))}
    </div>
  );
}

export const runtimeSummary = (item: RuntimeModule): string =>
  [
    plural(item.module.actions.length, 'action'),
    item.module.events.length > 0 ? plural(item.module.events.length, 'event') : null,
    item.module.connections.length > 0 ? plural(item.connections.length, 'connection') : null,
  ]
    .filter(Boolean)
    .join(' · ');

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------

/** What a module does in the background: the workflows it comes with, and how each one last went. */
export function ModuleWorkflows({ item }: { item: RuntimeModule }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const workflows = useWorkflows();
  const activity = useWorkflowActivity(30);
  const mine = (workflows.data ?? []).filter((workflow) => workflow.moduleId === item.module.id);
  const healthOf = (id: string) => activity.data?.workflows.find((health) => health.workflowId === id);

  return (
    <div className="flex flex-col gap-3" data-slot="module-workflows">
      {workflows.isPending ? (
        <p className="text-xs text-muted-foreground">Loading workflows…</p>
      ) : mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">No workflows come with this module.</p>
      ) : (
        <ul className="border-y border-border" aria-label={`${item.module.label} workflows`}>
          {mine.map((workflow) => {
            const health = healthOf(workflow.id);
            const failed = health?.lastStatus === 'failed';

            return (
              <li
                key={workflow.id}
                className="flex flex-col gap-1 border-b border-border px-1 py-2 last:border-b-0"
                data-workflow={workflow.id}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      !workflow.enabled
                        ? 'border border-muted-foreground'
                        : failed
                          ? 'bg-destructive'
                          : workflow.lastRunAt
                            ? 'bg-success'
                            : 'border border-muted-foreground',
                    )}
                  />
                  <navigation.Link
                    href={links.workflowEditor(slug, workflow.id)}
                    className="font-medium hover:underline focus-visible:underline"
                  >
                    {workflow.title}
                  </navigation.Link>
                  <span className="text-xs text-muted-foreground">
                    {!workflow.enabled
                      ? 'Off'
                      : failed
                        ? 'Failed on its last run'
                        : workflow.lastRunAt
                          ? 'On'
                          : 'On · not run yet'}
                  </span>
                  {workflow.lastRunAt ? (
                    <time
                      dateTime={workflow.lastRunAt}
                      title={format(new Date(workflow.lastRunAt), 'PPpp')}
                      className="ms-auto text-xs text-muted-foreground"
                    >
                      {ago(workflow.lastRunAt)}
                    </time>
                  ) : null}
                </div>
                {failed && health?.lastError ? <p className="text-xs text-destructive">{health.lastError}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
