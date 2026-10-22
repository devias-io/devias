import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import type { Task, TaskRun } from '@devias/core';
import { systemContext } from '@devias/data-engine';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents, type Session, signUp } from './helpers';

/** An agent given a task works it on its own, for the person who gave it, and hands it in for review. */
describe('agents working tasks', () => {
  let server: Server;
  let alice: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;
  let agentId: string;
  const model = createFakeModelClient([], { delayMs: 0 });

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [crm], builtin: [crmManifest], pgliteDataDir: 'memory://', modelClient: model },
    );
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}`;
    agentId = ((await api(`${base}/ai/agents`, { body: { name: 'Sales', takesTasks: true } })).json as { id: string })
      .id;
  });
  afterAll(() => server.close());

  /** Run the runner until `done` holds: the turns run in the background. */
  const until = async (done: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i += 1) {
      await server.agentRunner.runOnce(ws.id);

      if (await done()) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const tasks = (await api(`${base}/tasks`)).json as { items: Task[] };
    throw new Error(
      `the agent did not get there: ${JSON.stringify(tasks.items.map((t) => [t.title, t.status, t.work]))} ${JSON.stringify(model.requests.map((r) => r.messages.length))}`,
    );
  };
  const taskOf = async (id: string) => (await api(`${base}/tasks/${id}`)).json as Task;
  const runsOf = async (id: string) => ((await api(`${base}/tasks/${id}/runs`)).json as { items: TaskRun[] }).items;
  const resolve = async (conversationId: string, approved: boolean) => {
    const thread = (await api(`${base}/ai/conversations/${conversationId}`)).json as {
      messages: { blocks: { type: string; toolCall?: { id: string; status: string } }[] }[];
    };
    const pending = thread.messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === 'tool_use' && block.toolCall?.status === 'pending')?.toolCall;
    const response = await server.app.request(
      `${base}/ai/conversations/${conversationId}/tool-calls/${pending?.id}/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ approved }),
      },
    );

    return readChatEvents(response);
  };

  it('offers only agents that take tasks as assignees', async () => {
    const quiet = ((await api(`${base}/ai/agents`, { body: { name: 'Quiet' } })).json as { id: string }).id;
    expect((await api(`${base}/tasks`, { body: { title: 'x', assignee: `agent:${quiet}` } })).status).toBe(400);
    expect(
      (await api(`${base}/tasks`, { body: { title: 'y', assignee: `agent:${agentId}`, status: 'backlog' } })).status,
    ).toBe(201);
  });

  it('works a task: proposes what changes data, waits for approval, then hands the task in', async () => {
    const task = (
      await api(`${base}/tasks`, {
        body: { title: 'Add Initech', markdown: 'Create the company.', assignee: `agent:${agentId}` },
      })
    ).json as Task;
    // The first turn proposes a record; the second finishes after approval.
    model.push(
      { content: [toolUse('create_record', { object: 'company', data: { name: 'Initech' } }, 'tu_1')] },
      { content: [toolUse('finish_task', { summary: 'Created the company Initech.' }, 'tu_2')] },
      { content: [text('Handed in.')] },
    );
    await until(async () => (await taskOf(task.id)).work === 'waiting_on_you');
    const [run] = await runsOf(task.id);
    expect(run).toMatchObject({ status: 'awaiting_review', attempt: 1, requestedBy: alice.userId, agentId });
    expect(await taskOf(task.id)).toMatchObject({ status: 'in_progress', runId: run?.id });
    // Nothing was written before the person approved.
    const before = (
      await api(`${base}/records/company/list`, { body: { filter: { field: 'name', op: 'eq', value: 'Initech' } } })
    ).json as {
      items: unknown[];
    };
    expect(before.items).toHaveLength(0);

    await resolve(run?.conversationId as string, true);
    await until(async () => (await taskOf(task.id)).status === 'in_review');
    await until(async () => (await runsOf(task.id))[0]?.status === 'completed');
    expect(await taskOf(task.id)).toMatchObject({ status: 'in_review', work: null, runId: null });
    const made = (
      await api(`${base}/records/company/list`, { body: { filter: { field: 'name', op: 'eq', value: 'Initech' } } })
    ).json as { items: { created_by: string }[] };
    expect(made.items).toHaveLength(1);
    expect(made.items[0]?.created_by).toBe(`agent:${agentId}@user:${alice.userId}`);
    const timeline = (await api(`${base}/tasks/${task.id}/activity`)).json as {
      items: { kind: string; body: string | null; cause: { runId: string } | null }[];
    };
    expect(timeline.items.find((entry) => entry.kind === 'run' && entry.body)).toMatchObject({
      body: 'Created the company Initech.',
      cause: { runId: run?.id },
    });
  });

  it('can be stopped, and retried', async () => {
    const task = (await api(`${base}/tasks`, { body: { title: 'Stop me', assignee: `agent:${agentId}` } }))
      .json as Task;
    model.push({ content: [toolUse('create_record', { object: 'company', data: { name: 'Stopped Ltd' } }, 'tu_3')] });
    await until(async () => (await taskOf(task.id)).work === 'waiting_on_you');
    const stopped = await api(`${base}/tasks/${task.id}/stop`, { body: {} });
    expect(stopped.status).toBe(200);
    expect(stopped.json).toMatchObject({ work: 'failed', runId: null });
    await until(async () => (await runsOf(task.id))[0]?.status === 'cancelled');
    // Failed tasks wait for a person.
    await server.agentRunner.runOnce(ws.id);
    expect(await taskOf(task.id)).toMatchObject({ work: 'failed' });

    model.push({ content: [text('Nothing to do here.')] });
    expect((await api(`${base}/tasks/${task.id}/retry`, { body: {} })).status).toBe(200);
    await until(async () => (await taskOf(task.id)).status === 'in_review');
    const runs = await runsOf(task.id);
    expect(runs).toHaveLength(2);
    // The agent said something and stopped without calling finish_task: the task still goes to review.
    expect(runs[0]).toMatchObject({ status: 'completed', summary: 'Nothing to do here.' });
  });

  it('fails a task that nobody who could lend authority gave the agent', async () => {
    const task = await server.engine.tasks.create(systemContext(ws.id, 'seed'), {
      title: 'From the system',
      assignee: `agent:${agentId}`,
    });
    await until(async () => (await taskOf(task.id)).work === 'failed');
    const timeline = (await api(`${base}/tasks/${task.id}/activity`)).json as { items: { body: string | null }[] };
    expect(timeline.items.some((entry) => entry.body?.includes('no person for the agent to act for'))).toBe(true);
    expect(await runsOf(task.id)).toHaveLength(0);
  });
});
