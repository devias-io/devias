import { actorString, EngineError } from '@devias/data-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { text, toolUse } from '../src/testing';
import { createHarness, eventsOf, type Harness, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const failure = async (promise: Promise<unknown>): Promise<EngineError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EngineError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const NAMES = (agents: { name: string }[]) => agents.map((agent) => agent.name);

describe('agents', () => {
  it('are shaped by owners, listed by everyone, and checked against the tools that exist', async () => {
    h = await createHarness();
    expect((await failure(h.service.agents.create(h.member, { name: 'Nope' }))).code).toBe('FORBIDDEN');
    const unknown = await failure(h.service.agents.create(h.owner, { name: 'Sales', tools: ['list_records', 'fly'] }));
    expect(unknown.code).toBe('VALIDATION');
    expect(unknown.details).toEqual({ unknown: ['fly'] });
    expect((await failure(h.service.agents.create(h.owner, { name: 'Sales', tools: [] }))).code).toBe('VALIDATION');
    const locked = await failure(
      h.service.agents.create(h.owner, { name: 'Sales', approvalOverrides: { delete_field: 'auto' } }),
    );
    expect(locked.code).toBe('VALIDATION');
    expect(locked.details).toEqual({ refused: ['delete_field'] });

    const sales = await h.service.agents.create(h.owner, {
      name: '  Sales  ',
      icon: 'briefcase',
      description: 'Keeps the pipeline tidy',
      instructions: 'Only talk about opportunities.',
      tools: ['list_records', 'delete_records', 'list_records'],
      starterPrompts: ['  list my deals ', 'list my deals', ' '],
      // Kept as given: the agent's modes override the workspace's, defaults included.
      approvalOverrides: { delete_records: 'auto', list_records: 'auto' },
    });
    expect(sales).toMatchObject({
      name: 'Sales',
      icon: 'briefcase',
      tools: ['list_records', 'delete_records'],
      starterPrompts: ['list my deals'],
      approvalOverrides: { delete_records: 'auto', list_records: 'auto' },
      archivedAt: null,
    });
    expect(NAMES(await h.service.agents.list(h.member))).toEqual(['Assistant', 'Sales']);

    const renamed = await h.service.agents.update(h.owner, sales.id, {
      name: 'Pipeline',
      instructions: null,
      tools: null,
    });
    expect(renamed).toMatchObject({ name: 'Pipeline', instructions: null, tools: null, icon: 'briefcase' });
    expect((await failure(h.service.agents.update(h.owner, sales.id, { tools: [] }))).code).toBe('VALIDATION');
    expect((await failure(h.service.agents.update(h.member, sales.id, { name: 'x' }))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.agents.get(h.owner, 'missing'))).code).toBe('NOT_FOUND');
    expect((await failure(h.service.conversations.create(h.owner, { agentId: 'missing' }))).code).toBe('NOT_FOUND');
  });

  it('talks with its instructions and only its tools, and acts under its own id', async () => {
    let companyId = '';
    h = await createHarness([
      () => ({ content: [toolUse('delete_records', { object: 'company', ids: [companyId] }, 'tu_del')] }),
      { content: [text('Gone.')] },
    ]);
    const company = await h.engine.records.create(h.owner, 'company', { name: 'Doomed' });
    companyId = company.id;
    const sales = await h.service.agents.create(h.owner, {
      name: 'Sales',
      description: 'Keeps the pipeline tidy',
      instructions: 'Only talk about opportunities.',
      tools: ['list_records', 'delete_records', 'create_object'],
      // Deleting records usually asks; this agent may do it on its own.
      approvalOverrides: { delete_records: 'auto' },
    });
    const conversation = await h.service.conversations.create(h.owner, { agentId: sales.id });
    expect(conversation.agentId).toBe(sales.id);

    const events = await send(h, h.owner, conversation.id, 'clean up');
    const request = h.model.requests[0];
    expect(request?.instructions).toContain('You are "Sales"');
    expect(request?.instructions).toContain('Purpose: Keeps the pipeline tidy');
    expect(request?.instructions).toContain('Instructions from the workspace:\nOnly talk about opportunities.');
    // Its list as given: the person is an owner, so nothing is taken away.
    expect(request?.tools.map((t) => t.name)).toEqual(['create_object', 'delete_records', 'list_records']);
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'executed', isError: false });
    expect(eventsOf(events, 'paused')).toHaveLength(0);
    expect(eventsOf(events, 'done')[0]?.status).toBe('completed');
    expect((await failure(h.engine.records.get(h.owner, 'company', company.id))).code).toBe('NOT_FOUND');

    // History names the agent, acting for the person.
    const feed = await h.engine.events.list(h.owner, { after: 0 });
    const deletion = feed.find((event) => event.type === 'record.deleted');
    expect(deletion && actorString(deletion.actor)).toBe(`agent:${sales.id}@user:u_owner`);
  });

  it('cannot reach a tool outside its list, and asks where it was told to', async () => {
    h = await createHarness([
      {
        content: [
          toolUse('create_record', { object: 'company', data: { name: 'New' } }, 'tu_create'),
          toolUse('list_records', { object: 'company' }, 'tu_query'),
        ],
      },
      { content: [text('Hm.')] },
    ]);
    const reader = await h.service.agents.create(h.owner, {
      name: 'Reader',
      tools: ['list_records'],
      approvalOverrides: { list_records: 'approve' },
    });
    const conversation = await h.service.conversations.create(h.owner, { agentId: reader.id });
    const events = await send(h, h.owner, conversation.id, 'add one');
    expect(h.model.requests[0]?.tools.map((t) => t.name)).toEqual(['list_records']);
    const calls = eventsOf(events, 'tool_call');
    expect(calls.map((c) => [c.toolCall.name, c.toolCall.status])).toEqual([
      ['create_record', 'failed'],
      ['list_records', 'pending'],
    ]);
    const failed = eventsOf(events, 'tool_result')[0];
    expect(failed?.result).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } });
    expect(eventsOf(events, 'paused')[0]?.pending.map((call) => call.name)).toEqual(['list_records']);
  });

  it("gives a member's agent what the member has, however many tools the agent lists", async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    const conversation = await h.service.conversations.create(h.member, {});
    await send(h, h.member, conversation.id, 'hello');
    const names = h.model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(names).toContain('list_records');
    expect(names).not.toContain('create_object');
    expect(names).not.toContain('create_workflow');
  });
});

