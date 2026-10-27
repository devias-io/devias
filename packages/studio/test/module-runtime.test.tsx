import type {
  Connection,
  DeviasClient,
  InstalledModule,
  ModuleManifest,
  ModuleVariable,
  Workflow,
  WorkspaceSchema,
} from '@devias/core';
import { coreIds, defineModuleStudio, hashManifest, indexSchema, type PlanResult, parseManifest } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { studio } from '../src/module';
import { modulesSection } from '../src/pages/settings/sections';
import { WorkflowEditorPage } from '../src/pages/workflows/workflow-editor';
import { describeTrigger } from '../src/pages/workflows/workflow-list';
import { createStaticNavigation } from '../src/router/navigation';
import { DriftBanner } from '../src/shell/drift-banner';
import {
  createFakeClient,
  installLayoutStubs,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const now = '2026-01-01T00:00:00.000Z';

const mailerManifest: ModuleManifest = parseManifest({
  id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  version: '0.1.0',
  label: 'Mailer',
  description: 'Send transactional email.',
  icon: 'mail',
  website: 'https://www.mailer.example/product',
  connections: [
    {
      id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
      kind: 'api_key',
      fields: [
        { name: 'api_key', label: 'API key', placeholder: 're_…' },
        { name: 'webhook_secret', label: 'Webhook signing secret', required: false },
      ],
    },
  ],
  actions: [
    {
      id: '01a1751f-5f0a-70f6-b258-808951d74c84',
      name: 'send_email',
      label: 'Send an email',
      input: [
        { name: 'from', label: 'From', required: true },
        { name: 'to', label: 'To', required: true },
        { name: 'subject', label: 'Subject', required: true },
        { name: 'html', label: 'HTML body', type: 'long_text' },
      ],
      output: [{ name: 'id' }],
    },
  ],
  events: [
    { id: '01a1751f-5f0a-70f6-b258-876f6f0ccdaf', name: 'email.delivered', description: 'Delivered.' },
    { id: '01a1751f-5f0a-70f6-b258-8b7f3d3a2e36', name: 'email.bounced' },
  ],
  webhookHelp: 'Add this URL under Webhooks.',
});
const ledgerManifest: ModuleManifest = parseManifest({
  id: '01a1751f-5f0b-70b0-8818-9290a78dd45b',
  version: '0.1.0',
  label: 'Ledger',
  engines: { devias: '>=0.4' },
  connections: [
    { id: '01a1751f-5f0a-70f6-b258-8c2899b54107', kind: 'api_key', fields: [{ name: 'token', label: 'Token' }] },
  ],
  policies: [
    {
      id: '01a1751f-5f0a-70f6-b258-9188c2fd9435',
      description: 'Entries over 1,000 need review.',
      match: { objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' },
      when: { fieldId: '01a1751f-5f0a-70f6-b258-974d2376e30a', above: 1000 },
      decision: 'review',
    },
  ],
});

/** An OAuth module whose app the workspace sets up: two variables, one the workspace's own setting. */
const calendarManifest: ModuleManifest = parseManifest({
  id: '01a1751f-5f0b-70b0-8818-94721c3e49d6',
  version: '0.1.0',
  label: 'Calendar',
  variables: [
    { id: '01a1751f-5f0a-70f6-b258-9be8031d1139', label: 'Client id', required: true },
    { id: '01a1751f-5f0a-70f6-b258-9ce0b8e29a57', label: 'Client secret', secret: true, required: true },
    { id: '01a1751f-5f0a-70f6-b258-a3f5f13d4729', label: 'Calendar', defaultValue: 'primary' },
  ],
  connections: [
    {
      id: '01a1751f-5f0a-70f6-b258-a4bbd9a3df60',
      kind: 'oauth2',
      label: 'Calendar account',
      oauth: {
        authorizeUrl: 'https://accounts.example/authorize',
        tokenUrl: 'https://accounts.example/token',
        clientId: { variable: '01a1751f-5f0a-70f6-b258-9be8031d1139' },
        clientSecret: { variable: '01a1751f-5f0a-70f6-b258-9ce0b8e29a57' },
      },
    },
  ],
});

const installed = (manifest: ModuleManifest): InstalledModule => ({
  id: manifest.id,
  version: manifest.version,
  manifestHash: 'installed-hash',
  installedAt: now,
  updatedAt: now,
  core: manifest.core,
  blocks: manifest.blocks,
  agents: manifest.agents,
  skills: manifest.skills,
  label: manifest.label,
  ...(manifest.website ? { website: manifest.website } : {}),
  ...(manifest.description ? { description: manifest.description } : {}),
  ...(manifest.icon ? { icon: manifest.icon } : {}),
  policies: manifest.policies,
  connections: manifest.connections,
  variables: manifest.variables,
  actions: manifest.actions,
  events: manifest.events,
  ...(manifest.webhookHelp ? { webhookHelp: manifest.webhookHelp } : {}),
});

const withModules = (...manifests: ModuleManifest[]): WorkspaceSchema => ({
  ...schemaFixture(),
  modules: manifests.map(installed),
});

const mailerConnection: Connection = {
  id: 'conn-mailer',
  moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  providerId: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
  kind: 'api_key',
  visibility: 'workspace',
  ownerUserId: null,
  label: null,
  account: null,
  status: 'connected',
  hints: { api_key: 're_1…cdef' },
  scopes: [],
  expiresAt: null,
  lastError: null,
  authFailedAt: null,
  lastTestedAt: now,
  lastUsedAt: null,
  webhookPath: '/api/webhooks/abc',
  webhookUrl: 'http://localhost:3000/api/webhooks/abc',
  createdBy: 'user:u1',
  createdAt: now,
  updatedAt: now,
};

const fakeModules = (
  schema: WorkspaceSchema,
  connections: Connection[],
  catalog: ModuleManifest[] = [mailerManifest, ledgerManifest],
): DeviasClient['modules'] => ({
  list: vi.fn(async () => schema.modules),
  catalog: vi.fn(async () => catalog),
  logoUrl: () => undefined,
  plan: vi.fn(async () => {
    throw new Error('not used');
  }),
  apply: vi.fn(async () => {
    throw new Error('not used');
  }),
  uninstall: vi.fn(async () => {
    throw new Error('not used');
  }),
  connections: {
    list: vi.fn(async () => ({
      providers: schema.modules.flatMap((module) =>
        module.connections.map((provider) => ({
          moduleId: module.id,
          providerId: provider.id,
          kind: provider.kind,
          label: provider.label,
          visibility: provider.visibility,
          available: true,
        })),
      ),
      connections,
    })),
    get: vi.fn(async (id: string) => connections.find((c) => c.id === id) as Connection),
    create: vi.fn(async (input) => ({
      ...mailerConnection,
      id: 'conn-new',
      moduleId: input.module,
      webhookPath: null,
      webhookUrl: null,
      hints: Object.fromEntries(Object.keys(input.values).map((key) => [key, '••••'])),
    })),
    update: vi.fn(async (id: string) => connections.find((c) => c.id === id) as Connection),
    authorize: vi.fn(async () => ({ url: 'https://accounts.example/consent' })),
    test: vi.fn(async () => ({ ok: true, message: 'Connected', testedAt: now })),
    disconnect: vi.fn(async () => {}),
  },
  variables: {
    list: vi.fn(async () => []),
    update: vi.fn(async () => []),
  },
  runAction: vi.fn(async () => ({ output: { id: 'em_1' } })),
  events: vi.fn(async () => ({
    items: [
      {
        id: 'ev-1',
        moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
        type: 'email.delivered',
        externalId: 'msg_1',
        payload: { data: { email_id: 'em_1' } },
        receivedAt: now,
      },
    ],
    nextCursor: null,
  })),
});

/** The row of a module on the Modules page, once it rendered. */
const findRow = (moduleId: string) =>
  waitFor(() => {
    const row = document.querySelector(`[data-module="${moduleId}"]`);

    if (!row) {
      throw new Error(`no row for ${moduleId} yet`);
    }

    return row as HTMLElement;
  });

describe('module event words', () => {
  it('describes event triggers with the module name and the events', () => {
    const schema = withModules(mailerManifest);
    const index = indexSchema(schema);
    expect(
      describeTrigger(
        { kind: 'module_event', moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f', types: ['*'] },
        index,
        schema.modules,
      ),
    ).toBe('When Mailer sends any event');
    expect(
      describeTrigger(
        {
          kind: 'module_event',
          moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
          types: ['email.delivered', 'email.bounced'],
        },
        index,
        schema.modules,
      ),
    ).toBe('When Mailer sends email.delivered or email.bounced');
    expect(describeTrigger({ kind: 'module_event', moduleId: 'ghost', types: ['x'] }, index)).toBe(
      'When ghost sends x',
    );
  });
});

/** An element of the page by selector, once it rendered. */
const slot = (selector: string) =>
  waitFor(() => {
    const element = document.querySelector(selector);

    if (!element) {
      throw new Error(`nothing matches ${selector} yet`);
    }

    return element as HTMLElement;
  });

/** The Modules section: the list, or the page of one module when `item` is given (the route's `$item`). */
const showModules = (client: DeviasClient, schema: WorkspaceSchema, item?: string) => {
  const Section = modulesSection.component;

  return render(
    <TestProviders
      client={client}
      schema={schema}
      navigation={createStaticNavigation(
        `/workspaces/acme/settings/modules${item ? `/${item}` : ''}`,
        {},
        item ? { item } : {},
      )}
    >
      <Section />
    </TestProviders>,
  );
};

describe('module settings on the Modules page', () => {
  it('lists the installed modules and the catalog, and a card opens the page of its module', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema);
    const row = within(await findRow('01a1751f-5f0a-70f6-b258-c2c96a69790f'));
    // The server catalog offers what the studio was not built with.
    const ledger = await findRow('01a1751f-5f0b-70b0-8818-9290a78dd45b');
    expect(within(ledger).getByText('Not installed')).toBeTruthy();
    fireEvent.click(row.getByRole('button'));
    expect(window.location.pathname).toBe('/workspaces/acme/settings/modules/01a1751f-5f0a-70f6-b258-c2c96a69790f');
  });

  it('shows the status, the webhook URL and the events of an installed module on its page', async () => {
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toContain('Mailer');
    await screen.findByText(/1 action · 2 events · 1 connection/);
    // Its connection works, so there is nothing left to set up; the installed copy is older, so a bar says so.
    expect(document.querySelector('[data-slot="module-setup"]')).toBeNull();
    expect(within(await slot('[data-slot="module-update"]')).getByText(/changes to apply/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await screen.findByText('email.delivered');
    expect((screen.getByDisplayValue('http://localhost:3000/api/webhooks/abc') as HTMLInputElement).readOnly).toBe(
      true,
    );
    expect(screen.getByText('Add this URL under Webhooks.')).toBeTruthy();
    expect(screen.getByText(/signing secret to the connection/)).toBeTruthy();
    fireEvent.click(screen.getByText('email.delivered'));
    await screen.findByText(/"email_id": "em_1"/);
    expect(api.events).toHaveBeenCalledWith(
      '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      expect.objectContaining({ limit: expect.any(Number) }),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Connections' }));
    await screen.findByText(/Connected · API key re_1…cdef/);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(api.connections.test).toHaveBeenCalledWith('conn-mailer'));
  });

  it('installs a server-only module that declares no objects, fields or views', async () => {
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    api.plan = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      fromVersion: null,
      toVersion: manifest.version,
      manifestHash: 'h',
      planHash: 'p',
      hasDestructive: false,
      hasConflicts: false,
      changes: [],
    }));
    api.apply = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      version: manifest.version,
      manifestHash: 'h',
      metadataVersion: 2,
      applied: [],
    }));
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, '01a1751f-5f0b-70b0-8818-9290a78dd45b');
    // Not installed: the page leads with the one thing to do, and the header offers it too.
    await screen.findByText('Install Ledger');
    expect(document.querySelector('[data-step="install"]')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Review install' })[0] as HTMLElement);
    await screen.findByText(/installing adds the module/);
    // The button that applies it is in a bar at the bottom of the tab, beside what is reviewed; the header has none.
    const apply = within(await slot('[data-slot="module-apply"]'));
    expect(apply.getByRole('button', { name: 'Install' })).toBeTruthy();
    expect(apply.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(
      within(document.querySelector('[data-slot="module-header"]') as HTMLElement).queryByRole('button', {
        name: 'Install',
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    // It asks first; nothing is installed until the answer is yes.
    expect(await screen.findByText('Install Ledger?')).toBeTruthy();
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Install Ledger?')).toBeNull());
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Install Ledger?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Install' }));
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith(ledgerManifest, { expectedPlanHash: 'p', allowDestructive: false }),
    );
  });

  it('shows who publishes a module and what it says needs review', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0b-70b0-8818-9290a78dd45b');
    const policies = within(await slot('[data-slot="module-policies"]'));
    expect(policies.getByText('Entries over 1,000 need review.')).toBeTruthy();
    expect(policies.getByText('Review')).toBeTruthy();
    expect(screen.getByText('>=0.4')).toBeTruthy();
  });

  it('leads with what is left to set up, and connects an installed module with its API key fields', async () => {
    const schema = withModules(ledgerManifest);
    const api = fakeModules(schema, [], [ledgerManifest]);
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, '01a1751f-5f0b-70b0-8818-9290a78dd45b');
    await screen.findByText('Update available');
    // Installed and not connected: the steps, the connection first among what is left, then the defaults to check.
    await slot('[data-step="connect"]');
    const setup = within(await slot('[data-slot="module-setup"]'));
    expect(setup.getByText('Finish setting up Ledger')).toBeTruthy();
    expect(setup.getByText('2 steps left.')).toBeTruthy();
    expect(setup.getByText('Installed')).toBeTruthy();
    expect(setup.getByText('Entries over 1,000 need review.')).toBeTruthy();
    fireEvent.click(setup.getByRole('button', { name: 'Connect' }));
    fireEvent.click(await screen.findByRole('button', { name: /Connect for the workspace/ }));
    const save = screen.getByRole('button', { name: 'Connect' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'tok_secret' } });
    expect((screen.getByLabelText('Token') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(api.connections.create).toHaveBeenCalledWith({
        module: '01a1751f-5f0b-70b0-8818-9290a78dd45b',
        provider: '01a1751f-5f0a-70f6-b258-8c2899b54107',
        visibility: 'workspace',
        values: { token: 'tok_secret' },
      }),
    );
  });

  it('asks for the variables an OAuth module needs first, keeps a secret out of sight, and shows the redirect URL', async () => {
    const schema = withModules(calendarManifest);
    const redirectUrl = 'https://api.example.com/api/oauth/callback';
    let variables: ModuleVariable[] = [
      {
        id: '01a1751f-5f0a-70f6-b258-9be8031d1139',
        label: 'Client id',
        secret: false,
        required: true,
        value: null,
        source: 'unset',
      },
      {
        id: '01a1751f-5f0a-70f6-b258-9ce0b8e29a57',
        label: 'Client secret',
        secret: true,
        required: true,
        value: null,
        source: 'unset',
      },
      {
        id: '01a1751f-5f0a-70f6-b258-a3f5f13d4729',
        label: 'Calendar',
        secret: false,
        required: false,
        value: 'primary',
        source: 'default',
      },
    ];
    const base = fakeModules(schema, [], [calendarManifest]);
    const ready = () => variables.every((variable) => !variable.required || variable.source !== 'unset');
    const api: DeviasClient['modules'] = {
      ...base,
      connections: {
        ...base.connections,
        list: vi.fn(async () => ({
          providers: [
            {
              moduleId: '01a1751f-5f0b-70b0-8818-94721c3e49d6',
              providerId: '01a1751f-5f0a-70f6-b258-a4bbd9a3df60',
              kind: 'oauth2' as const,
              label: 'Calendar account',
              visibility: 'user' as const,
              available: ready(),
              ...(ready() ? {} : { problem: 'Needs Client id and Client secret in Variables' }),
              redirectUrl,
            },
          ],
          connections: [],
        })),
      },
      variables: {
        list: vi.fn(async () => variables),
        update: vi.fn(async (_moduleId: string, values: Record<string, string>) => {
          variables = variables.map((variable) =>
            variable.id in values
              ? {
                  ...variable,
                  source: 'workspace' as const,
                  value: variable.secret ? null : (values[variable.id] ?? null),
                }
              : variable,
          );

          return variables;
        }),
      },
    };
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, '01a1751f-5f0b-70b0-8818-94721c3e49d6');
    // What is left comes first: the variables, then connecting.
    const step = within(await slot('[data-step="variables"]'));
    expect(step.getByText('Set Client id and Client secret')).toBeTruthy();
    fireEvent.click(step.getByRole('button', { name: 'Set variables' }));
    // The redirect URL to register, and no way to connect until the app is set up.
    const card = within(await slot('[data-provider="01a1751f-5f0a-70f6-b258-a4bbd9a3df60"]'));
    expect(card.getByText('Needs Client id and Client secret in Variables')).toBeTruthy();
    expect(card.getByText(redirectUrl)).toBeTruthy();
    expect(card.getByRole('button', { name: 'Copy the redirect URL' })).toBeTruthy();
    expect(card.queryByRole('button', { name: /Connect your account/ })).toBeNull();
    // A secret is typed in a password field.
    expect((screen.getByLabelText(/Client secret/) as HTMLInputElement).type).toBe('password');
    expect((screen.getByLabelText(/^Client id/) as HTMLInputElement).type).toBe('text');
    fireEvent.change(screen.getByLabelText(/^Client id/), { target: { value: 'id-1' } });
    fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: 'shh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.variables.update).toHaveBeenCalledWith('01a1751f-5f0b-70b0-8818-94721c3e49d6', {
        '01a1751f-5f0a-70f6-b258-9be8031d1139': 'id-1',
        '01a1751f-5f0a-70f6-b258-9ce0b8e29a57': 'shh',
      }),
    );
    // The secret is not shown again, only that it is set; the step is done.
    await waitFor(() =>
      expect((screen.getByLabelText(/Client secret/) as HTMLInputElement).placeholder).toBe('Set; type to replace'),
    );
    expect((screen.getByLabelText(/Client secret/) as HTMLInputElement).value).toBe('');
    expect(document.querySelector('[data-step="variables"]')).toBeNull();
  });

  it('lists the workflows a module comes with, and how each last went', async () => {
    const schema = withModules(mailerManifest);
    const mailer = '01a1751f-5f0a-70f6-b258-c2c96a69790f';
    const shipped = (id: string, title: string, enabled: boolean, lastRunAt: string | null): Workflow => ({
      id,
      workspaceId: 'ws1',
      title,
      enabled,
      moduleId: mailer,
      trigger: { kind: 'schedule', cron: '0 3 * * *' },
      steps: [
        { id: 's1', kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'person', values: {} } },
      ],
      lastRunAt,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const workflows = {
      list: vi.fn(async () => [
        shipped('wf-sync', 'Sync the mailing list', true, now),
        shipped('wf-digest', 'Weekly digest', false, null),
        { ...shipped('wf-own', "Not the mailer's", true, null), moduleId: undefined },
      ]),
      activity: vi.fn(async () => ({
        days: [],
        workflows: [
          {
            workflowId: 'wf-sync',
            runs: 3,
            failed: 1,
            lastRunId: 'run-9',
            lastStatus: 'failed' as const,
            lastError: 'Mailer answered 503',
          },
        ],
      })),
    } as unknown as DeviasClient['workflows'];
    const client = createFakeClient(schema, recordsFixture(), {
      modules: fakeModules(schema, [mailerConnection]),
      workflows,
    });
    showModules(client, schema, mailer);
    fireEvent.click(await screen.findByRole('tab', { name: 'Workflows' }));
    await screen.findByText('Mailer answered 503');
    const list = within(screen.getByRole('list', { name: /workflows$/ }));
    expect(list.getAllByRole('listitem')).toHaveLength(2);
    expect(list.getByRole('link', { name: 'Sync the mailing list' })).toBeTruthy();
    expect(list.getByText('Failed on its last run')).toBeTruthy();
    expect(list.getByText('Off')).toBeTruthy();
    expect(screen.queryByText("Not the mailer's")).toBeNull();
  });

  it('asks to reconnect a refused connection', async () => {
    const schema = withModules(mailerManifest);
    const refused = { ...mailerConnection, status: 'auth_failed' as const, lastError: 'Mailer rejected the API key' };
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [refused]) });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    const step = within(await slot('[data-step="connect"]'));
    expect(step.getByText('Mailer rejected the API key')).toBeTruthy();
    fireEvent.click(step.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText(/Mailer refused a connection: Mailer rejected the API key/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
  });

  it('tells in a bar across the top that there are changes to apply, on every tab', async () => {
    const schema = withModules(mailerManifest);
    // The installed copy is older than the one this build ships.
    schema.modules = schema.modules.map((module) => ({ ...module, version: '0.0.9' }));
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    const bar = within(await slot('[data-slot="module-update"]'));
    expect(bar.getByText('Update available: v0.0.9 → v0.1.0.')).toBeTruthy();
    // The header says which version is installed and which is waiting, not only the one this build ships.
    expect(document.querySelector('[data-slot="module-header"]')?.textContent).toContain('v0.0.9 → v0.1.0');
    // The bar is words only, on every tab; the overview's panel is the way to the changes.
    expect(bar.queryByRole('button')).toBeNull();
    const panel = within(document.querySelector('[data-slot="module-review"]') as HTMLElement);
    expect(panel.getByText(/v0.0.9 → v0.1.0 is ready/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Review changes' }));
    await screen.findByText('Checking what applying this would change…');
    expect(document.querySelector('[data-slot="module-review"]')).toBeNull();
    // The bar stays across the top there, still without a button.
    const onChanges = within(await slot('[data-slot="module-update"]'));
    expect(onChanges.getByText('Update available: v0.0.9 → v0.1.0.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
  });

  it('has no bar for a module that is up to date, and no Review button either', async () => {
    const schema = withModules(mailerManifest);
    // Installed from exactly the copy this build ships.
    schema.modules = schema.modules.map((module) => ({ ...module, manifestHash: hashManifest(mailerManifest) }));
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    await screen.findByText('Up to date');
    expect(document.querySelector('[data-slot="module-update"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
    // Looking at the changes is the Changes tab.
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeTruthy();
  });

  it("links the module's website in its details, by its host", async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    const link = (await screen.findByText('mailer.example')).closest('a');
    expect(link?.getAttribute('href')).toBe('https://www.mailer.example/product');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Website')).toBeTruthy();
  });

  it('puts Uninstall at the bottom of the overview, in a card of its own, and asks before it does anything', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    const card = within(await slot('[data-slot="module-uninstall"]'));
    expect(card.getByText('Uninstall Mailer')).toBeTruthy();
    // The header does not carry it, and the card comes after everything else on the overview.
    expect(document.querySelector('[data-slot="module-header"]')?.textContent).not.toContain('Uninstall');
    const details = screen.getByText('Details');
    const position = details.compareDocumentPosition(document.querySelector('[data-slot="module-uninstall"]') as Node);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Uninstall' }));
    expect(await screen.findByText('Uninstall Mailer?')).toBeTruthy();
  });

  it('refreshes the workflows list when a module is uninstalled, since its workflows go with it', async () => {
    const mailer = '01a1751f-5f0a-70f6-b258-c2c96a69790f';
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    api.uninstall = vi.fn(async () => ({
      moduleId: mailer,
      version: '0.1.0',
      manifestHash: 'h',
      metadataVersion: 3,
      applied: [],
    }));
    const shipped: Workflow = {
      id: 'wf-sync',
      workspaceId: 'ws1',
      title: 'Sync the mailing list',
      enabled: true,
      moduleId: mailer,
      trigger: { kind: 'schedule', cron: '0 3 * * *' },
      steps: [
        { id: 's1', kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'person', values: {} } },
      ],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const list = vi.fn(async () => [shipped]);
    const workflows = {
      list,
      activity: vi.fn(async () => ({ days: [], workflows: [] })),
    } as unknown as DeviasClient['workflows'];
    const client = createFakeClient(schema, recordsFixture(), { modules: api, workflows });
    showModules(client, schema, mailer);
    // The module page asks for the workflows to know whether it has a tab for them.
    await waitFor(() => expect(list).toHaveBeenCalled());
    const before = list.mock.calls.length;
    const card = within(await slot('[data-slot="module-uninstall"]'));
    fireEvent.click(card.getByRole('button', { name: 'Uninstall' }));
    await screen.findByText('Uninstall Mailer?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(api.uninstall).toHaveBeenCalledWith(mailer, { allowDestructive: true }));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it('asks before it applies an update, saying what it does, and does nothing on Cancel', async () => {
    const schema = withModules(mailerManifest);
    schema.modules = schema.modules.map((module) => ({ ...module, version: '0.0.9' }));
    const api = fakeModules(schema, [mailerConnection]);
    api.plan = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      fromVersion: '0.0.9',
      toVersion: manifest.version,
      manifestHash: 'h',
      planHash: 'p',
      hasDestructive: false,
      hasConflicts: false,
      changes: [
        { action: 'create', kind: 'field', id: '01a1751f-5f0a-70f6-b258-a93bb28cc018', label: 'A' },
        { action: 'update', kind: 'field', id: '01a1751f-5f0a-70f6-b258-ac8d4b890e7d', label: 'B' },
      ] as never,
    }));
    api.apply = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      version: manifest.version,
      manifestHash: 'h',
      metadataVersion: 2,
      applied: [],
    }));
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    fireEvent.click(await screen.findByRole('tab', { name: 'Changes' }));
    const apply = within(await slot('[data-slot="module-apply"]'));
    fireEvent.click(apply.getByRole('button', { name: 'Apply changes' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Apply changes to Mailer?')).toBeTruthy();
    // It says which versions, and what it does to the data model.
    expect(dialog.getByText(/0\.0\.9 → 0\.1\.0\. This makes 1 new item, 1 change in the data model\./)).toBeTruthy();
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.apply).not.toHaveBeenCalled();

    fireEvent.click(apply.getByRole('button', { name: 'Apply changes' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith(mailerManifest, { expectedPlanHash: 'p', allowDestructive: false }),
    );
  });

  it('has no Uninstall card for a module that is not installed', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, '01a1751f-5f0b-70b0-8818-9290a78dd45b');
    await slot('[data-slot="module-setup"]');
    expect(document.querySelector('[data-slot="module-uninstall"]')).toBeNull();
  });

  it('has no Connection part for a module with nothing to connect to', async () => {
    const plain = parseManifest({
      id: '01a1751f-5f05-7675-8a95-6259e0501ad4',
      version: '0.1.0',
      label: 'Plain',
      actions: [{ id: '01a1751f-5f0a-70f6-b258-b10bc334d6fe', name: 'run', label: 'Run it', input: [], output: [] }],
    });
    const schema = withModules(plain);
    const client = createFakeClient(schema, recordsFixture(), {
      modules: fakeModules(schema, [], [plain]),
    });
    showModules(client, schema, '01a1751f-5f05-7675-8a95-6259e0501ad4');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toContain('Plain');
    await slot('[data-slot="module-overview"]');
    // "What it adds" already counts its actions; a Connection part saying the same would be noise.
    expect(screen.queryByRole('heading', { name: 'Connection' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'What it adds' })).toBeTruthy();
  });

  it('counts the agents a module installs among what it adds', async () => {
    const lab = parseManifest({
      id: '01a1751f-5f08-717d-a428-446a0ff330a8',
      version: '0.1.0',
      label: 'Lab',
      agents: [
        { id: '01a1751f-5f0a-70f6-b258-b45fac72016c', label: 'Analyst', actionIds: [coreIds.actions.list_records] },
        { id: '01a1751f-5f0a-70f6-b258-ba0930ac07cc', label: 'Clerk', actionIds: [coreIds.actions.list_records] },
      ],
    });
    const schema = withModules(lab);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [], [lab]) });
    showModules(client, schema, '01a1751f-5f08-717d-a428-446a0ff330a8');
    await slot('[data-slot="module-overview"]');
    const adds = document.querySelector('[data-slot="module-adds"]') as HTMLElement;
    expect(within(adds).getByText('Agents').nextElementSibling?.textContent).toBe('2');
    // A module with none does not mention them.
    cleanup();
    const plain = parseManifest({
      id: '01a1751f-5f05-7675-8a95-6259e0501ad4',
      version: '0.1.0',
      label: 'Plain',
      actions: [{ id: '01a1751f-5f0a-70f6-b258-b10bc334d6fe', name: 'run', label: 'Run', input: [], output: [] }],
    });
    const plainSchema = withModules(plain);
    showModules(
      createFakeClient(plainSchema, recordsFixture(), { modules: fakeModules(plainSchema, [], [plain]) }),
      plainSchema,
      '01a1751f-5f05-7675-8a95-6259e0501ad4',
    );
    await slot('[data-slot="module-overview"]');
    expect(within(document.querySelector('[data-slot="module-adds"]') as HTMLElement).queryByText('Agents')).toBeNull();
  });

  it('counts the workflows a module installs among what it adds, and says nothing when it has none', async () => {
    const workflow = (id: string, step: string, title: string) => ({
      id,
      title,
      trigger: { kind: 'schedule' as const, cron: '0 9 * * *' },
      steps: [
        {
          id: step,
          kind: 'action' as const,
          actionId: coreIds.actions.create_record,
          input: { object: 'person', values: {} },
        },
      ],
    });
    const desk = parseManifest({
      id: '01a1751f-5f08-717d-a428-446a0ff33111',
      version: '0.1.0',
      label: 'Desk',
      workflows: [
        workflow('01a17e45-2fa8-77a2-9f61-43a5fe269111', '01a17e45-2fa8-77a2-9f61-4618f5a25111', 'Morning round'),
        workflow('01a17e45-2fa8-77a2-9f61-43a5fe269222', '01a17e45-2fa8-77a2-9f61-4618f5a25222', 'Evening round'),
      ],
    });
    const schema = withModules(desk);
    showModules(
      createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [], [desk]) }),
      schema,
      '01a1751f-5f08-717d-a428-446a0ff33111',
    );
    await slot('[data-slot="module-overview"]');
    const adds = () => document.querySelector('[data-slot="module-adds"]') as HTMLElement;
    expect(within(adds()).getByText('Workflows').nextElementSibling?.textContent).toBe('2');
    cleanup();
    const plain = parseManifest({
      id: '01a1751f-5f05-7675-8a95-6259e0501ad4',
      version: '0.1.0',
      label: 'Plain',
      actions: [{ id: '01a1751f-5f0a-70f6-b258-b10bc334d6fe', name: 'run', label: 'Run', input: [], output: [] }],
    });
    const plainSchema = withModules(plain);
    showModules(
      createFakeClient(plainSchema, recordsFixture(), { modules: fakeModules(plainSchema, [], [plain]) }),
      plainSchema,
      '01a1751f-5f05-7675-8a95-6259e0501ad4',
    );
    await slot('[data-slot="module-overview"]');
    expect(within(adds()).queryByText('Workflows')).toBeNull();
  });

  it('says so when the module is not one this workspace knows', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, 'nothing-here');
    expect(await screen.findByText('Unknown module')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to modules' }));
    expect(window.location.pathname).toBe('/workspaces/acme/settings/modules');
  });
});

