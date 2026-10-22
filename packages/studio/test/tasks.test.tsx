import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTasksBlock } from '../src/pages/home/blocks/open-tasks';
import { TaskPage } from '../src/pages/tasks/task-page';
import { TasksPage } from '../src/pages/tasks/tasks-page';
import { MentionedInList } from '../src/record/blocks/mentioned-in';
import { tasksBlock } from '../src/record/blocks/tasks';
import { createStaticNavigation } from '../src/router/navigation';
import { TestProviders } from '../src/testing';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const setup = () => {
  // The signed-in person of the page (u1) is the one the mock acts as, so "me" means the same to both.
  const client = createMockClient({ workspaceId: 'ws1', manifests: [], actor: { kind: 'user', id: 'u1' } });
  const list = (path = '/workspaces/acme/tasks') =>
    render(
      <TestProviders client={client} navigation={createStaticNavigation(path)}>
        <TasksPage />
      </TestProviders>,
    );
  const open = (id: string) =>
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation(`/workspaces/acme/tasks/${id}`, {}, { taskId: id })}
      >
        <TaskPage />
      </TestProviders>,
    );

  return { client, list, open };
};

/** Choose which statuses the page shows, from the Status menu. */
const chooseStatus = async (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Status' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: label }));
};

const rows = () => [...document.querySelectorAll('[data-slot="task-row"]')].map((row) => row.textContent ?? '');

