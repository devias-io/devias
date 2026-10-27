import type { WorkflowStepInput } from '@devias/core';
import { coreIds, type DeviasClient, indexSchema, type Workflow, type WorkflowRun } from '@devias/core';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

import { WorkflowsPage } from '../src/pages/workflows';
import { WorkflowEditorPage } from '../src/pages/workflows/workflow-editor';
import { describeTrigger } from '../src/pages/workflows/workflow-list';
import { insertStep, layoutWorkflow, removeStep, replaceStep } from '../src/pages/workflows/workflow-tree';
import { RecordPage } from '../src/record/record-page';
import { createStaticNavigation } from '../src/router/navigation';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const now = '2026-01-01T00:00:00.000Z';

const workflows: Workflow[] = [
  {
    id: 'wf-1',
    workspaceId: 'ws1',
    title: 'Welcome task',
    enabled: true,
    trigger: {
      kind: 'record_event',
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      types: ['record.created', 'record.updated'],
      fieldIds: ['01a17522-948c-716e-8949-3b5c910db6f8'],
      condition: { field: '01a17522-948c-716e-8949-3b5c910db6f8', op: 'eq', value: 'won' },
    },
    steps: [
      {
        id: 's1',
        kind: 'action',
        actionId: coreIds.actions.create_record,
        input: { object: 'company', values: { name: 'Welcome {{record.first_name}}' } },
      },
    ],
    lastRunAt: now,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'wf-3',
    workspaceId: 'ws1',
    title: 'Route by stage',
    enabled: true,
    trigger: { kind: 'manual', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
    steps: [
      {
        id: 'if1',
        kind: 'branch',
        condition: { field: '01a17522-948c-716e-8949-3b5c910db6f8', op: 'eq', value: 'won' },
        yes: [
          {
            id: 'won',
            label: 'Celebrate',
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'person', id: '{{record.id}}', values: { email: 'party@example.com' } },
          },
        ],
        no: [
          {
            id: 'lost',
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: { object: 'company', values: { name: 'Follow up' } },
          },
        ],
      },
    ],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'wf-2',
    workspaceId: 'ws1',
    title: 'Mark as won',
    enabled: true,
    trigger: { kind: 'manual', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
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
  },
];

const runs: WorkflowRun[] = [
  {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'failed',
    trigger: {
      kind: 'record_event',
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      recordId: 'p1',
      eventType: 'record.updated',
      sequence: 9,
    },
    steps: [
      {
        id: 's1',
        kind: 'action',
        actionId: coreIds.actions.create_record,
        status: 'failed',
        error: 'Invalid record data',
      },
    ],
    error: 'Step 1 (createRecord) failed: Invalid record data',
    createdAt: now,
    startedAt: now,
    finishedAt: now,
  },
];

const fakeWorkflows = (): DeviasClient['workflows'] => ({
  list: vi.fn(async () => workflows),
  get: vi.fn(async (id: string) => workflows.find((w) => w.id === id) as Workflow),
  create: vi.fn(async () => workflows[0] as Workflow),
  update: vi.fn(
    async (id: string, patch) => ({ ...(workflows.find((w) => w.id === id) as Workflow), ...patch }) as Workflow,
  ),
  delete: vi.fn(async () => {}),
  runs: vi.fn(async () => ({ items: runs, nextCursor: null })),
  recordRuns: vi.fn(async () => ({ items: [] })),
  activity: vi.fn(async ({ days = 30 } = {}) => ({
    days: Array.from({ length: days }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      succeeded: i === days - 1 ? 3 : 0,
      failed: i === days - 1 ? 1 : 0,
    })),
    workflows: [
      {
        workflowId: 'wf-1',
        runs: 4,
        failed: 1,
        lastRunId: 'run-1',
        lastStatus: 'failed' as const,
        lastError: 'Step 1 (createRecord) failed: Invalid record data',
      },
    ],
  })),
  retryRun: vi.fn(async (id: string) => ({ ...(runs[0] as WorkflowRun), id: 'run-3', workflowId: id })),
  run: vi.fn(async (id: string) => ({
    id: 'run-2',
    workflowId: id,
    status: 'succeeded' as const,
    trigger: { kind: 'manual' as const, objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8', recordId: 'p1' },
    steps: [{ id: 's1', kind: 'action' as const, action: coreIds.actions.update_record, status: 'succeeded' as const }],
    createdAt: now,
    startedAt: now,
    finishedAt: now,
  })),
});

