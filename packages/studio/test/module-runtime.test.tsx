import type {
  Connection,
  DeviasClient,
  InstalledModule,
  Job,
  ModuleManifest,
  Workflow,
  WorkspaceSchema,
} from '@devias/core';
import { defineModuleStudio, hashManifest, indexSchema, keyOfId, type PlanResult, parseManifest } from '@devias/core';
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
  id: 'mailer',
  version: '0.1.0',
  name: 'Mailer',
  description: 'Send transactional email.',
  icon: 'mail',
  website: 'https://www.mailer.example/product',
  connections: [
    {
      id: 'mailer.default',
      kind: 'api_key',
      fields: [
        { name: 'api_key', label: 'API key', placeholder: 're_…' },
        { name: 'webhook_secret', label: 'Webhook signing secret', required: false },
      ],
    },
  ],
  actions: [
    {
      id: 'mailer.send_email',
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
  events: [{ id: 'mailer.email.delivered', description: 'Delivered.' }, { id: 'mailer.email.bounced' }],
  webhookHelp: 'Add this URL under Webhooks.',
});
const ledgerManifest: ModuleManifest = parseManifest({
  id: 'ledger',
  version: '0.1.0',
  name: 'Ledger',
  publisher: { id: 'ledger-co', name: 'Ledger Co', url: 'https://ledger.test' },
  engines: { devias: '>=0.4' },
  connections: [{ id: 'ledger.default', kind: 'api_key', fields: [{ name: 'token', label: 'Token' }] }],
  policies: [
    {
      id: 'ledger.large',
      description: 'Entries over 1,000 need review.',
      match: { objectId: 'fixture.company' },
      when: { fieldId: 'fixture.company.amount', above: 1000 },
      decision: 'review',
    },
  ],
});

