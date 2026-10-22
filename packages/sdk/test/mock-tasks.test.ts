import type { WorkspaceEvent } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient } from '../src/mock';

const mock = () => createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mock tasks', () => {
  it('creates, changes and removes tasks like the server, and tells the feed', async () => {
    const client = mock();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const task = await client.tasks.create({ title: '  Call Ana  ', markdown: 'Ask about **pricing**.' });
    expect(task).toMatchObject({
      title: 'Call Ana',
      status: 'todo',
      priority: 'none',
      version: 1,
      markdown: 'Ask about **pricing**.',
      subtasks: { total: 0, open: 0 },
    });
    expect(await client.tasks.get(task.id)).toEqual(task);

    const moved = await client.tasks.update(task.id, { status: 'in_progress', assignee: 'agent:a1', priority: 'high' });
    expect(moved).toMatchObject({ status: 'in_progress', assignee: 'agent:a1', priority: 'high', version: 2 });
    expect((await client.tasks.update(task.id, { priority: 'high' })).version).toBe(2);
    expect((await failure(client.tasks.update(task.id, { title: 'x', expectedVersion: 1 }))).code).toBe('CONFLICT');
    expect((await failure(client.tasks.update(task.id, {}))).code).toBe('VALIDATION');

    const done = await client.tasks.update(task.id, { status: 'done' });
    expect(done.closedAt).not.toBeNull();
    await client.tasks.delete(task.id);
    expect((await failure(client.tasks.get(task.id))).code).toBe('NOT_FOUND');
    await flush();
    expect(
      events.filter((event) => event.type === 'task.changed').map((event) => (event as { action: string }).action),
    ).toEqual(['created', 'updated', 'status_changed', 'assigned', 'updated', 'status_changed', 'deleted']);
  });

  it('keeps a timeline of changes and comments, newest first, with paging', async () => {
    const client = mock();
    const task = await client.tasks.create({ title: 'Talk' });
    await client.tasks.update(task.id, { priority: 'urgent' });
    await client.tasks.comment(task.id, { markdown: 'One' });
    await client.tasks.comment(task.id, { markdown: 'Two' });
    expect((await failure(client.tasks.comment(task.id, { markdown: '  ' }))).code).toBe('VALIDATION');
    const first = await client.tasks.activity(task.id, { limit: 2 });
    expect(first.items.map((entry) => entry.body ?? entry.kind)).toEqual(['Two', 'One']);
    const second = await client.tasks.activity(task.id, { limit: 2, cursor: first.nextCursor as string });
    expect(second.items.map((entry) => entry.kind)).toEqual(['changed', 'created']);
    expect(second.nextCursor).toBeNull();
    expect((await client.tasks.get(task.id)).version).toBe(2);
  });

  it('nests subtasks, refuses cycles and removes a branch together', async () => {
    const client = mock();
    const root = await client.tasks.create({ title: 'Root' });
    const child = await client.tasks.create({ title: 'Child', parent: root.id });
    const grand = await client.tasks.create({ title: 'Grand', parent: child.id });
    const deepest = await client.tasks.create({ title: 'Deepest', parent: grand.id });
    expect((await failure(client.tasks.create({ title: 'Too deep', parent: deepest.id }))).code).toBe('VALIDATION');
    expect((await failure(client.tasks.update(root.id, { parent: grand.id }))).code).toBe('VALIDATION');
    expect((await client.tasks.get(root.id)).subtasks).toEqual({ total: 1, open: 1 });
    expect((await client.tasks.list({ parent: root.id })).items.map((item) => item.title)).toEqual(['Child']);
    await client.tasks.delete(root.id);
    expect((await client.tasks.list()).total).toBe(0);
  });

  it('makes one task for one key', async () => {
    const client = mock();
    const first = await client.tasks.create({ title: 'Once', key: 'k1' });
    expect((await client.tasks.create({ title: 'Twice', key: 'k1' })).id).toBe(first.id);
  });

  it('filters, sorts and pages like the server', async () => {
    const client = mock();
    await client.tasks.create({ title: 'Alpha', priority: 'high', dueDate: '2026-10-20', assignee: 'user:me' });
    await client.tasks.create({ title: 'Bravo', priority: 'urgent', dueDate: '2026-10-22', assignee: 'agent:a1' });
    await client.tasks.create({ title: 'Charlie', priority: 'low', dueDate: '2026-10-25' });
    await client.tasks.create({ title: 'Delta', status: 'done', markdown: 'needle' });
    const titles = async (query = {}) => (await client.tasks.list(query)).items.map((item) => item.title);
    const today = '2026-10-22';
    expect(await titles({ scope: 'open', sort: 'title' })).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(await titles({ search: 'needle' })).toEqual(['Delta']);
    expect(await titles({ assignee: 'agents' })).toEqual(['Bravo']);
    expect(await titles({ assignee: 'unassigned', sort: 'title' })).toEqual(['Charlie', 'Delta']);
    expect(await titles({ due: 'overdue', today })).toEqual(['Alpha']);
    expect(await titles({ due: 'week', today, sort: 'due' })).toEqual(['Bravo', 'Charlie']);
    expect(await titles({ sort: 'priority' })).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
    expect(await titles({ sort: 'due', order: 'desc', scope: 'open' })).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect((await failure(client.tasks.list({ status: 'sleeping' }))).code).toBe('VALIDATION');

    for (const sort of ['updated', 'due', 'priority', 'closed', 'title'] as const) {
      for (const order of ['asc', 'desc'] as const) {
        const everything = await titles({ sort, order, limit: 100 });
        const paged: string[] = [];
        let cursor: string | undefined;

        for (let guard = 0; guard < 6; guard += 1) {
          const page = await client.tasks.list({ sort, order, limit: 3, ...(cursor ? { cursor } : {}) });
          paged.push(...page.items.map((item) => item.title));

          if (!page.nextCursor) {
            break;
          }

          cursor = page.nextCursor;
        }

        expect(paged, `${sort} ${order}`).toEqual(everything);
      }
    }

    expect(await client.tasks.counts({ today })).toMatchObject({ open: 3, overdue: 1, dueToday: 1, dueThisWeek: 2 });
  });

  it('indexes what a task mentions and is about', async () => {
    const client = mock();
    const deal = await client.records.create('opportunity', { name: 'Big deal', amount: 1 });
    const doc = await client.documents.create({ title: 'Brief' });
    const task = await client.tasks.create({
      title: 'Follow up',
      markdown: `See [the deal](record:opportunity/${deal.id}), [the brief](document:${doc.id}) and [Ana](member:u1).`,
      about: [`record:opportunity/${deal.id}`],
    });
    expect(task.links).toEqual(
      expect.arrayContaining([
        { link: `record:opportunity/${deal.id}`, role: 'mention' },
        { link: `record:opportunity/${deal.id}`, role: 'about' },
        { link: `document:${doc.id}`, role: 'mention' },
      ]),
    );
    expect(task.links.some((link) => link.link.startsWith('member:'))).toBe(false);
    expect((await client.tasks.list({ mentions: `document:${doc.id}` })).total).toBe(1);
    await client.tasks.update(task.id, { markdown: 'Plain.' });
    expect((await client.tasks.list({ mentions: `document:${doc.id}` })).total).toBe(0);
    expect((await client.tasks.list({ mentions: `record:opportunity/${deal.id}` })).total).toBe(1);
  });

  it('starts task_event workflows once per event, ignoring what automations do', async () => {
    const client = mock();
    await client.workflows.create({
      title: 'Close notes',
      trigger: {
        kind: 'task_event',
        types: ['status_changed'],
        statuses: ['done'],
        condition: { field: 'priority', op: 'eq', value: 'urgent' },
      },
      steps: [
        {
          kind: 'action',
          actionId: 'core.comment_on_task',
          input: { id: '{{record.id}}', markdown: 'Closed as {{record.status}} ({{event.action}}).' },
        },
        {
          kind: 'branch',
          condition: { field: 'status', op: 'eq', value: 'done' },
          yes: [
            {
              kind: 'action',
              actionId: 'core.create_task',
              input: { title: 'Follow up: {{record.title}}', key: 'follow:{{record.id}}' },
            },
          ],
          no: [],
        },
      ],
    });
    const task = await client.tasks.create({ title: 'Ship it', priority: 'urgent' });
    await client.tasks.update(task.id, { status: 'in_progress' });
    await client.tasks.update(task.id, { status: 'done' });
    await flush();
    const timeline = await client.tasks.activity(task.id);
    expect(timeline.items.filter((entry) => entry.kind === 'comment').map((entry) => entry.body)).toEqual([
      'Closed as done (status_changed).',
    ]);
    expect((await client.tasks.list({ search: 'Follow up: Ship it' })).total).toBe(1);
    const runs = await client.workflows.runs((await client.workflows.list())[0]?.id as string);
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]?.trigger).toMatchObject({ kind: 'task_event', taskId: task.id, eventType: 'status_changed' });
    expect(
      (
        await failure(
          client.workflows.create({
            title: 'Bad',
            trigger: { kind: 'task_event', types: ['created'], statuses: ['done'] },
            steps: [
              { kind: 'action', actionId: 'core.comment_on_task', input: { id: '{{record.id}}', markdown: 'x' } },
            ],
          }),
        )
      ).code,
    ).toBe('VALIDATION');
  });
});
