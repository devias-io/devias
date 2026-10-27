import type { ChatEvent } from '@devias/core';
import { coreIds } from '@devias/core';
import { actorString, EngineError } from '@devias/data-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { type ModelClient, ModelError } from '../src/model/types';
import { text, thinking, toolUse } from '../src/testing';
import { collect, createHarness, eventsOf, type Harness, lastUserText, resolve, send, types } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const newConversation = async (harness: Harness) => (await harness.service.conversations.create(harness.owner, {})).id;

const done = (events: ChatEvent[]) => eventsOf(events, 'done')[0];
const errorCode = (value: unknown) => (value as { error?: { code?: string } } | undefined)?.error?.code;

describe('agent runtime', () => {
  it('streams a text-only reply, persists both messages and releases the lock', async () => {
    h = await createHarness([{ content: [thinking('let me see'), text('Hello there!')] }]);
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'hi');
    expect(types(events).slice(0, 2)).toEqual(['turn_start', 'message_start']);
    expect(
      eventsOf(events, 'thinking_delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('let me see');
    expect(
      eventsOf(events, 'text_delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('Hello there!');
    expect(types(events).at(-1)).toBe('done');
    expect(done(events)?.status).toBe('completed');

    const thread = await h.service.conversations.get(h.owner, id);
    expect(thread.conversation.activeTurnId).toBeNull();
    expect(thread.conversation.title).toBe('hi');
    expect(thread.activeTurn).toBeNull();
    expect(thread.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(thread.messages[1]?.blocks).toEqual([
      { type: 'thinking', text: 'let me see' },
      { type: 'text', text: 'Hello there!' },
    ]);
    expect(thread.conversation.usage.inputTokens).toBe(100);

    // The model saw the frozen system prompt, sorted tools and a context block with the schema digest.
    const request = h.model.requests[0];
    expect(request?.system).toContain('You are an agent built into Devias');
    expect(request?.tools.map((t) => t.name)).toEqual([...(request?.tools.map((t) => t.name) ?? [])].sort());
    expect(request?.tools.some((t) => t.name === 'list_records')).toBe(true);
    const userText = lastUserText(h.model);
    expect(userText).toContain('<context>');
    expect(userText).toContain('user: Alice (owner)');
    expect(userText).toContain('<schema version=');
    expect(userText).toContain('object person');
  });

  it('runs an auto tool, feeds the result back and only re-sends the schema after it changes', async () => {
    h = await createHarness([
      { content: [toolUse('list_objects', {}, 'tu_list')] },
      { content: 'There are 5 objects.' },
      { content: 'Sure.' },
      {
        content: [
          toolUse(
            'create_field',
            { object: 'person', name: 'lead_score', type: 'number', label: 'Lead score' },
            'tu_field',
          ),
        ],
      },
    ]);
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'how many objects?');
    const calls = eventsOf(events, 'tool_call');
    expect(calls.map((c) => c.toolCall.status)).toEqual(['running']);
    const result = eventsOf(events, 'tool_result')[0];
    expect(result?.status).toBe('executed');
    expect(
      ((result?.result as { objects?: { nameSingular: string }[] } | undefined)?.objects ?? [])
        .map((o) => o.nameSingular)
        .sort(),
    ).toEqual(['chore', 'company', 'note', 'opportunity', 'person']);
    expect(done(events)?.status).toBe('completed');
    // second model call carried the tool result
    const second = h.model.requests[1];
    expect(second?.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_list', content: expect.stringContaining('"objects"') }],
    });

    await send(h, h.owner, id, 'thanks');
    expect(lastUserText(h.model)).not.toContain('<schema version=');

    const paused = await send(h, h.owner, id, 'add a lead score');
    const pending = eventsOf(paused, 'paused')[0]?.pending[0];
    expect(pending?.name).toBe('create_field');
    h.model.push({ content: 'Added.' }, { content: 'ok' });
    await resolve(h, h.owner, id, pending?.id ?? '', true);
    await send(h, h.owner, id, 'and now?');
    expect(lastUserText(h.model)).toContain('<schema version=');
    expect(lastUserText(h.model)).toContain('lead_score');
  });

  it('executes auto calls immediately, pauses on a gated one, and blocks a second send with 409', async () => {
    h = await createHarness([
      {
        content: [
          text('Creating Globex and deleting Initech.'),
          toolUse('create_record', { object: 'company', data: { name: 'Globex' } }, 'tu_create'),
          toolUse('delete_records', { object: 'company', ids: ['00000000-0000-0000-0000-000000000001'] }, 'tu_delete'),
        ],
      },
    ]);
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'create Globex, delete Initech');
    expect(types(events).at(-1)).toBe('paused');
    const results = eventsOf(events, 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('executed');
    const created = await h.engine.records.list(h.owner, {
      object: 'company',
      filter: { field: 'name', op: 'eq', value: 'Globex' },
    });
    expect(created.items).toHaveLength(1);

    const paused = eventsOf(events, 'paused')[0];
    expect(paused?.pending.map((p) => [p.name, p.status, p.requiresApproval])).toEqual([
      ['delete_records', 'pending', true],
    ]);
    const thread = await h.service.conversations.get(h.owner, id);
    expect(thread.activeTurn?.status).toBe('awaiting_approval');
    expect(thread.messages[1]?.blocks.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_use']);

    await expect(send(h, h.owner, id, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(h.service.conversations.delete(h.owner, id)).resolves.toBeUndefined();
  });

  it('approves a pending call, runs it and continues the same turn with every result in one message', async () => {
    h = await createHarness([]);
    const company = await h.engine.records.create(h.owner, 'company', { name: 'Initech' });
    h.model.push(
      { content: [toolUse('delete_records', { object: 'company', ids: [company.id] }, 'tu_delete')] },
      { content: 'Initech is gone.' },
    );
    const id = await newConversation(h);
    const first = await send(h, h.owner, id, 'delete Initech');
    const pending = eventsOf(first, 'paused')[0]?.pending[0];
    const events = await resolve(h, h.owner, id, pending?.id ?? '', true);
    expect(types(events)[0]).toBe('turn_start');
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'executed', isError: false });
    expect(done(events)?.status).toBe('completed');
    await expect(h.engine.records.get(h.owner, 'company', company.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.model.requests[1]?.messages.at(-1)?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_delete', content: expect.stringContaining('"deleted":1') },
    ]);
    const thread = await h.service.conversations.get(h.owner, id);
    expect(thread.conversation.activeTurnId).toBeNull();
    expect(thread.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
  });

  it('knows the workflow open in the editor, and runs workflows through the host after approval', async () => {
    const runs: string[] = [];
    h = await createHarness([], {
      workflows: {
        runManual: async (ctx, workflowId) => {
          runs.push(`${actorString(ctx.actor)}:${workflowId}`);
          const at = new Date().toISOString();

          return {
            id: workflowId,
            workflowId,
            status: 'succeeded',
            trigger: { kind: 'manual' },
            steps: [],
            createdAt: at,
            startedAt: at,
            finishedAt: at,
          };
        },
      },
    });
    const workflow = await h.engine.workflows.create(h.owner, {
      title: 'Nightly cleanup',
      trigger: { kind: 'schedule', cron: '0 0 * * *' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'chore', values: { title: 'Review {{today}}' } },
        },
      ],
    });
    h.model.push({ content: 'A nightly cleanup.' }, { content: 'Not found.' });
    const id = await newConversation(h);
    await send(h, h.owner, id, {
      content: 'what is this?',
      context: { page: { path: 'settings', workflowId: workflow.id } },
    });
    expect(lastUserText(h.model)).toContain(`page: /settings, workflow editor for "Nightly cleanup" (${workflow.id})`);
    await send(h, h.owner, id, { content: 'and this?', context: { page: { workflowId: 'gone' } } });
    expect(lastUserText(h.model)).toContain('page: workflow editor for gone');

    // run_workflow asks first; once approved, the host's runner gets the call as the person.
    h.model.push(
      { content: [toolUse('run_workflow', { workflow: 'Nightly cleanup' }, 'tu_run2')] },
      { content: 'It ran.' },
    );
    const paused = await send(h, h.owner, id, 'run it');
    const pending = eventsOf(paused, 'paused')[0]?.pending[0];
    expect(pending?.name).toBe('run_workflow');
    expect(runs).toEqual([]);
    const resumed = await resolve(h, h.owner, id, pending?.id ?? '', true);
    expect(eventsOf(resumed, 'tool_result')[0]).toMatchObject({ status: 'executed', isError: false });
    const { agentId } = (await h.service.conversations.get(h.owner, id)).conversation;
    expect(runs).toEqual([`agent:${agentId}@user:u_owner:${workflow.id}`]);
  });

  it('rejects a pending call with a reason the model sees, and cannot resolve it twice', async () => {
    h = await createHarness([
      {
        content: [
          toolUse('delete_records', { object: 'company', ids: ['00000000-0000-0000-0000-000000000001'] }, 'tu'),
        ],
      },
      { content: 'Understood, leaving it.' },
    ]);
    const id = await newConversation(h);
    const first = await send(h, h.owner, id, 'delete it');
    const pending = eventsOf(first, 'paused')[0]?.pending[0];
    const events = await resolve(h, h.owner, id, pending?.id ?? '', false, 'wrong company');
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'rejected', isError: true });
    expect(lastUserText(h.model)).toContain('The user rejected this action: wrong company');
    expect(done(events)?.status).toBe('completed');
    await expect(
      h.service.startResolve(h.owner, id, pending?.id ?? '', { approved: true }, h.user),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('never runs tools from a max_tokens or refusal reply', async () => {
    h = await createHarness([
      { content: [toolUse('create_record', { object: 'company', data: { name: 'Nope' } })], stopReason: 'max_tokens' },
      { content: [text('')], stopReason: 'refusal' },
    ]);
    const id = await newConversation(h);
    const truncated = await send(h, h.owner, id, 'x');
    expect(eventsOf(truncated, 'tool_call')[0]?.toolCall.status).toBe('declined');
    expect(eventsOf(truncated, 'error')[0]?.code).toBe('MAX_TOKENS');
    expect(done(truncated)).toMatchObject({ status: 'failed', truncated: true });
    const rows = await h.engine.records.list(h.owner, {
      object: 'company',
      filter: { field: 'name', op: 'eq', value: 'Nope' },
    });
    expect(rows.items).toHaveLength(0);

    const id2 = await newConversation(h);
    const refused = await send(h, h.owner, id2, 'y');
    expect(done(refused)).toMatchObject({ status: 'completed', stopReason: 'refusal' });
  });

  it('turns invalid input, unknown tools, engine errors and repeated calls into error results', async () => {
    h = await createHarness([
      {
        content: [
          toolUse('create_record', { object: 'company' }, 'tu_invalid'),
          toolUse('no_such_tool', {}, 'tu_unknown'),
          toolUse('get_record', { object: 'company', id: '00000000-0000-0000-0000-000000000001' }, 'tu_missing'),
        ],
      },
      {
        content: [toolUse('list_objects', {}, 'a'), toolUse('list_objects', {}, 'b'), toolUse('list_objects', {}, 'c')],
      },
      { content: 'ok' },
    ]);
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'go');
    const byId = new Map(eventsOf(events, 'tool_call').map((e) => [e.toolCall.toolUseId, e.toolCall]));
    expect(byId.get('tu_invalid')?.status).toBe('failed');
    expect(errorCode(byId.get('tu_invalid')?.result)).toBe('INVALID_INPUT');
    expect(errorCode(byId.get('tu_unknown')?.result)).toBe('UNKNOWN_TOOL');
    const missing = eventsOf(events, 'tool_result').find((r) => r.toolCallId === byId.get('tu_missing')?.id);
    expect(errorCode(missing?.result)).toBe('NOT_FOUND');
    const repeated = eventsOf(events, 'tool_call').filter((e) => e.toolCall.name === 'list_objects');
    const statuses = await Promise.all(
      repeated.map(async (e) => (await h?.service.store.toolCalls.get(e.toolCall.id))?.status),
    );
    expect(statuses.filter((s) => s === 'executed')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'failed')).toHaveLength(1);
    expect(done(events)?.status).toBe('completed');
  });

  it('cancels a running turn: the model call aborts, the lock is released and the stream ends with cancelled', async () => {
    let release: (() => void) | undefined;
    const blocking: ModelClient = {
      model: 'blocking',
      effort: 'high',
      stream: (request) =>
        new Promise((_resolve, reject) => {
          release = () => reject(new ModelError('ABORTED', 'cancelled', false));
          request.signal?.addEventListener('abort', () => release?.());
        }),
    };
    h = await createHarness([], { model: blocking });
    const id = await newConversation(h);
    const { events, sink } = collect();
    const handle = await h.service.startTurn(h.owner, id, { content: 'slow' }, h.user);
    const running = handle.run(sink);
    await new Promise((r) => setTimeout(r, 20));
    const cancelled = await h.service.cancel(h.owner, id);
    expect(cancelled?.status).toBe('cancelled');
    await running;
    expect(done(events)?.status).toBe('cancelled');
    const thread = await h.service.conversations.get(h.owner, id);
    expect(thread.conversation.activeTurnId).toBeNull();
    expect(await h.service.cancel(h.owner, id)).toBeNull();
  });

  it('stops at the iteration cap and reports it', async () => {
    h = await createHarness(
      Array.from({ length: 5 }, () => ({ content: [toolUse('list_objects', {}), toolUse('list_objects', {})] })),
      { maxIterations: 2 },
    );
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'loop');
    expect(eventsOf(events, 'error')[0]?.code).toBe('ITERATION_LIMIT');
    expect(done(events)?.status).toBe('failed');
    expect(h.model.requests).toHaveLength(2);
  });

  it('hides data-model tools from members and refuses api keys', async () => {
    h = await createHarness([
      { content: [toolUse('create_field', { object: 'person', name: 'x', type: 'text', label: 'X' })] },
      { content: 'ok' },
    ]);
    const status = await h.service.status(h.member);
    expect(status.tools.map((t) => t.name)).not.toContain('create_field');
    expect(status.tools.map((t) => t.name)).toContain('create_record');
    expect(status.canManage).toBe(false);
    const id = (await h.service.conversations.create(h.member, {})).id;
    const events = await send(h, h.member, id, 'add a field');
    expect(errorCode(eventsOf(events, 'tool_call')[0]?.toolCall.result)).toBe('UNKNOWN_TOOL');
    expect(h.model.requests[0]?.tools.map((t) => t.name)).not.toContain('create_field');
    await expect(
      h.service.conversations.list({ workspaceId: h.workspaceId, actor: { kind: 'api_key', id: 'k' }, role: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // conversations are private to their user
    await expect(h.service.conversations.get(h.owner, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an agent loosen how its own tools ask, not the tools that always ask, and only for itself', async () => {
    h = await createHarness([]);
    await expect(
      h.service.agents.create(h.owner, { label: 'Careless', approvalOverrides: { delete_field: 'auto' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // There is no workspace-wide setting for it any more: the tool list shows what each tool does by itself.
    const status = await h.service.status(h.owner);
    expect(status.tools.find((t) => t.name === 'delete_records')).toMatchObject({ approval: 'approve', locked: false });
    expect(status.tools.find((t) => t.name === 'delete_field')).toMatchObject({ approval: 'approve', locked: true });
    expect(await h.service.settings.get(h.owner)).not.toHaveProperty('approvalOverrides');

    const loose = await h.service.agents.create(h.owner, {
      label: 'Cleaner',
      tools: ['delete_records'],
      approvalOverrides: { delete_records: 'auto' },
    });
    const company = await h.engine.records.create(h.owner, 'company', { name: 'Gone' });
    const other = await h.engine.records.create(h.owner, 'company', { name: 'Kept' });
    h.model.push(
      { content: [toolUse('delete_records', { object: 'company', ids: [company.id] }, 'tu_a')] },
      { content: 'done' },
      { content: [toolUse('delete_records', { object: 'company', ids: [other.id] }, 'tu_b')] },
    );
    const own = (await h.service.conversations.create(h.owner, { agentId: loose.id })).id;
    const events = await send(h, h.owner, own, 'delete Gone');
    expect(eventsOf(events, 'paused')).toHaveLength(0);
    expect(done(events)?.status).toBe('completed');

    // The default agent has no override, so the same call waits for the person.
    const id = await newConversation(h);
    expect(eventsOf(await send(h, h.owner, id, 'delete Kept'), 'paused')).toHaveLength(1);
  });

  it('reports model failures and fails turns interrupted by a restart', async () => {
    h = await createHarness([{ content: '', error: new ModelError('RATE_LIMITED', 'slow down', true, 429) }]);
    const id = await newConversation(h);
    const events = await send(h, h.owner, id, 'x');
    expect(eventsOf(events, 'error')[0]).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(done(events)?.status).toBe('failed');

    // simulate a crash: a running turn holding the lock
    const store = h.service.store;
    const turn = await store.turns.insert({
      id: '01900000-0000-7000-8000-000000000001',
      conversationId: id,
      workspaceId: h.workspaceId,
    });
    expect(await store.conversations.claim(id, turn.id)).toBe(true);
    expect(await h.service.recover()).toBe(1);
    expect((await store.turns.get(turn.id))?.status).toBe('failed');
    expect((await store.conversations.get(h.workspaceId, id))?.activeTurnId).toBeNull();
  });

  it('refuses to run when no model is configured but still serves status and settings', async () => {
    h = await createHarness([], { model: null });
    expect((await h.service.status(h.owner)).configured).toBe(false);
    const id = await newConversation(h);
    let error: unknown;

    try {
      await h.service.startTurn(h.owner, id, { content: 'hi' }, h.user);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe('MISSING_DEPENDENCY');
  });
});