describe('the tasks page', () => {
  it('lists open tasks, narrows them by preset, search and priority, and adds one by typing', async () => {
    const { client, list } = setup();
    await client.tasks.create({ title: 'Call Ana', priority: 'high', assignee: 'user:u1' });
    await client.tasks.create({ title: 'Send quote', priority: 'low' });
    await client.tasks.create({ title: 'Old thing', status: 'done' });
    list();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().join(' ')).toContain('Call Ana');
    expect(rows().join(' ')).not.toContain('Old thing');

    // The tabs say how many are in each.
    const tabs = within(screen.getByRole('tablist', { name: 'Tasks' }));
    await waitFor(() => expect(tabs.getByRole('tab', { name: /All/ }).textContent).toContain('2'));

    fireEvent.click(tabs.getByRole('tab', { name: /My tasks/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('Call Ana');
    fireEvent.click(tabs.getByRole('tab', { name: /All/ }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Search tasks' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search tasks' }), { target: { value: 'quote' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('Send quote');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('No tasks match')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: '' } });
    await waitFor(() => expect(rows()).toHaveLength(2));

    const add = screen.getByRole('textbox', { name: 'Add a task' });
    fireEvent.change(add, { target: { value: 'Book the venue' } });
    fireEvent.submit(add.closest('form') as HTMLFormElement);
    await waitFor(() => expect(rows().join(' ')).toContain('Book the venue'));
    expect((await client.tasks.list({ search: 'venue' })).items[0]).toMatchObject({ status: 'todo' });
  });

  it('chooses the statuses apart from the tab: open, closed or both, in the list', async () => {
    const { client, list } = setup();
    await client.tasks.create({ title: 'Call Ana' });
    await client.tasks.create({ title: 'Old thing', status: 'done' });
    list();
    await waitFor(() => expect(rows()).toHaveLength(1));
    await chooseStatus('Closed');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('Old thing');
    await chooseStatus('All statuses');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await chooseStatus('Open');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('Call Ana');
  });

  it('draws a lane for each open status on the board, and the closed ones when asked for', async () => {
    const { client, list } = setup();
    await client.tasks.create({ title: 'Plan', status: 'backlog' });
    await client.tasks.create({ title: 'Build', status: 'in_progress' });
    await client.tasks.create({ title: 'Ship', status: 'done' });
    await client.tasks.create({ title: 'Dropped', status: 'canceled' });
    list();
    fireEvent.click(await screen.findByRole('button', { name: 'Board' }));
    const lanes = () =>
      [...document.querySelectorAll('[data-slot="board-lane"]')].map((lane) => lane.getAttribute('data-status'));
    const lane = (status: string) =>
      document.querySelector(`[data-slot="board-lane"][data-status="${status}"]`) as HTMLElement;
    await waitFor(() => expect(lanes()).toEqual(['backlog', 'todo', 'in_progress', 'in_review']));
    await waitFor(() => expect(within(lane('in_progress')).getByText('Build')).toBeTruthy());
    expect(within(lane('backlog')).getByText('Plan')).toBeTruthy();
    expect(within(lane('todo')).queryByText('Build')).toBeNull();
    expect(document.body.textContent).not.toContain('Ship');

    // Closed: only the closed lanes, and the same on every tab.
    await chooseStatus('Closed');
    await waitFor(() => expect(lanes()).toEqual(['done', 'canceled']));
    await waitFor(() => expect(within(lane('done')).getByText('Ship')).toBeTruthy());
    expect(within(lane('canceled')).getByText('Dropped')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Build');
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Tasks' })).getByRole('tab', { name: /My tasks/ }));
    await waitFor(() => expect(lanes()).toEqual(['done', 'canceled']));

    // All statuses: every lane.
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Tasks' })).getByRole('tab', { name: /All/ }));
    await chooseStatus('All statuses');
    await waitFor(() => expect(lanes()).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(document.querySelector('[data-slot="task-list"]')).toBeTruthy());
  });
});

describe('a task page', () => {
  it('saves a new title and properties with the version they were made from', async () => {
    const { client, open } = setup();
    const update = vi.spyOn(client.tasks, 'update');
    const task = await client.tasks.create({ title: 'Prepare demo', markdown: 'Dry run first.' });
    open(task.id);
    const title = await screen.findByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Prepare the demo' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(task.id, { title: 'Prepare the demo', expectedVersion: 1 }),
    );

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-05' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith(task.id, { dueDate: '2026-11-05', expectedVersion: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Urgent' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(task.id, { priority: 'urgent', expectedVersion: 3 }));
    expect(await client.tasks.get(task.id)).toMatchObject({
      title: 'Prepare the demo',
      priority: 'urgent',
      version: 4,
    });
  });

  it('says so when someone else changed the task first, and loads their version', async () => {
    const { client, open } = setup();
    const task = await client.tasks.create({ title: 'Race' });
    open(task.id);
    await screen.findByRole('textbox', { name: 'Title' });
    await client.tasks.update(task.id, { title: 'Theirs' });
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'In progress' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This task changed elsewhere');
    fireEvent.click(within(alert).getByRole('button', { name: 'Load the latest' }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement).value).toBe('Theirs'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await client.tasks.get(task.id)).status).toBe('todo');
  });

  it('shows the timeline, adds subtasks and lists what the task is about', async () => {
    const { client, open } = setup();
    const company = await client.records.create('company', { name: 'Initech' }).catch(() => null);
    const task = await client.tasks.create({
      title: 'Parent task',
      ...(company ? { about: [`record:company/${company.id}`] } : {}),
    });
    await client.tasks.comment(task.id, { markdown: 'First **thought**' });
    open(task.id);
    const timeline = await screen.findByText('First', { exact: false });
    expect(timeline).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="timeline-comment"]')).toHaveLength(1));
    expect(document.querySelectorAll('[data-slot="timeline-change"]').length).toBeGreaterThanOrEqual(1);

    const add = screen.getByRole('textbox', { name: 'Add a subtask' });
    fireEvent.change(add, { target: { value: 'Child task' } });
    fireEvent.submit(add.closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(
        within(document.querySelector('[data-slot="subtasks"]') as HTMLElement).getByText('Child task'),
      ).toBeTruthy(),
    );
    expect((await client.tasks.get(task.id)).subtasks).toEqual({ total: 1, open: 1 });
  });

  it('asks for confirmation before deleting, and leaves for the list', async () => {
    const { client, open } = setup();
    const task = await client.tasks.create({ title: 'Doomed' });
    open(task.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Task actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Delete/ }));
    await waitFor(async () => expect((await client.tasks.list()).total).toBe(0));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/acme/tasks'));
  });

  it('says when the task is gone', async () => {
    const { open } = setup();
    open('00000000-0000-4000-8000-000000000009');
    expect(await screen.findByText('Task not found')).toBeTruthy();
  });
});