describe('the seeded agent', () => {
  it('is created once, with every tool, and is the default', async () => {
    h = await createHarness();
    const lists = await Promise.all([h.service.agents.list(h.owner), h.service.agents.list(h.member)]);

    for (const list of lists) {
      expect(NAMES(list)).toEqual(['Assistant']);
    }

    const [general] = lists[0] ?? [];
    expect(general).toMatchObject({ icon: 'avatar-1', takesTasks: true, tools: null, archivedAt: null });
    expect(general?.starterPrompts.length).toBeGreaterThan(0);
    expect((await h.service.settings.get(h.owner)).defaultAgentId).toBe(general?.id);
    expect((await h.service.conversations.create(h.owner)).agentId).toBe(general?.id);
    expect((await h.service.status(h.owner)).tools.length).toBeGreaterThan(5);
  });

  it('never comes back once every agent is archived', async () => {
    h = await createHarness();
    const [general] = await h.service.agents.list(h.owner);
    await h.service.agents.delete(h.owner, general?.id ?? '');
    expect(await h.service.agents.list(h.owner)).toEqual([]);
    expect(NAMES(await h.service.agents.list(h.owner, { includeArchived: true }))).toEqual(['Assistant']);
    expect((await failure(h.service.conversations.create(h.owner))).code).toBe('NOT_FOUND');
    expect((await h.service.settings.get(h.owner)).defaultAgentId).toBeNull();
  });
});

