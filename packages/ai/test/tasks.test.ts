import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt/system';
import { text, toolUse } from '../src/testing';
import { createHarness, eventsOf, type Harness, lastUserText, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('the agent and tasks', () => {
  it('teaches the tasks tools and the Markdown rules only to agents that have them', () => {
    const tasks = buildSystemPrompt(new Set(['tasks']));
    expect(tasks).toContain('## Tasks');
    expect(tasks).toContain('comment_on_task');
    expect(tasks).toContain('## Writing Markdown');
    expect(tasks).toContain('[Label](task:<id>)');
    expect(tasks).toContain('(member:<userId>)');
    expect(tasks).not.toContain('## How the workspace is organised');
    expect(buildSystemPrompt(new Set(['records']))).not.toContain('## Tasks');
    expect(buildSystemPrompt(new Set(['people']))).not.toContain('## Tasks');
  });

  it('creates, reads, changes, comments on and lists tasks, and asks before deleting one', async () => {
    h = await createHarness();
    const company = await h.engine.records.create(h.owner, 'company', { name: 'Initech' });
    h.model.push(
      {
        content: [
          toolUse(
            'create_task',
            {
              title: 'Call Initech',
              markdown: `Ask about [Initech](record:company/${company.id}) and tell [Ana](member:u_owner).`,
              priority: 'high',
              dueDate: '2026-11-03',
              about: [`record:company/${company.id}`],
            },
            'tu_1',
          ),
        ],
      },
      { content: [toolUse('list_tasks', { mentions: `record:company/${company.id}` }, 'tu_2')] },
      { content: [text('Done.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'add a task to call Initech');
    const [created, listed] = eventsOf(events, 'tool_result');
    expect(created?.status).toBe('executed');
    const task = created?.result as { id: string; link: string; markdown: string; version: number; status: string };
    expect(task.link).toBe(`task:${task.id}`);
    expect(task.status).toBe('todo');
    expect(task.markdown).toContain('(member:u_owner)');
    const found = listed?.result as { tasks: { id: string }[] };
    expect(found.tasks.map((item) => item.id)).toEqual([task.id]);
    const stored = await h.engine.tasks.get(h.owner, task.id);
    expect(stored.createdBy).toMatchObject({ kind: 'agent', onBehalfOf: { id: 'u_owner' } });
    expect(JSON.stringify(stored.body)).toContain('"object":"member"');

    h.model.push(
      { content: [toolUse('update_task', { id: task.id, status: 'in_progress', expectedVersion: 1 }, 'tu_3')] },
      { content: [toolUse('comment_on_task', { id: task.id, markdown: 'Started.' }, 'tu_4')] },
      { content: [toolUse('get_task', { id: task.id }, 'tu_5')] },
      { content: [text('Done.')] },
    );
    const second = await send(h, h.owner, conversation, 'start it and say so');
    const [updated, commented, read] = eventsOf(second, 'tool_result');
    expect([updated?.status, commented?.status]).toEqual(['executed', 'executed']);
    expect(read?.result).toMatchObject({ status: 'in_progress' });
    expect((await h.engine.tasks.activity(h.owner, task.id)).items.map((entry) => entry.kind)).toEqual([
      'comment',
      'changed',
      'created',
    ]);

    h.model.push({ content: [toolUse('delete_task', { id: task.id }, 'tu_6')] });
    const third = await send(h, h.owner, conversation, 'delete it');
    const paused = eventsOf(third, 'paused')[0];
    expect(paused?.pending.map((call) => call.name)).toEqual(['delete_task']);
    expect((await h.engine.tasks.get(h.owner, task.id)).id).toBe(task.id);
    h.model.push({ content: [text('Deleted.')] });
    await resolve(h, h.owner, conversation, paused?.pending[0]?.id ?? '', true);
    await expect(h.engine.tasks.get(h.owner, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a stale expectedVersion with a conflict the model can read', async () => {
    h = await createHarness();
    const task = await h.engine.tasks.create(h.owner, { title: 'Race' });
    await h.engine.tasks.update(h.owner, task.id, { priority: 'low' });
    h.model.push(
      { content: [toolUse('update_task', { id: task.id, status: 'done', expectedVersion: 1 }, 'tu_1')] },
      { content: [text('Conflict.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'finish it');
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'failed' });
  });

  it('reads a linked task and a linked member for the model, as data, and says when a task is gone', async () => {
    h = await createHarness([{ content: [text('Noted.')] }]);
    const task = await h.engine.tasks.create(h.owner, {
      title: 'Ship',
      markdown: 'Before Friday.',
      priority: 'urgent',
    });
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const helper = await h.service.agents.create(h.owner, { label: 'Helper', description: 'Does errands.' });
    await send(
      h,
      h.owner,
      conversation,
      `Summarise [Ship](task:${task.id}), [Gone](task:00000000-0000-4000-8000-000000000009), ask [Ana](member:u_owner) and [Helper](agent:${helper.id}) and [Lost](agent:a-lost).`,
    );
    const seen = lastUserText(h.model);
    expect(seen).toContain(`- task:${task.id}: {`);
    expect(seen).toContain('"markdown":"Before Friday."');
    expect(seen).toContain('"priority":"urgent"');
    expect(seen).toContain('- task:00000000-0000-4000-8000-000000000009: not found, or not readable by the person');
    expect(seen).toContain(
      `- agent:${helper.id}: {"kind":"agent","name":"Helper","description":"Does errands.","takesTasks":false}`,
    );
    expect(seen).toContain('- agent:a-lost: not found, or not readable by the person');
    expect(seen).toContain('- member:u_owner: {"kind":"workspace member","userId":"u_owner"}');
  });

  it('opens a task for the person', async () => {
    h = await createHarness();
    const task = await h.engine.tasks.create(h.owner, { title: 'Look' });
    h.model.push(
      { content: [toolUse('navigate', { target: { kind: 'task', id: task.id } }, 'tu_1')] },
      { content: [text('Opened.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'show me the task');
    expect(eventsOf(events, 'tool_result')[0]?.result).toMatchObject({ ok: true, opened: 'task "Look"' });
    expect(eventsOf(events, 'navigate')[0]).toMatchObject({ target: { kind: 'task', id: task.id } });
  });

  it('hides the tools from people who cannot use them', async () => {
    h = await createHarness();
    const ctx = {
      ...h.owner,
      actor: { kind: 'api_key' as const, id: 'k' },
      role: null,
      apiKeyPermissions: { task: ['read'] },
    };
    const snapshot = await h.engine.metadata.getSnapshot(h.workspaceId);
    const names = h.service.registry.toolsFor(ctx, snapshot).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_tasks', 'get_task']));
    expect(names).not.toContain('create_task');
  });
});