describe('workflow words', () => {
  it('describes triggers and schedules in the words of the data model', () => {
    const index = indexSchema(schemaFixture());
    expect(describeTrigger(workflows[0]?.trigger as Workflow['trigger'], index)).toBe(
      'When a person is created or updated and Stage changes, if it matches a condition',
    );
    expect(describeTrigger({ kind: 'manual', objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' }, index)).toBe(
      'Run by hand on a company',
    );
    expect(
      describeTrigger(
        { kind: 'schedule', cron: '0 9 * * 1-5', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
        index,
      ),
    ).toBe('Weekdays at 09:00 UTC for each person');
    expect(describeTrigger({ kind: 'schedule', cron: '*/15 * * * *' }, index)).toBe('Every 15 minutes');
  });
});

describe('workflows page', () => {
  it('lists workflows with their triggers, shows runs, and toggles them', async () => {
    const api = fakeWorkflows();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    const Section = WorkflowsPage;
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows')}>
        <Section />
      </TestProviders>,
    );
    await screen.findByRole('link', { name: 'Welcome task' });
    expect(
      screen.getByText('When a person is created or updated and Stage changes, if it matches a condition'),
    ).toBeTruthy();
    expect(screen.getAllByText('Run by hand on a person')).toHaveLength(2);

    // The signal on top: the runs of the period, and the failures.
    await screen.findByText('75% of runs succeeded. 1 workflow failed on its last run; open its runs to see why.');
    expect(document.querySelector('[data-slot="signal-card"]')?.textContent).toContain('All runs4');
    expect(api.activity).toHaveBeenCalledWith({ days: 7, tz: expect.any(String) });
    expect(
      screen.getByText('75% of runs succeeded. 1 workflow failed on its last run; open its runs to see why.'),
    ).toBeTruthy();
    // Succeeded and failed stack in the columns, named with their totals under the figure.
    const legend = document.querySelector('[data-slot="runs-legend"]') as HTMLElement;
    expect(legend.textContent).toContain('3 succeeded');
    expect(legend.textContent).toContain('1 failed');
    expect(document.querySelectorAll('[data-slot="column"]')).toHaveLength(7);
    expect(screen.getByText('4 runs · 1 failed')).toBeTruthy();
    // A workflow's runs open from its own row.
    const first = document.querySelector('[data-workflow="wf-1"]') as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: 'Runs' }));
    await screen.findByText('Person updated');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('[data-slot="workflow-runs"]')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: '1M' }));
    await waitFor(() => expect(api.activity).toHaveBeenCalledWith({ days: 30, tz: expect.any(String) }));

    // Each row shows how its last run went, not its steps, and its runs in the period; the failing ones have a filter of their own.
    const card = document.querySelector('[data-workflow="wf-1"]') as HTMLElement;
    expect(card.querySelector('[aria-label="Steps"]')).toBeNull();
    expect(card.textContent).toContain('Failed');
    expect(screen.getByText('Runs (1M)')).toBeTruthy();
    expect(within(card).getByText('4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Failing 1' }));
    expect(document.querySelectorAll('[data-slot="workflow-row"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(document.querySelectorAll('[data-slot="workflow-row"]')).toHaveLength(3);

    // Runs open beside the list, with what every step did, and a failed run can be retried.
    fireEvent.click(screen.getAllByRole('button', { name: 'Runs' })[0] as HTMLElement);
    await screen.findByText('Person updated');
    expect(api.runs).toHaveBeenCalledWith('wf-1', expect.objectContaining({ limit: expect.any(Number) }));
    fireEvent.click(screen.getByText('Person updated'));
    await screen.findByText('Open the person');
    expect(screen.getAllByText(/Invalid record data/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.retryRun).toHaveBeenCalledWith('wf-1', 'run-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('[data-slot="workflow-runs"]')).toBeNull());

    fireEvent.click(screen.getByRole('switch', { name: 'Mark as won enabled' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('wf-2', { title: 'Mark as won', enabled: false }));

    // Creating and editing happen on a screen of their own.
    fireEvent.click(screen.getAllByRole('button', { name: /New workflow/ })[0] as HTMLElement);
    expect(window.location.pathname).toBe('/workspaces/acme/workflows/new');
    expect(screen.getByRole('link', { name: 'Welcome task' }).getAttribute('href')).toBe(
      '/workspaces/acme/workflows/wf-1',
    );
  });

  it('offers what a workflow can start from when there are none, each a way into the editor', async () => {
    const api = fakeWorkflows();
    api.list = vi.fn(async () => []);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows')}>
        <WorkflowsPage />
      </TestProviders>,
    );
    await screen.findByText('No workflows yet');
    // The page keeps its title; the first workflow is made from the view's own button.
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeTruthy();
    const kinds = within(screen.getByRole('list', { name: 'What starts a workflow' }));
    expect(kinds.getAllByRole('button')).toHaveLength(5);
    fireEvent.click(kinds.getByRole('button', { name: /On a schedule/ }));
    expect(window.location.pathname + window.location.search).toBe('/workspaces/acme/workflows/new?trigger=schedule');
    fireEvent.click(screen.getByRole('button', { name: /New workflow/ }));
    expect(window.location.pathname + window.location.search).toBe('/workspaces/acme/workflows/new');
  });

  it('shows a run that waits for a runner or is being worked on, before it has an end', async () => {
    const api = fakeWorkflows();
    const queued: WorkflowRun = {
      ...(runs[0] as WorkflowRun),
      id: 'run-queued',
      status: 'pending',
      steps: [],
      error: undefined,
      startedAt: null,
      finishedAt: null,
    };
    const working: WorkflowRun = { ...queued, id: 'run-working', status: 'running', startedAt: now };
    api.runs = vi.fn(async () => ({ items: [queued, working, ...runs], nextCursor: null }));
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows')}>
        <WorkflowsPage />
      </TestProviders>,
    );
    await screen.findByRole('link', { name: 'Welcome task' });
    fireEvent.click(
      within(document.querySelector('[data-workflow="wf-1"]') as HTMLElement).getByRole('button', { name: 'Runs' }),
    );
    await waitFor(() => expect(document.querySelectorAll('[data-slot="workflow-run"]').length).toBeGreaterThan(2));
    const rows = [...document.querySelectorAll('[data-slot="workflow-run"]')];
    expect(rows.slice(0, 2).map((row) => row.getAttribute('data-status'))).toEqual(['pending', 'running']);
    expect(rows[0]?.textContent).toContain('queued');
    expect(rows[1]?.textContent).toContain('running');
    expect(rows[0]?.querySelector('[aria-label="Queued"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[aria-label="Running"]')).not.toBeNull();
  });

  it('names a past step of a module action by the action, not by its id, and says when the module is gone', async () => {
    const actionId = '01a17ead-51f9-718e-a1bd-47b20dbc21da';
    const api = fakeWorkflows();
    const done: WorkflowRun = {
      ...(runs[0] as WorkflowRun),
      id: 'run-module',
      status: 'succeeded',
      error: undefined,
      steps: [{ id: 's1', kind: 'action', actionId, status: 'succeeded' }],
    };
    api.runs = vi.fn(async () => ({ items: [done], nextCursor: null }));
    const open = async (schema: ReturnType<typeof schemaFixture>) => {
      const client = createFakeClient(schema, recordsFixture(), { workflows: api });
      render(
        <TestProviders
          client={client}
          schema={schema}
          navigation={createStaticNavigation('/workspaces/acme/workflows')}
        >
          <WorkflowsPage />
        </TestProviders>,
      );
      await screen.findByRole('link', { name: 'Welcome task' });
      fireEvent.click(
        within(document.querySelector('[data-workflow="wf-1"]') as HTMLElement).getByRole('button', { name: 'Runs' }),
      );
      await waitFor(() => expect(document.querySelectorAll('[data-slot="workflow-run"]')).toHaveLength(1));
      fireEvent.click(document.querySelector('[data-slot="workflow-run"] button') as HTMLElement);

      return document.querySelector('[data-slot="workflow-run"]') as HTMLElement;
    };
    const withModule = {
      ...schemaFixture(),
      modules: [
        {
          id: 'enrich',
          label: 'Enrichment',
          actions: [{ id: actionId, name: 'enrich_person', label: 'Enrich a person with Context.dev' }],
        },
      ],
    } as unknown as ReturnType<typeof schemaFixture>;
    const installed = await open(withModule);
    expect(installed.textContent).toContain('Enrich a person with Context.dev');
    expect(installed.textContent).not.toContain(actionId);
    cleanup();
    const gone = await open(schemaFixture());
    expect(gone.textContent).toContain('Removed action');
    expect(gone.textContent).not.toContain(actionId);
  });

  it('shows a run that waits to try a step again, and the tries a step took', async () => {
    const api = fakeWorkflows();
    const at = '2026-01-01T14:05:00.000Z';
    const waiting: WorkflowRun = {
      ...(runs[0] as WorkflowRun),
      id: 'run-waiting',
      status: 'pending',
      error: undefined,
      startedAt: now,
      finishedAt: null,
      steps: [
        {
          id: 's1',
          kind: 'action',
          actionId: coreIds.actions.create_record,
          label: 'Add the lead',
          status: 'retrying',
          attempt: 2,
          error: 'Rate limited',
          retryAt: at,
        },
      ],
    };
    const done: WorkflowRun = {
      ...waiting,
      id: 'run-done',
      status: 'succeeded',
      finishedAt: now,
      steps: [
        {
          id: 's1',
          kind: 'action',
          actionId: coreIds.actions.create_record,
          label: 'Add the lead',
          status: 'succeeded',
          attempt: 3,
        },
      ],
    };
    api.runs = vi.fn(async () => ({ items: [waiting, done], nextCursor: null }));
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows')}>
        <WorkflowsPage />
      </TestProviders>,
    );
    await screen.findByRole('link', { name: 'Welcome task' });
    fireEvent.click(
      within(document.querySelector('[data-workflow="wf-1"]') as HTMLElement).getByRole('button', { name: 'Runs' }),
    );
    await waitFor(() => expect(document.querySelectorAll('[data-slot="workflow-run"]')).toHaveLength(2));
    const [first, second] = [...document.querySelectorAll('[data-slot="workflow-run"]')] as HTMLElement[];
    expect(first?.textContent).toContain('Will try again · Rate limited');
    fireEvent.click(first?.querySelector('button') as HTMLElement);
    expect(first?.textContent).toMatch(/Retrying at \d\d:\d\d · try 3 of 6/);
    fireEvent.click(second?.querySelector('button') as HTMLElement);
    expect(second?.textContent).toContain('Succeeded · try 3');
  });

  describe('a workflow that comes with a module', () => {
    const shipped: Workflow = {
      ...(workflows[1] as Workflow),
      id: 'wf-shipped',
      title: 'Record payments',
      moduleId: 'stripe',
    };

    it('is marked in the list, can be viewed and copied, and cannot be deleted', async () => {
      const api = fakeWorkflows();
      api.list = vi.fn(async () => [shipped]);
      api.create = vi.fn(async () => ({ ...shipped, id: 'wf-copy', title: 'Record payments (copy)' }));
      const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
      render(
        <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows')}>
          <WorkflowsPage />
        </TestProviders>,
      );
      await screen.findByRole('link', { name: 'Record payments' });
      expect(document.querySelector('[data-slot="workflow-module"]')?.textContent).toBe('A module');
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Record payments' }));
      await screen.findByRole('menuitem', { name: /View/ });
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /Edit/ })).toBeNull();
      fireEvent.click(screen.getByRole('menuitem', { name: /Make a copy/ }));
      await waitFor(() =>
        expect(api.create).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Record payments (copy)', enabled: false, trigger: shipped.trigger }),
        ),
      );
      await waitFor(() => expect(window.location.pathname).toBe('/workspaces/acme/workflows/wf-copy'));
    });

    it('opens read-only in the editor: only on and off, or a copy', async () => {
      const api = fakeWorkflows();
      api.list = vi.fn(async () => [shipped]);
      api.get = vi.fn(async () => shipped);
      const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
      render(
        <TestProviders
          client={client}
          navigation={createStaticNavigation('/workspaces/acme/workflows/wf-shipped', {}, { workflowId: 'wf-shipped' })}
        >
          <WorkflowEditorPage />
        </TestProviders>,
      );
      await screen.findByRole('heading', { name: 'Record payments' });
      expect(document.querySelector('[data-slot="module-workflow-note"]')?.textContent).toContain(
        'cannot be changed here',
      );
      expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Add step/ })).toBeNull();
      // Turning it off is the workspace's, and saves at once.
      fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      await waitFor(() =>
        expect(api.update).toHaveBeenCalledWith('wf-shipped', { title: 'Record payments', enabled: false }),
      );
      fireEvent.click(screen.getByRole('button', { name: /Make a copy/ }));
      await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    });
  });

  it('starts a new workflow from the trigger named in the address', async () => {
    const api = fakeWorkflows();
    api.list = vi.fn(async () => []);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/workflows/new', { trigger: 'schedule' })}
      >
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'New workflow' });
    expect(document.querySelector('[data-slot="trigger-panel"]')?.textContent).toContain('On a schedule');
  });

  it('edits a task trigger: its events, the statuses it moves to, and branches over the task', async () => {
    const taskWorkflow: Workflow = {
      id: 'wf-task',
      workspaceId: 'ws1',
      title: 'Review done tasks',
      enabled: true,
      trigger: { kind: 'task_event', types: ['status_changed'], statuses: ['done'] },
      steps: [
        {
          id: 'if1',
          kind: 'branch',
          condition: { field: 'priority', op: 'eq', value: 'urgent' },
          yes: [
            {
              id: 'note',
              kind: 'action',
              actionId: coreIds.actions.comment_on_task,
              input: { id: '{{record.id}}', markdown: 'Done.' },
            },
          ],
          no: [],
        },
      ],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const api = fakeWorkflows();
    api.list = vi.fn(async () => [taskWorkflow]);
    api.get = vi.fn(async () => taskWorkflow);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/workflows/wf-task', {}, { workflowId: 'wf-task' })}
      >
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'Review done tasks' });
    expect(screen.getByText('If Priority is Urgent')).toBeTruthy();
    const panel = () => document.querySelector('[data-slot="trigger-panel"]') as HTMLElement;
    await waitFor(() => expect(panel().textContent).toContain('When a task changes'));
    const events = within(within(panel()).getByRole('group', { name: 'Events' }));
    expect(events.getByRole('button', { name: 'moved to a status' }).getAttribute('aria-pressed')).toBe('true');
    expect(events.getByRole('button', { name: 'created' }).getAttribute('aria-pressed')).toBe('false');
    const statuses = within(within(panel()).getByRole('group', { name: 'Statuses' }));
    expect(statuses.getByRole('button', { name: 'Done' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(events.getByRole('button', { name: 'moved to a status' }));
    await waitFor(() => expect(within(panel()).queryByRole('group', { name: 'Statuses' })).toBeNull());
    expect(within(panel()).getByText('Pick at least one event')).toBeTruthy();
  });

  it('lets a record trigger also run for imported records, which it does not by default', async () => {
    const wf: Workflow = {
      id: 'wf-rec',
      workspaceId: 'ws1',
      title: 'Welcome new people',
      enabled: true,
      trigger: { kind: 'record_event', objectId: 'person', types: ['record.created'] },
      steps: [
        { id: 's1', kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'person', values: {} } },
      ],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const api = fakeWorkflows();
    api.list = vi.fn(async () => [wf]);
    api.get = vi.fn(async () => wf);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/workflows/wf-rec', {}, { workflowId: 'wf-rec' })}
      >
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'Welcome new people' });
    const imports = await screen.findByRole('switch', { name: /Imported records|import/i });
    expect(imports.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/imports are skipped unless you ask/)).toBeTruthy();
    fireEvent.click(imports);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Imported records|import/i }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });

  it('asks for a name and a step before creating, and takes the whole window', async () => {
    const api = fakeWorkflows();
    api.list = vi.fn(async () => []);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/workflows/new')}>
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'New workflow' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('Give the workflow a title.');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('Add at least one step.');
    expect(api.create).not.toHaveBeenCalled();

    // The editor takes the whole window, like the invoice composer.
    const editor = document.querySelector('[data-slot="workflow-editor"]');
    expect(editor?.className).toContain('fixed inset-0');
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();

    // Leaving with changes asks first.
    fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
    await screen.findByText('Leave without saving?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Leave without saving?')).toBeNull());
  });
});