describe('agent usage', () => {
  it("counts everyone's conversations and the tokens they used, per agent, for people who manage agents", async () => {
    h = await createHarness([{ content: [text('One.')] }, { content: [text('Two.')] }, { content: [text('Three.')] }]);
    const sales = await h.service.agents.create(h.owner, { name: 'Sales', tools: ['list_records'] });
    const [general] = await h.service.agents.list(h.owner);
    // The owner has two conversations with Sales and the member one with the general agent; one with Sales is empty.
    const mine = await h.service.conversations.create(h.owner, { agentId: sales.id });
    await send(h, h.owner, mine.id, 'hello');
    await h.service.conversations.create(h.owner, { agentId: sales.id });
    const theirs = await h.service.conversations.create(h.member, { agentId: general?.id ?? '' });
    await send(h, h.member, theirs.id, 'hi');

    const usage = await h.service.agents.usage(h.owner);
    const of = (id: string | undefined) => usage.find((row) => row.agentId === id);
    expect(of(sales.id)).toMatchObject({ conversations: 2 });
    expect(of(general?.id)).toMatchObject({ conversations: 1 });
    expect(of(sales.id)?.usage.inputTokens).toBeGreaterThan(0);
    expect(of(sales.id)?.lastMessageAt).not.toBeNull();
    // An agent nobody talked to still has a row, and archived agents keep theirs.
    const idle = await h.service.agents.create(h.owner, { name: 'Idle' });
    await h.service.agents.delete(h.owner, sales.id);
    const after = await h.service.agents.usage(h.owner);
    expect(after.find((row) => row.agentId === idle.id)).toMatchObject({ conversations: 0, lastMessageAt: null });
    expect(after.find((row) => row.agentId === sales.id)).toMatchObject({ conversations: 2 });
    expect((await failure(h.service.agents.usage(h.member))).code).toBe('FORBIDDEN');
  });
});

describe('agent activity', () => {
  it("counts one agent's replies, tokens and new conversations per day, in the person's time zone", async () => {
    h = await createHarness([{ content: [text('One.')] }, { content: [text('Two.')] }, { content: [text('Three.')] }]);
    const sales = await h.service.agents.create(h.owner, { name: 'Sales', tools: ['list_records'] });
    const other = await h.service.agents.create(h.owner, { name: 'Other', tools: ['list_records'] });
    const first = await h.service.conversations.create(h.owner, { agentId: sales.id });
    await send(h, h.owner, first.id, 'hello');
    await send(h, h.owner, first.id, 'and again');
    const second = await h.service.conversations.create(h.member, { agentId: sales.id });
    await send(h, h.member, second.id, 'hi');
    const elsewhere = await h.service.conversations.create(h.owner, { agentId: other.id });
    await send(h, h.owner, elsewhere.id, 'not counted');

    const { days } = await h.service.agents.activity(h.owner, sales.id, { days: 7 });
    expect(days).toHaveLength(7);
    const today = days.at(-1);
    // Everyone's conversations with this agent only: two started and three replies, today.
    expect(today).toMatchObject({ conversations: 2, messages: 3 });
    expect(today?.inputTokens).toBeGreaterThan(0);
    expect(today?.outputTokens).toBeGreaterThan(0);
    expect(
      days.slice(0, -1).every((day) => day.messages === 0 && day.conversations === 0 && day.inputTokens === 0),
    ).toBe(true);
    // Days run oldest first, end today and are dates.
    expect(days.map((day) => day.date)).toEqual([...days.map((day) => day.date)].sort());
    // A time zone far enough ahead may put the same moment on another calendar day, but the totals stay.
    const ahead = await h.service.agents.activity(h.owner, sales.id, { days: 7, tz: 'Pacific/Kiritimati' });
    expect(ahead.days.reduce((sum, day) => sum + day.messages, 0)).toBe(3);

    expect((await failure(h.service.agents.activity(h.member, sales.id))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.agents.activity(h.owner, 'missing'))).code).toBe('NOT_FOUND');
    expect((await failure(h.service.agents.activity(h.owner, sales.id, { tz: 'Mars/Olympus' }))).code).toBe(
      'VALIDATION',
    );
  });
});