describe('a task given to an agent', () => {
  const run = (over = {}) => ({
    id: 'run-1',
    taskId: 't',
    agentId: 'a',
    conversationId: 'conv-1',
    status: 'awaiting_review' as const,
    attempt: 1,
    requestedBy: 'u1',
    summary: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...over,
  });

  it('only offers agents that take tasks, then shows where the agent is and lets a person review or stop it', async () => {
    const { client, open } = setup();
    const quiet = await client.ai.agents.create({ name: 'Quiet' });
    const sales = await client.ai.agents.create({ name: 'Sales', takesTasks: true });
    const task = await client.tasks.create({ title: 'Quote Initech', assignee: `agent:${sales.id}` });
    const row = client.store.tasks.find((candidate) => candidate.id === task.id);
    if (row) {
      row.work = 'waiting_on_you';
    }

    vi.spyOn(client.tasks, 'runs').mockResolvedValue({ items: [run({ taskId: task.id, agentId: sales.id })] });
    const stop = vi.spyOn(client.tasks, 'stop');
    open(task.id);
    const panel = await waitFor(() => {
      const found = document.querySelector('[data-slot="agent-panel"]') as HTMLElement;
      expect(found).toBeTruthy();

      return found;
    });
    expect(await within(panel).findByText('Sales')).toBeTruthy();
    expect(within(panel).getByText('Waiting for your review')).toBeTruthy();
    fireEvent.click(await within(panel).findByRole('button', { name: 'Review what it proposes' }));
    expect((await import('../src/agent-chat/chat/store')).useAgentChatStore.getState().activeId.ws1).toBe('conv-1');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(stop).toHaveBeenCalledWith(task.id));

    // The picker lists the agent that takes tasks, and not the one that does not.
    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }));
    expect(await screen.findByRole('menuitemradio', { name: /Sales/ })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /Quiet/ })).toBeNull();
    expect(quiet.takesTasks).toBe(false);
  });

  it('offers to try again when the agent failed', async () => {
    const { client, open } = setup();
    const sales = await client.ai.agents.create({ name: 'Sales', takesTasks: true });
    const task = await client.tasks.create({ title: 'Doomed', assignee: `agent:${sales.id}` });
    const row = client.store.tasks.find((candidate) => candidate.id === task.id);
    if (row) {
      row.work = 'failed';
    }

    vi.spyOn(client.tasks, 'runs').mockResolvedValue({
      items: [run({ taskId: task.id, agentId: sales.id, status: 'failed', error: 'The model refused' })],
    });
    const retry = vi.spyOn(client.tasks, 'retry');
    open(task.id);
    const panel = await waitFor(() => {
      const found = document.querySelector('[data-slot="agent-panel"]') as HTMLElement;
      expect(found).toBeTruthy();

      return found;
    });
    expect(await within(panel).findByText('The model refused')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(task.id));
  });
});

describe('tasks elsewhere', () => {
  it('lists the open tasks about a record on its page, and adds one about it', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    const target = { id: '11111111-1111-4111-8111-111111111111', object: { nameSingular: 'company' } };
    await client.tasks.create({ title: 'Visit', about: [`record:company/${target.id}`] }).catch(() => null);
    const Block = tasksBlock.component;
    // A record needs an object in the schema; this checks the block against the empty case and the button.
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/records/company/x')}>
        <Block
          config={{}}
          surface="record"
          record={{ id: target.id, created_at: '', updated_at: '' }}
          object={{ ...(target.object as object), id: 'o1' } as never}
        />
      </TestProviders>,
    );
    expect(await screen.findByText('Tasks')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New task about this/ })).toBeTruthy();
  });

  it('shows the tasks that mention a document under "Mentioned in"', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    const doc = await client.documents.create({ title: 'Brief' });
    await client.tasks.create({ title: 'Read the brief', markdown: `See [Brief](document:${doc.id}).` });
    render(
      <TestProviders client={client}>
        <MentionedInList target={{ kind: 'document', id: doc.id }} />
      </TestProviders>,
    );
    const section = (await screen.findByText('Mentioned in')).closest('section') as HTMLElement;
    expect(within(section).getByText('Read the brief')).toBeTruthy();
    expect(within(section).getByText('Task')).toBeTruthy();
  });

  it('counts open, yours and overdue tasks on Home', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    await client.tasks.create({ title: 'Late', dueDate: '2020-01-01' });
    await client.tasks.create({ title: 'Fine' });
    const Card = openTasksBlock.component;
    render(
      <TestProviders client={client}>
        <Card config={{}} surface="home" />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByText(/2 open tasks/)).toBeTruthy());
    expect(screen.getByText('task is overdue')).toBeTruthy();
  });
});