describe('describing task triggers', () => {
  it('says when a task workflow starts', () => {
    const index = indexSchema(schemaFixture());
    expect(describeTrigger({ kind: 'task_event', types: ['created', 'assigned'] }, index)).toBe(
      'When a task is created or assigned',
    );
    expect(
      describeTrigger(
        {
          kind: 'task_event',
          types: ['status_changed'],
          statuses: ['done', 'canceled'],
          condition: { field: 'priority', op: 'eq', value: 'urgent' },
        },
        index,
      ),
    ).toBe('When a task is moved to a status (done or canceled), if it matches a condition');
  });
});

describe('manual workflows on a record', () => {
  it('lists them in the Actions menu and runs them on the record', async () => {
    const api = fakeWorkflows();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    const schema = schemaFixture();
    const person = schema.objects[0];

    if (!person) {
      throw new Error('fixture');
    }

    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/records/person/p1')}>
        <RecordPage object={person} recordId="p1" />
      </TestProviders>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
    const item = await screen.findByText('Mark as won');
    fireEvent.click(item);
    await waitFor(() => expect(api.run).toHaveBeenCalledWith('wf-2', { recordId: 'p1', wait: false }));
  });
});

describe('a record being worked on by a workflow', () => {
  const person = () => {
    const found = schemaFixture().objects[0];

    if (!found) {
      throw new Error('fixture');
    }

    return found;
  };
  const queued: WorkflowRun = {
    id: 'run-q',
    workflowId: 'wf-2',
    status: 'pending',
    trigger: { kind: 'manual', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8', recordId: 'p1' },
    steps: [],
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
  let queryClient = new QueryClient();
  const show = (api: DeviasClient['workflows']) => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });

    return render(
      <TestProviders
        client={client}
        queryClient={queryClient}
        navigation={createStaticNavigation('/workspaces/acme/records/person/p1')}
      >
        <RecordPage object={person()} recordId="p1" />
      </TestProviders>,
    );
  };
  /** What live updates do when the server says a run changed. */
  const runChanged = () => queryClient.invalidateQueries({ queryKey: ['workspace', 'ws1', 'workflows'] });

  it('says so in the page header and holds the workflow back in the menu, until the run is done', async () => {
    const api = fakeWorkflows();
    api.recordRuns = vi.fn(async () => ({
      items: [queued, { ...queued, id: 'run-old', status: 'succeeded' as const }],
    }));
    show(api);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Queued: Mark as won');
    expect(api.recordRuns).toHaveBeenCalledWith({ recordId: 'p1' });
    // It is working on the record, so it cannot be run again meanwhile; the others still can.
    fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
    const item = (await screen.findByText('Mark as won')).closest('[role="menuitem"]') as HTMLElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    cleanup();

    // Once it has run, there is nothing to say.
    const done = fakeWorkflows();
    done.recordRuns = vi.fn(async () => ({ items: [{ ...queued, status: 'succeeded' as const, finishedAt: now }] }));
    show(done);
    await waitFor(() => expect(done.recordRuns).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names a run that is working and one that waits to try a step again, and counts several', async () => {
    const running = { ...queued, status: 'running' as const, startedAt: now };
    const api = fakeWorkflows();
    api.recordRuns = vi.fn(async () => ({ items: [running] }));
    show(api);
    expect((await screen.findByRole('status')).textContent).toBe('Running Mark as won');
    cleanup();

    const waiting = {
      ...queued,
      steps: [{ id: 's1', kind: 'action' as const, status: 'retrying' as const, attempt: 1, retryAt: now }],
    };
    const retry = fakeWorkflows();
    retry.recordRuns = vi.fn(async () => ({ items: [waiting] }));
    show(retry);
    expect((await screen.findByRole('status')).textContent).toBe('Will try again: Mark as won');
    cleanup();

    const several = fakeWorkflows();
    several.recordRuns = vi.fn(async () => ({ items: [running, { ...queued, id: 'run-2', workflowId: 'wf-1' }] }));
    show(several);
    expect((await screen.findByRole('status')).textContent).toBe('2 workflows running');
  });

  it('queues the run when it is started from the menu, and tells how it ended, once', async () => {
    toasts.mockClear();
    toasts.success.mockClear();
    toasts.error.mockClear();
    const api = fakeWorkflows();
    let ended = false;
    api.run = vi.fn(async () => {
      return queued;
    });
    api.recordRuns = vi.fn(async () =>
      ended
        ? {
            items: [
              {
                ...queued,
                status: 'succeeded' as const,
                finishedAt: now,
                steps: [
                  {
                    id: 's1',
                    kind: 'action' as const,
                    status: 'succeeded' as const,
                    output: { reason: 'Looked up recently' },
                  },
                ],
              },
            ],
          }
        : { items: [] },
    );
    show(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
    fireEvent.click(await screen.findByText('Mark as won'));
    await waitFor(() => expect(api.run).toHaveBeenCalledWith('wf-2', { recordId: 'p1', wait: false }));
    expect(toasts).toHaveBeenCalledWith('Mark as won started');

    // The runner finishes it; the record's runs say so, and the person is told what the run reported.
    ended = true;
    await runChanged();
    await waitFor(() => expect(toasts).toHaveBeenCalledWith('Mark as won: Looked up recently'));
    // Said once: another refresh does not say it again.
    toasts.mockClear();
    await runChanged();
    await waitFor(() => expect(api.recordRuns).toHaveBeenCalled());
    expect(toasts).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('announces a failed run with what went wrong', async () => {
    toasts.mockClear();
    toasts.error.mockClear();
    const api = fakeWorkflows();
    let ended = false;
    api.run = vi.fn(async () => ({ ...queued, id: 'run-f' }));
    api.recordRuns = vi.fn(async () =>
      ended
        ? {
            items: [
              {
                ...queued,
                id: 'run-f',
                status: 'failed' as const,
                error: 'Step 1 failed: no credits',
                finishedAt: now,
              },
            ],
          }
        : { items: [] },
    );
    show(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
    fireEvent.click(await screen.findByText('Mark as won'));
    await waitFor(() => expect(api.run).toHaveBeenCalled());
    ended = true;
    await runChanged();
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Step 1 failed: no credits'));
  });
});

describe('workflow step tree', () => {
  const steps = workflows[1]?.steps ?? [];

  it('lays a branch out as two lanes that each end in a "+" and do not merge', () => {
    const layout = layoutWorkflow(steps);
    const kinds = layout.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'branch')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'step')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'add')).toHaveLength(2);
    const branch = layout.nodes.find((n) => n.kind === 'branch');
    const won = layout.nodes.find((n) => n.id === 'won');
    const lost = layout.nodes.find((n) => n.id === 'lost');

    if (!branch || !won || !lost) {
      throw new Error('layout');
    }

    expect(won.y).toBeGreaterThan(branch.y);
    expect(won.y).toBe(lost.y);
    expect(won.x).toBeLessThan(lost.x);
    expect(layout.edges.filter((e) => e.source === 'if1').map((e) => e.lane)).toEqual(['yes', 'no']);
    expect(layout.edges.some((e) => e.source === 'trigger' && e.target === 'if1')).toBe(true);
    // Nothing after the branch, so nothing draws the lanes back together.
    expect(layout.edges.filter((e) => e.target.startsWith('add:')).map((e) => e.source)).toEqual(['won', 'lost']);
    expect(layout.width).toBeGreaterThan(layout.nodes[0]?.width ?? 0);
  });

  it('merges the lanes only when steps follow the branch', () => {
    const after = insertStep(
      steps,
      { kind: 'after', id: 'if1' },
      {
        id: 'tail',
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'person', id: '{{record.id}}', values: {} },
      },
    );
    const layout = layoutWorkflow(after);
    expect(layout.nodes.filter((n) => n.kind === 'add').map((n) => n.id)).toEqual(['add:tail']);
    expect(layout.edges.filter((e) => e.target === 'tail').map((e) => e.source)).toEqual(['won', 'lost']);
    const tail = layout.nodes.find((n) => n.id === 'tail');
    const won = layout.nodes.find((n) => n.id === 'won');

    if (!tail || !won) {
      throw new Error('layout');
    }

    expect(tail.y).toBeGreaterThan(won.y);
  });

  it('draws empty lanes into the step that follows the branch', () => {
    const empty: WorkflowStepInput[] = [
      { id: 'if1', kind: 'branch', condition: { and: [] }, yes: [], no: [] },
      {
        id: 'tail',
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'person', id: '{{record.id}}', values: {} },
      },
    ];
    const layout = layoutWorkflow(empty);
    expect(layout.edges.filter((e) => e.target === 'tail').map((e) => e.source)).toEqual(['add:if1:yes', 'add:if1:no']);
    // Only a node with a source handle can start an edge, so the lane "+" must have one.
    expect(layout.nodes.filter((n) => n.kind === 'add').map((n) => n.id)).toEqual(
      expect.arrayContaining(['add:if1:yes', 'add:if1:no', 'add:tail']),
    );
  });

  it('inserts, replaces and removes steps inside lanes', () => {
    const added = insertStep(
      steps,
      { kind: 'lane', branch: 'if1', lane: 'no' },
      {
        id: 'x',
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'person', id: '{{record.id}}', values: {} },
      },
    );
    const branch = added[0];

    if (branch?.kind !== 'branch') {
      throw new Error('branch');
    }

    expect(branch.no.map((s) => s.id)).toEqual(['x', 'lost']);
    const after = insertStep(
      added,
      { kind: 'after', id: 'x' },
      {
        id: 'y',
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'person', id: '{{record.id}}', values: {} },
      },
    );
    expect((after[0] as { no: { id: string }[] }).no.map((s) => s.id)).toEqual(['x', 'y', 'lost']);
    const replaced = replaceStep(after, 'y', {
      id: 'y',
      label: 'Renamed',
      kind: 'action',
      actionId: coreIds.actions.update_record,
      input: { object: 'person', id: '{{record.id}}', values: {} },
    });
    expect((replaced[0] as { no: { label?: string }[] }).no[1]?.label).toBe('Renamed');
    const removed = removeStep(replaced, 'x');
    expect((removed[0] as { no: { id: string }[] }).no.map((s) => s.id)).toEqual(['y', 'lost']);
    expect(removeStep(removed, 'if1')).toEqual([]);
    expect(
      insertStep(
        [],
        { kind: 'end' },
        {
          id: 'z',
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: {} },
        },
      ).map((s) => s.id),
    ).toEqual(['z']);
  });
});