describe('action steps in the workflow editor', () => {
  it('adds a "Run an action" step, picks a module action from the one list, fills its fields and saves it', async () => {
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    const workflow: Workflow = {
      id: 'wf-1',
      workspaceId: 'ws1',
      title: 'Welcome',
      enabled: true,
      trigger: { kind: 'record_event', objectId: 'person', types: ['record.created'] },
      steps: [
        {
          id: 's1',
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { stage: 'won' } },
        },
      ],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const workflows: DeviasClient['workflows'] = {
      list: vi.fn(async () => [workflow]),
      get: vi.fn(async () => workflow),
      create: vi.fn(async () => workflow),
      update: vi.fn(async (_id, patch) => ({ ...workflow, ...patch }) as Workflow),
      recordRuns: vi.fn(async () => ({ items: [] })),
      delete: vi.fn(async () => {}),
      runs: vi.fn(async () => ({ items: [], nextCursor: null })),
      activity: vi.fn(async () => ({ days: [], workflows: [] })),
      run: vi.fn(async () => {
        throw new Error('not used');
      }),
      retryRun: vi.fn(async () => {
        throw new Error('not used');
      }),
    };
    const client = createFakeClient(schema, recordsFixture(), { modules: api, workflows });
    render(
      <TestProviders
        client={client}
        schema={schema}
        navigation={createStaticNavigation('/workspaces/acme/workflows/wf-1', {}, { workflowId: 'wf-1' })}
      >
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'Welcome' });
    await waitFor(() => expect(document.querySelectorAll('[data-canvas-node="step"]')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add a step after Update the record' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Run an action/ }));
    // One picker lists core's actions and the installed modules' together. Base UI selects on the pointer sequence.
    const picker = await screen.findByLabelText('Action');
    fireEvent.pointerDown(picker, { pointerType: 'mouse', button: 0 });
    fireEvent.mouseDown(picker, { button: 0 });
    fireEvent.click(picker);
    expect(await screen.findByRole('option', { name: 'Add a comment to a record' })).toBeTruthy();
    const option = await screen.findByRole('option', { name: 'Send an email · Mailer' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.mouseDown(option, { button: 0 });
    fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    fireEvent.mouseUp(option, { button: 0 });
    fireEvent.click(option);
    // The module's declared fields are the form.
    await screen.findByLabelText(/^To/);
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: 'Acme <hi@acme.test>' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '{{record.email}}' } });
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: 'Welcome {{record.first_name}}' } });
    fireEvent.change(screen.getByLabelText(/^HTML body/), { target: { value: '<p>Hi</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(workflows.update).toHaveBeenCalled());
    const [, patch] = (workflows.update as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { steps: unknown[] }];
    expect(patch.steps[1]).toMatchObject({
      kind: 'action',
      actionId: '01a1751f-5f0a-70f6-b258-808951d74c84',
      input: {
        from: 'Acme <hi@acme.test>',
        to: '{{record.email}}',
        subject: 'Welcome {{record.first_name}}',
        html: '<p>Hi</p>',
      },
    });
    // The step runs with the workspace's connection unless one is picked.
    expect(patch.steps[1]).not.toHaveProperty('input.connectionId');
    expect(screen.getByLabelText('Connection')).toBeTruthy();
  });
});