const installed = (manifest: ModuleManifest): InstalledModule => ({
  moduleId: manifest.id,
  version: manifest.version,
  manifestHash: 'installed-hash',
  installedAt: now,
  updatedAt: now,
  core: manifest.core,
  blocks: manifest.blocks,
  agents: manifest.agents,
  skills: manifest.skills,
  name: manifest.name,
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
  moduleId: 'mailer',
  providerId: 'default',
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

const failedJob: Job = {
  id: 'job-1',
  moduleId: 'mailer',
  name: 'sync',
  status: 'failed',
  payload: null,
  result: null,
  attempts: 6,
  maxAttempts: 6,
  runAt: now,
  lastError: 'Mailer answered 503',
  schedule: 'nightly',
  connectionId: null,
  idempotencyKey: null,
  createdAt: now,
  updatedAt: now,
  finishedAt: now,
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
          moduleId: module.moduleId,
          providerId: keyOfId(provider.id),
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
  jobs: {
    list: vi.fn(async () => ({ items: [failedJob], nextCursor: null })),
    get: vi.fn(async () => failedJob),
    retry: vi.fn(async () => ({ ...failedJob, status: 'pending' as const })),
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
        moduleId: 'mailer',
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
    expect(describeTrigger({ kind: 'event', moduleId: 'mailer', types: ['*'] }, index, schema.modules)).toBe(
      'When Mailer sends any event',
    );
    expect(
      describeTrigger(
        { kind: 'event', moduleId: 'mailer', types: ['email.delivered', 'email.bounced'] },
        index,
        schema.modules,
      ),
    ).toBe('When Mailer sends email.delivered or email.bounced');
    expect(describeTrigger({ kind: 'event', moduleId: 'ghost', types: ['x'] }, index)).toBe('When ghost sends x');
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
    const row = within(await findRow('mailer'));
    // The server catalog offers what the studio was not built with.
    const ledger = await findRow('ledger');
    expect(within(ledger).getByText('Not installed')).toBeTruthy();
    fireEvent.click(row.getByRole('button'));
    expect(window.location.pathname).toBe('/workspaces/acme/settings/modules/mailer');
  });

  it('shows the status, the webhook URL and the events of an installed module on its page', async () => {
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, 'mailer');
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
    expect(api.events).toHaveBeenCalledWith('mailer', expect.objectContaining({ limit: expect.any(Number) }));

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
    showModules(client, schema, 'ledger');
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
    showModules(client, schema, 'ledger');
    const policies = within(await slot('[data-slot="module-policies"]'));
    expect(policies.getByText('Entries over 1,000 need review.')).toBeTruthy();
    expect(policies.getByText('Review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ledger Co' }).getAttribute('href')).toBe('https://ledger.test');
    expect(screen.getByText('>=0.4')).toBeTruthy();
  });

  it('leads with what is left to set up, and connects an installed module with its API key fields', async () => {
    const schema = withModules(ledgerManifest);
    const api = fakeModules(schema, [], [ledgerManifest]);
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, 'ledger');
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
        module: 'ledger',
        provider: 'default',
        visibility: 'workspace',
        values: { token: 'tok_secret' },
      }),
    );
  });

  it('lists what a module did in the background and runs a failed job again', async () => {
    const schema = withModules(mailerManifest);
    const api = fakeModules(schema, [mailerConnection]);
    const client = createFakeClient(schema, recordsFixture(), { modules: api });
    showModules(client, schema, 'mailer');
    fireEvent.click(await screen.findByRole('tab', { name: 'Jobs' }));
    await screen.findByText('Mailer answered 503');
    expect(screen.getByText(/Failed · schedule nightly · 6 attempts/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.jobs.retry).toHaveBeenCalledWith('job-1'));
  });

  it('asks to reconnect a refused connection', async () => {
    const schema = withModules(mailerManifest);
    const refused = { ...mailerConnection, status: 'auth_failed' as const, lastError: 'Mailer rejected the API key' };
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [refused]) });
    showModules(client, schema, 'mailer');
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
    showModules(client, schema, 'mailer');
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
    showModules(client, schema, 'mailer');
    await screen.findByText('Up to date');
    expect(document.querySelector('[data-slot="module-update"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
    // Looking at the changes is the Changes tab.
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeTruthy();
  });

  it("links the module's website in its details, by its host", async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, 'mailer');
    const link = (await screen.findByText('mailer.example')).closest('a');
    expect(link?.getAttribute('href')).toBe('https://www.mailer.example/product');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Website')).toBeTruthy();
  });

  it('puts Uninstall at the bottom of the overview, in a card of its own, and asks before it does anything', async () => {
    const schema = withModules(mailerManifest);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [mailerConnection]) });
    showModules(client, schema, 'mailer');
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
        { action: 'create', kind: 'field', id: 'mailer.a', label: 'A' },
        { action: 'update', kind: 'field', id: 'mailer.b', label: 'B' },
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
    showModules(client, schema, 'mailer');
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
    showModules(client, schema, 'ledger');
    await slot('[data-slot="module-setup"]');
    expect(document.querySelector('[data-slot="module-uninstall"]')).toBeNull();
  });

  it('has no Connection part for a module with nothing to connect to', async () => {
    const plain = parseManifest({
      id: 'plain',
      version: '0.1.0',
      name: 'Plain',
      actions: [{ id: 'plain.run', label: 'Run it', input: [], output: [] }],
    });
    const schema = withModules(plain);
    const client = createFakeClient(schema, recordsFixture(), {
      modules: fakeModules(schema, [], [plain]),
    });
    showModules(client, schema, 'plain');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toContain('Plain');
    await slot('[data-slot="module-overview"]');
    // "What it adds" already counts its actions; a Connection part saying the same would be noise.
    expect(screen.queryByRole('heading', { name: 'Connection' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'What it adds' })).toBeTruthy();
  });

  it('counts the agents a module installs among what it adds', async () => {
    const lab = parseManifest({
      id: 'lab',
      version: '0.1.0',
      name: 'Lab',
      agents: [
        { id: 'lab.analyst', name: 'Analyst', actionIds: ['core.list_records'] },
        { id: 'lab.clerk', name: 'Clerk', actionIds: ['core.list_records'] },
      ],
    });
    const schema = withModules(lab);
    const client = createFakeClient(schema, recordsFixture(), { modules: fakeModules(schema, [], [lab]) });
    showModules(client, schema, 'lab');
    await slot('[data-slot="module-overview"]');
    const adds = document.querySelector('[data-slot="module-adds"]') as HTMLElement;
    expect(within(adds).getByText('Agents').nextElementSibling?.textContent).toBe('2');
    // A module with none does not mention them.
    cleanup();
    const plain = parseManifest({
      id: 'plain',
      version: '0.1.0',
      name: 'Plain',
      actions: [{ id: 'plain.run', label: 'Run', input: [], output: [] }],
    });
    const plainSchema = withModules(plain);
    showModules(
      createFakeClient(plainSchema, recordsFixture(), { modules: fakeModules(plainSchema, [], [plain]) }),
      plainSchema,
      'plain',
    );
    await slot('[data-slot="module-overview"]');
    expect(within(document.querySelector('[data-slot="module-adds"]') as HTMLElement).queryByText('Agents')).toBeNull();
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
          actionId: 'core.update_record',
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
    expect(await screen.findByRole('option', { name: 'Add a note to a record' })).toBeTruthy();
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
      actionId: 'mailer.send_email',
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
      changes: [{ action: 'create', kind: 'field', id: 'mailer.x', label: 'X' } as never],
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
    showStrip('/workspaces/acme/settings/modules/mailer');
    expect(screen.queryByText(/Module changes are pending for/)).toBeNull();
  });
});