describe('workflow canvas', () => {
  it('draws the trigger, the steps and the branch lanes, and edits the selected node', async () => {
    const api = fakeWorkflows();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { workflows: api });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/workflows/wf-3', {}, { workflowId: 'wf-3' })}
      >
        <WorkflowEditorPage />
      </TestProviders>,
    );
    await screen.findByRole('heading', { name: 'Route by stage' });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    const dialog = document.body;
    await waitFor(() => expect(dialog.querySelectorAll('[data-canvas-node="step"]')).toHaveLength(2));
    expect(dialog.querySelectorAll('[data-canvas-node="branch"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('[data-canvas-node="add"]')).toHaveLength(2);
    await screen.findByText('Yes');
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('If Stage is Won')).toBeTruthy();
    expect(screen.getByText('Celebrate')).toBeTruthy();

    // Selecting the branch shows its condition; selecting a step shows its fields.
    fireEvent.click(screen.getByText('If Stage is Won'));
    await screen.findByText('Take the Yes lane when');
    fireEvent.click(screen.getByText('Celebrate'));
    await screen.findByLabelText('Email value');
    fireEvent.change(screen.getByLabelText('Name', { selector: '#step-name' }), { target: { value: 'Party time' } });
    await screen.findByText('Party time');

    // "+" on a lane adds a step there and selects it.
    fireEvent.click(screen.getByRole('button', { name: 'Add a step after Create a record' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Update the record/ }));
    await waitFor(() => expect(dialog.querySelectorAll('[data-canvas-node="step"]')).toHaveLength(3));
    await screen.findByText('Set fields');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const [, patch] = (api.update as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { steps: unknown[] }];
    const branch = patch.steps[0] as { kind: string; yes: { label?: string }[]; no: { kind: string }[] };
    expect(branch.kind).toBe('branch');
    expect(branch.yes[0]?.label).toBe('Party time');
    expect(branch.no.map((s) => [s.kind, (s as { actionId?: string }).actionId])).toEqual([
      ['action', coreIds.actions.create_record],
      ['action', coreIds.actions.update_record],
    ]);
  });
});
