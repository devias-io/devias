import type { Task, TaskActivityEntry, TaskActivityPage, TaskCounts, TaskPage } from '@devias/core';
import { coreIds } from '@devias/core';
import { readEventsAfter } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

describe('tasks API', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    server = await createTestServer();
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    userId = alice.userId;
    api = client(server, { cookie: alice.cookie });
    const workspace = await createWorkspace(api, 'Acme', 'acme');
    workspaceId = workspace.id;
    base = `/api/workspaces/${workspace.id}`;
  });
  afterAll(() => server.close());

  it('creates, reads, changes, comments on and removes a task', async () => {
    const created = await api(`${base}/tasks`, {
      body: { title: 'Call Ana', markdown: 'Ask about **pricing**.', priority: 'high', dueDate: '2026-11-02' },
    });
    expect(created.status).toBe(201);
    const task = created.json as Task;
    expect(task).toMatchObject({
      title: 'Call Ana',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-11-02',
      version: 1,
      markdown: 'Ask about **pricing**.',
    });
    expect(((await api(`${base}/tasks/${task.id}`)).json as Task).id).toBe(task.id);

    const moved = await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { status: 'in_progress' } });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ status: 'in_progress', version: 2 });

    const stale = await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { title: 'x', expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: { code: 'CONFLICT' } });

    const comment = await api(`${base}/tasks/${task.id}/comments`, { body: { markdown: 'On it.' } });
    expect(comment.status).toBe(201);
    expect(comment.json).toMatchObject({ kind: 'comment', body: 'On it.' });

    const timeline = (await api(`${base}/tasks/${task.id}/activity`)).json as TaskActivityPage;
    expect(timeline.items.map((entry: TaskActivityEntry) => entry.kind)).toEqual(['comment', 'changed', 'created']);

    const page = (await api(`${base}/tasks?search=ana&scope=open`)).json as TaskPage;
    expect(page.items.map((item) => item.title)).toEqual(['Call Ana']);
    expect(page.items[0]).not.toHaveProperty('body');

    expect((await api(`${base}/tasks/${task.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`${base}/tasks/${task.id}`)).status).toBe(404);
  });

  it('refuses what is not a task', async () => {
    expect((await api(`${base}/tasks`, { body: {} })).status).toBe(400);
    expect((await api(`${base}/tasks`, { body: { title: 'x', status: 'sleeping' } })).status).toBe(400);
    expect((await api(`${base}/tasks`, { body: { title: 'x', assignee: 'user:nobody' } })).status).toBe(400);
    expect((await api(`${base}/tasks`, { body: { title: 'x', assignee: 'agent:nobody' } })).status).toBe(400);
    expect((await api(`${base}/tasks/not-a-uuid`)).status).toBe(400);
    expect((await api(`${base}/tasks?limit=1000`)).status).toBe(400);
    expect((await api(`${base}/tasks?mentions=nonsense`)).status).toBe(400);
    expect((await client(server)(`${base}/tasks`)).status).toBe(401);
  });

  it('assigns only to people of the workspace and to its agents', async () => {
    const mine = await api(`${base}/tasks`, { body: { title: 'Mine', assignee: `user:${userId}` } });
    expect(mine.status).toBe(201);
    expect((mine.json as Task).assignee).toBe(`user:${userId}`);
    const agents = (await api(`${base}/ai/agents`)).json as { id: string }[];
    const agent = agents[0];

    if (agent) {
      // The seeded agent takes tasks; only an agent that does can be given one.
      await api(`${base}/ai/agents/${agent.id}`, { method: 'PATCH', body: { takesTasks: false } });
      const refused = await api(`${base}/tasks`, { body: { title: 'For the agent', assignee: `agent:${agent.id}` } });
      expect(refused.status).toBe(400);
      await api(`${base}/ai/agents/${agent.id}`, { method: 'PATCH', body: { takesTasks: true } });
      const theirs = await api(`${base}/tasks`, {
        body: { title: 'For the agent', status: 'backlog', assignee: `agent:${agent.id}` },
      });
      expect(theirs.status).toBe(201);
    }

    const page = (await api(`${base}/tasks?assignee=me`)).json as TaskPage;
    expect(page.items.map((item) => item.title)).toContain('Mine');
    expect(((await api(`${base}/tasks/counts`)).json as TaskCounts).mine).toBeGreaterThanOrEqual(1);
  });

  it('lists the tasks that are about a record, by link', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Initech' } })).json as { id: string };
    const task = (
      await api(`${base}/tasks`, {
        body: { title: 'Visit Initech', about: [`record:company/${company.id}`] },
      })
    ).json as Task;
    const found = (await api(`${base}/tasks?mentions=${encodeURIComponent(`record:company/${company.id}`)}`))
      .json as TaskPage;
    expect(found.items.map((item) => item.id)).toEqual([task.id]);
  });

  it('runs as a workflow step, with templates in the title and the text', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Globex' } })).json as { id: string };
    const workflow = (
      await api(`${base}/workflows`, {
        body: {
          title: 'Follow up a visit',
          trigger: { kind: 'manual', objectId: 'company' },
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.create_task,
              input: {
                title: 'Follow up with {{record.name}}',
                markdown: 'Met [{{record.name}}](record:company/{{record.id}}).',
                about: ['record:company/{{record.id}}'],
              },
            },
          ],
        },
      })
    ).json as { id: string };
    const run = await api(`${base}/workflows/${workflow.id}/run`, { body: { recordId: company.id } });
    expect(run.json).toMatchObject({ status: 'succeeded' });
    const found = (await api(`${base}/tasks?mentions=${encodeURIComponent(`record:company/${company.id}`)}`))
      .json as TaskPage;
    const made = found.items.find((item) => item.title === 'Follow up with Globex');
    expect(made?.createdBy).toEqual({ kind: 'workflow', id: workflow.id });
  });

  it('starts workflows from task events, once per event, and the steps act on the task', async () => {
    const make = async (body: Record<string, unknown>) =>
      (await api(`${base}/workflows`, { body })).json as { id: string };
    const closer = await make({
      title: 'Comment on done urgent tasks',
      trigger: {
        kind: 'task_event',
        types: ['status_changed'],
        statuses: ['done'],
        condition: { field: 'priority', op: 'eq', value: 'urgent' },
      },
      steps: [
        {
          id: 'note',
          kind: 'action',
          actionId: coreIds.actions.comment_on_task,
          input: { id: '{{record.id}}', markdown: 'Closed as {{record.status}} ({{event.action}}).' },
        },
        {
          id: 'branch',
          kind: 'branch',
          condition: { field: 'status', op: 'eq', value: 'done' },
          yes: [
            {
              id: 'follow',
              kind: 'action',
              actionId: coreIds.actions.create_task,
              input: { title: 'Follow up: {{record.title}}', key: 'follow:{{record.id}}', about: [] },
            },
          ],
          no: [],
        },
      ],
    });
    const creator = await make({
      title: 'Welcome new tasks',
      trigger: { kind: 'task_event', types: ['created'] },
      steps: [
        {
          id: 'hi',
          kind: 'action',
          actionId: coreIds.actions.comment_on_task,
          input: { id: '{{record.id}}', markdown: 'Seen.' },
        },
      ],
    });
    expect(closer.id).toBeTruthy();
    // The first pass only marks where the workflows start reading the feed.
    await server.workflows.runOnce(workspaceId);
    const task = (await api(`${base}/tasks`, { body: { title: 'Ship it', priority: 'urgent' } })).json as Task;
    expect(await server.workflows.runOnce(workspaceId)).toBe(1);
    await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { priority: 'low' } });
    await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { status: 'in_progress' } });
    expect(await server.workflows.runOnce(workspaceId)).toBe(0);
    await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { priority: 'urgent', status: 'done' } });
    // Its own comment and the follow-up task it makes are the workflow's: they start nothing.
    expect(await server.workflows.runOnce(workspaceId)).toBe(1);
    expect(await server.workflows.runOnce(workspaceId)).toBe(0);

    const timeline = (await api(`${base}/tasks/${task.id}/activity`)).json as TaskActivityPage;
    const comments = timeline.items.filter((entry) => entry.kind === 'comment').map((entry) => entry.body);
    expect(comments).toEqual(['Closed as done (status_changed).', 'Seen.']);
    expect(timeline.items.find((entry) => entry.body?.startsWith('Closed'))?.actor).toEqual({
      kind: 'workflow',
      id: closer.id,
    });
    const followUps = (await api(`${base}/tasks?search=${encodeURIComponent('Follow up: Ship it')}`)).json as TaskPage;
    expect(followUps.items).toHaveLength(1);
    const runs = (await api(`${base}/workflows/${creator.id}/runs`)).json as { items: { trigger: unknown }[] };
    expect(runs.items.length).toBeGreaterThanOrEqual(1);
    expect(runs.items[0]?.trigger).toMatchObject({ kind: 'task_event', taskId: task.id, eventType: 'created' });
  });

  it('refuses task triggers that cannot work', async () => {
    const attempt = (trigger: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      api(`${base}/workflows`, {
        body: {
          title: 'x',
          trigger,
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.comment_on_task,
              input: { id: '{{record.id}}', markdown: 'x' },
            },
          ],
          ...extra,
        },
      });
    expect((await attempt({ kind: 'task_event', types: ['created'], statuses: ['done'] })).status).toBe(400);
    expect(
      (await attempt({ kind: 'task_event', types: ['created'], condition: { field: 'nope', op: 'eq', value: 1 } }))
        .status,
    ).toBe(400);
    expect((await attempt({ kind: 'task_event', types: [] })).status).toBe(400);
    expect((await attempt({ kind: 'task_event', types: ['deleted'] })).status).toBe(400);
    expect((await attempt({ kind: 'task_event', types: ['created'], statuses: [] })).status).toBe(400);
    expect((await attempt({ kind: 'task_event', types: ['created'] })).status).toBe(201);
  });

  it('follows api key grants: tasks need their own', async () => {
    const keyOf = async (permissions?: Record<string, string[]>) => {
      const response = await api(`${base}/api-keys`, { body: { name: 'k', ...(permissions ? { permissions } : {}) } });

      return client(server, { apiKey: (response.json as { key: string }).key });
    };
    const reader = await keyOf();
    expect((await reader(`${base}/tasks`)).status).toBe(403);
    const taskReader = await keyOf({ task: ['read'] });
    expect((await taskReader(`${base}/tasks`)).status).toBe(200);
    expect((await taskReader(`${base}/tasks`, { body: { title: 'No' } })).status).toBe(403);
    const writer = await keyOf({ task: ['*'] });
    const made = await writer(`${base}/tasks`, { body: { title: 'From a key' } });
    expect(made.status).toBe(201);
    expect((made.json as Task).createdBy).toMatchObject({ kind: 'api_key' });
  });

  it('tells the change feed', async () => {
    const before = await readEventsAfter(server.db.db, workspaceId, 0, 1000);
    const task = (await api(`${base}/tasks`, { body: { title: 'Feed' } })).json as Task;
    await api(`${base}/tasks/${task.id}/comments`, { body: { markdown: 'hi' } });
    await api(`${base}/tasks/${task.id}`, { method: 'DELETE' });
    const events = (await readEventsAfter(server.db.db, workspaceId, 0, 1000)).slice(before.length);
    expect(events.map((event) => [event.type, 'action' in event ? event.action : null])).toEqual([
      ['task.changed', 'created'],
      ['task.changed', 'commented'],
      ['task.changed', 'deleted'],
    ]);
  });
});