describe('archiving', () => {
  it('stops new conversations and messages, keeps the thread readable, and can be undone', async () => {
    h = await createHarness([{ content: [text('Hi.')] }, { content: [text('Back.')] }]);
    const sales = await h.service.agents.create(h.owner, { name: 'Sales', tools: ['list_records'] });
    const conversation = await h.service.conversations.create(h.owner, { agentId: sales.id });
    await send(h, h.owner, conversation.id, 'hello');

    await h.service.agents.delete(h.owner, sales.id);
    expect(NAMES(await h.service.agents.list(h.owner))).toEqual(['Assistant']);
    expect(NAMES(await h.service.agents.list(h.owner, { includeArchived: true }))).toEqual(['Assistant', 'Sales']);
    expect((await h.service.agents.get(h.owner, sales.id)).archivedAt).not.toBeNull();
    expect((await failure(h.service.conversations.create(h.owner, { agentId: sales.id }))).code).toBe('CONFLICT');
    const before = (await h.service.conversations.get(h.owner, conversation.id)).messages.length;
    expect((await failure(send(h, h.owner, conversation.id, 'still there?'))).code).toBe('CONFLICT');
    // Nothing was stored for the refused message, and the conversation is free again.
    const thread = await h.service.conversations.get(h.owner, conversation.id);
    expect(thread.messages).toHaveLength(before);
    expect(thread.conversation).toMatchObject({ agentId: sales.id, activeTurnId: null });

    const restored = await h.service.agents.update(h.owner, sales.id, { archived: false });
    expect(restored.archivedAt).toBeNull();
    await send(h, h.owner, conversation.id, 'back?');
    expect(h.model.requests[1]?.tools.map((t) => t.name)).toEqual(['list_records']);
  });

  it('clears the default agent, and a default must be active', async () => {
    h = await createHarness();
    const [general] = await h.service.agents.list(h.owner);
    const sales = await h.service.agents.create(h.owner, { name: 'Sales' });
    await h.service.settings.update(h.owner, { defaultAgentId: sales.id });
    expect((await h.service.conversations.create(h.owner)).agentId).toBe(sales.id);

    await h.service.agents.delete(h.owner, sales.id);
    expect((await h.service.settings.get(h.owner)).defaultAgentId).toBeNull();
    // Without a choice, the first active agent by name is the default.
    expect((await h.service.conversations.create(h.owner)).agentId).toBe(general?.id);
    expect((await failure(h.service.settings.update(h.owner, { defaultAgentId: sales.id }))).code).toBe('CONFLICT');
    expect((await failure(h.service.settings.update(h.owner, { defaultAgentId: 'missing' }))).code).toBe('NOT_FOUND');
    expect((await failure(h.service.settings.update(h.member, { defaultAgentId: null }))).code).toBe('FORBIDDEN');
    expect((await h.service.settings.update(h.owner, { defaultAgentId: null })).defaultAgentId).toBeNull();
  });

  it('lets an approval already waiting on the agent finish', async () => {
    h = await createHarness([
      { content: [toolUse('create_record', { object: 'company', data: { name: 'Held' } }, 'tu_create')] },
      { content: [text('Done.')] },
    ]);
    const sales = await h.service.agents.create(h.owner, {
      name: 'Sales',
      tools: ['create_record'],
      approvalOverrides: { create_record: 'approve' },
    });
    const conversation = await h.service.conversations.create(h.owner, { agentId: sales.id });
    const sent = await send(h, h.owner, conversation.id, 'add one');
    const paused = eventsOf(sent, 'paused')[0];
    const pending = paused?.pending[0];
    expect(pending).toBeDefined();

    await h.service.agents.delete(h.owner, sales.id);
    const events = await resolve(h, h.owner, conversation.id, pending?.id ?? '', true);
    expect(eventsOf(events, 'done')[0]?.status).toBe('completed');
  });
});