describe('the app-wide strip about pending module changes', () => {
  const stale = () => {
    const schema = withModules(mailerManifest);
    schema.modules = schema.modules.map((module) => ({ ...module, manifestHash: 'older' }));

    return schema;
  };
  const showStrip = (pathname: string) => {
    const schema = stale();
    const config = resolvedFixture({ modules: [studio(), defineModuleStudio(mailerManifest)()] });

    return render(
      <TestProviders
        client={createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) })}
        schema={schema}
        config={config}
        navigation={createStaticNavigation(pathname)}
      >
        <DriftBanner />
      </TestProviders>,
    );
  };

  /** The strip with dev auto-apply on, and the plan the server would give for the stale module. */
  const showAutoApplying = (plan: Partial<PlanResult>) => {
    const schema = stale();
    const api = fakeModules(schema, [mailerConnection]);
    api.plan = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      manifestHash: 'h',
      planHash: 'p',
      hasDestructive: false,
      hasConflicts: false,
      changes: [],
      ...plan,
    }));
    api.apply = vi.fn(async (manifest: ModuleManifest) => ({
      moduleId: manifest.id,
      version: manifest.version,
      manifestHash: 'h',
      metadataVersion: 2,
      applied: [],
    }));
    const config = resolvedFixture({
      modules: [studio(), defineModuleStudio(mailerManifest)()],
      dev: { autoApplyModules: true },
    });
    render(
      <TestProviders
        client={createFakeClient(schema, recordsFixture(), { modules: api })}
        schema={schema}
        config={config}
        navigation={createStaticNavigation('/workspaces/acme/records/person')}
      >
        <DriftBanner />
      </TestProviders>,
    );

    return api;
  };

  it('stops saying it is applying when there was nothing to apply, and says the changes are pending', async () => {
    // A version-only change: the plan is empty, so nothing is applied, and the module stays pending.
    const api = showAutoApplying({});
    await waitFor(() => expect(screen.queryByText(/module changes…$/)).toBeNull());
    expect(screen.getByText(/Module changes are pending for/)).toBeTruthy();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('stops saying it is applying when a change needs a person to look at it, and asks for that', async () => {
    const api = showAutoApplying({ hasDestructive: true });
    await waitFor(() => expect(screen.queryByText(/module changes…$/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Review and apply' })).toBeTruthy();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('applies what has real changes, then stops saying it is applying', async () => {
    const api = showAutoApplying({
      changes: [{ action: 'create', kind: 'field', id: '01a1751f-5f0a-70f6-b258-bf3aae371568', label: 'X' } as never],
    });
    await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/module changes…$/)).toBeNull());
  });

  it('names the modules with changes waiting, anywhere in the studio', () => {
    showStrip('/workspaces/acme/records/person');
    expect(screen.getByText(/Module changes are pending for/)).toBeTruthy();
    expect(screen.getByText('Mailer')).toBeTruthy();
  });

  it('shows on the list of modules, and stays out of a module’s page, which says so itself', () => {
    const list = showStrip('/workspaces/acme/settings/modules');
    expect(screen.getByText(/Module changes are pending for/)).toBeTruthy();
    list.unmount();
    showStrip('/workspaces/acme/settings/modules/01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect(screen.queryByText(/Module changes are pending for/)).toBeNull();
  });
});
