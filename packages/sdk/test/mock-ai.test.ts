import { type ChatEvent, defineModule } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { demoClient } from './demo-data';

const run = async (handle: { done: Promise<void> }, events: ChatEvent[]) => {
  await handle.done;

  return events;
};

describe('mock agent', () => {
  it('starts with one general agent, keeps agents in memory and starts conversations with them', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const [general] = await client.ai.agents.list();
    expect(general).toMatchObject({
      name: 'Assistant',
      icon: 'avatar-1',
      takesTasks: true,
      tools: null,
      archivedAt: null,
    });
    expect((await client.ai.settings.get()).defaultAgentId).toBe(general?.id);
    expect((await client.ai.conversations.create({})).agentId).toBe(general?.id);

    await expect(client.ai.agents.create({ name: 'Sales', tools: ['fly'] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(client.ai.agents.create({ name: 'Sales', tools: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
    const sales = await client.ai.agents.create({
      name: ' Sales ',
      description: 'Pipeline only',
      tools: ['list_records'],
      starterPrompts: [' list deals ', 'list deals'],
    });
    expect(sales).toMatchObject({ name: 'Sales', tools: ['list_records'], starterPrompts: ['list deals'] });
    expect((await client.ai.agents.list()).map((a) => a.name)).toEqual(['Assistant', 'Sales']);
    await expect(client.ai.conversations.create({ agentId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const conversation = await client.ai.conversations.create({ agentId: sales.id });
    expect(conversation.agentId).toBe(sales.id);
    expect((await client.ai.agents.update(sales.id, { name: 'Pipeline', tools: null })).tools).toBeNull();
  });

  it('archives agents instead of deleting them, and restores them', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const sales = await client.ai.agents.create({ name: 'Sales' });
    await client.ai.settings.update({ defaultAgentId: sales.id });
    const conversation = await client.ai.conversations.create({});
    expect(conversation.agentId).toBe(sales.id);

    await client.ai.agents.delete(sales.id);
    expect((await client.ai.agents.list()).map((a) => a.name)).toEqual(['Assistant']);
    expect((await client.ai.agents.list({ includeArchived: true })).map((a) => a.name)).toEqual(['Assistant', 'Sales']);
    expect((await client.ai.settings.get()).defaultAgentId).toBeNull();
    expect((await client.ai.conversations.get(conversation.id)).conversation.agentId).toBe(sales.id);
    expect(() => client.ai.send(conversation.id, { content: 'hi' }, () => {})).toThrow(/archived/);
    await expect(client.ai.conversations.create({ agentId: sales.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(client.ai.settings.update({ defaultAgentId: sales.id })).rejects.toMatchObject({ code: 'CONFLICT' });

    const restored = await client.ai.agents.update(sales.id, { archived: false });
    expect(restored.archivedAt).toBeNull();
    expect((await client.ai.agents.list()).map((a) => a.name)).toEqual(['Assistant', 'Sales']);
  });

  it('asks a question and carries the answer back as the call result', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const conversation = await client.ai.conversations.create({});
    const events: ChatEvent[] = [];
    await run(
      client.ai.send(conversation.id, { content: 'ask me something' }, (e) => events.push(e)),
      events,
    );
    const paused = events.at(-1);
    const call = paused?.type === 'paused' ? paused.pending[0] : undefined;
    expect(call).toMatchObject({ name: 'ask_user', inputRequest: { question: { other: true } } });
    // An answer is checked before anything changes, so it can be sent again.
    expect(() => client.ai.resolve(conversation.id, call?.id ?? '', { approved: true }, () => {})).toThrow(
      /answer is required/,
    );
    const resolved: ChatEvent[] = [];
    await run(
      client.ai.resolve(conversation.id, call?.id ?? '', { approved: true, values: { answer: 'Sales' } }, (e) =>
        resolved.push(e),
      ),
      resolved,
    );
    expect(resolved.find((e) => e.type === 'tool_result')).toMatchObject({
      status: 'executed',
      result: { answer: 'Sales' },
    });
  });

  it('counts conversations and tokens per agent', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const [general] = await client.ai.agents.list();
    const sales = await client.ai.agents.create({ name: 'Sales' });
    const conversation = await client.ai.conversations.create({ agentId: sales.id });
    await client.ai.conversations.create({ agentId: sales.id });
    await client.ai.send(conversation.id, { content: 'how many companies?' }, () => {}).done;
    const usage = await client.ai.agents.usage();
    expect(usage.find((row) => row.agentId === sales.id)).toMatchObject({ conversations: 2 });
    expect(usage.find((row) => row.agentId === sales.id)?.usage.inputTokens).toBeGreaterThan(0);
    expect(usage.find((row) => row.agentId === general?.id)).toMatchObject({ conversations: 0, lastMessageAt: null });
  });

  it("reports an agent's replies and tokens per day, today last", async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const sales = await client.ai.agents.create({ name: 'Sales' });
    const conversation = await client.ai.conversations.create({ agentId: sales.id });
    await client.ai.send(conversation.id, { content: 'how many companies?' }, () => {}).done;
    const { days } = await client.ai.agents.activity(sales.id, { days: 7 });
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ conversations: 1, messages: 1 });
    expect(days.at(-1)?.inputTokens).toBeGreaterThan(0);
    expect(days.slice(0, -1).every((day) => day.messages === 0)).toBe(true);
    await expect(client.ai.agents.activity('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(client.ai.agents.activity(sales.id, { tz: 'Mars/Olympus' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('gives the workspace the agents its modules ship, and takes them away with the module', async () => {
    const lab = defineModule({
      id: 'lab',
      version: '0.1.0',
      agents: [{ id: 'lab.analyst', name: 'Analyst', actionIds: ['core.list_records'], instructions: 'Read.' }],
    });
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture, lab], ai: { latency: 0 } });
    const analyst = (await client.ai.agents.list()).find((agent) => agent.name === 'Analyst');
    expect(analyst).toMatchObject({ moduleId: 'lab', id: 'lab.analyst', tools: ['list_records'] });
    // The module owns what it wrote; the workspace may still archive it.
    await expect(client.ai.agents.update(analyst?.id ?? '', { name: 'Mine' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(
      (await client.ai.agents.update(analyst?.id ?? '', { approvalOverrides: { list_records: 'approve' } }))
        .approvalOverrides,
    ).toEqual({
      list_records: 'approve',
    });

    await client.modules.uninstall('lab');
    expect((await client.ai.agents.list()).map((agent) => agent.name)).not.toContain('Analyst');
    await expect(client.ai.agents.update(analyst?.id ?? '', { archived: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await client.modules.apply(lab);
    expect((await client.ai.agents.list()).find((agent) => agent.name === 'Analyst')).toMatchObject({
      id: analyst?.id,
      archivedAt: null,
    });
  });

  it('answers counts, navigates, and deletes only after approval', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    expect((await client.ai.status()).configured).toBe(true);
    const conversation = await client.ai.conversations.create({});

    const counted: ChatEvent[] = [];
    await run(
      client.ai.send(conversation.id, { content: 'how many companies?' }, (e) => counted.push(e)),
      counted,
    );
    const total = (await client.records.list({ object: 'company', limit: 1, count: true })).totalCount ?? 0;
    const textOf = (events: ChatEvent[]) =>
      events
        .filter((e): e is Extract<ChatEvent, { type: 'text_delta' }> => e.type === 'text_delta')
        .map((e) => e.text)
        .join('');
    expect(textOf(counted)).toContain(`**${total}**`);
    expect(counted.at(-1)?.type).toBe('done');

    const person = (await client.records.list({ object: 'person', limit: 1 })).items[0];
    const name = String(person?.first_name);
    const opened: ChatEvent[] = [];
    await run(
      client.ai.send(conversation.id, { content: `open ${name}` }, (e) => opened.push(e)),
      opened,
    );
    expect(opened.find((e) => e.type === 'navigate')).toMatchObject({ target: { kind: 'record', object: 'person' } });

    const deleting: ChatEvent[] = [];
    await run(
      client.ai.send(conversation.id, { content: `delete ${name}` }, (e) => deleting.push(e)),
      deleting,
    );
    const paused = deleting.at(-1);
    expect(paused?.type).toBe('paused');
    const pending = paused?.type === 'paused' ? paused.pending[0] : undefined;
    expect(pending?.name).toBe('delete_records');
    expect(() => client.ai.send(conversation.id, { content: 'x' }, () => {})).toThrow(/still working/);
    await expect(client.records.get('person', String(person?.id))).resolves.toBeDefined();

    const resolved: ChatEvent[] = [];
    await run(
      client.ai.resolve(conversation.id, pending?.id ?? '', { approved: true }, (e) => resolved.push(e)),
      resolved,
    );
    expect(resolved.find((e) => e.type === 'tool_result')).toMatchObject({ status: 'executed' });
    await expect(client.records.get('person', String(person?.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const thread = await client.ai.conversations.get(conversation.id);
    expect(thread.activeTurn).toBeNull();
    expect(thread.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'assistant',
    ]);
    expect(thread.messages[5]?.blocks.find((b) => b.type === 'tool_use')).toMatchObject({
      toolCall: { status: 'executed' },
    });
    expect((await client.ai.conversations.list()).map((c) => c.id)).toEqual([conversation.id]);
  });

  it('cancels a pending approval', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    const conversation = await client.ai.conversations.create({});
    const person = (await client.records.list({ object: 'person', limit: 1 })).items[0];
    const events: ChatEvent[] = [];
    await client.ai.send(conversation.id, { content: `delete ${String(person?.first_name)}` }, (e) => events.push(e))
      .done;
    const cancelled = await client.ai.cancel(conversation.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(await client.ai.cancel(conversation.id)).toBeNull();
  });

  it('lets an agent set how its tools ask, except the tools that always ask', async () => {
    const client = demoClient({ workspaceId: 'ws', manifests: [fixture], ai: { latency: 0 } });
    await expect(
      client.ai.agents.create({ name: 'Careless', approvalOverrides: { delete_field: 'auto' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const sales = await client.ai.agents.create({ name: 'Sales', approvalOverrides: { delete_records: 'auto' } });
    expect(sales.approvalOverrides).toEqual({ delete_records: 'auto' });
    await expect(client.ai.agents.update(sales.id, { approvalOverrides: { fly: 'auto' } })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // The tool list says what each tool does by itself; there is no workspace setting that changes it.
    const status = await client.ai.status();
    expect(status.tools.find((t) => t.name === 'delete_records')?.approval).toBe('approve');
    expect(status.tools.find((t) => t.name === 'delete_field')).toMatchObject({ approval: 'approve', locked: true });
    expect(await client.ai.settings.get()).not.toHaveProperty('approvalOverrides');
  });
});
