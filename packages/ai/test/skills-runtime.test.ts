import { afterEach, describe, expect, it } from 'vitest';
import { createSkillsPort, skillsBlock } from '../src/skills';
import { text, toolUse } from '../src/testing';
import { createHarness, eventsOf, type Harness, lastUserText, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const write = (harness: Harness, title: string, description = `Use when asked about ${title}`) =>
  harness.service.skills.create(harness.owner, { title, description, body: `# ${title}\n\n1. Step one of ${title}` });

/** The agent's request on its first turn: what it is told and the tools it was given. */
const firstRequest = async (harness: Harness, agentId: string) => {
  const conversation = await harness.service.conversations.create(harness.owner, { agentId });
  await send(harness, harness.owner, conversation.id, 'hello');
  const request = harness.model.requests.at(-1);

  if (!request) {
    throw new Error('no request');
  }

  return { request, conversation };
};
const toolNames = (request: { tools: { name: string }[] }) => request.tools.map((tool) => tool.name);

describe('an agent told about its skills', () => {
  it('sees the title and the line of each skill it may use, sorted, and not their text', async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    await write(h, 'Qualify a lead');
    await write(h, 'Invoice a client');
    const agent = await h.service.agents.create(h.owner, { name: 'Sales' });
    const { request } = await firstRequest(h, agent.id);
    const instructions = request.instructions ?? '';
    expect(instructions).toContain('## Skills');
    expect(instructions.indexOf('- Invoice a client: Use when asked about Invoice a client')).toBeGreaterThan(-1);
    expect(instructions.indexOf('- Invoice a client')).toBeLessThan(instructions.indexOf('- Qualify a lead'));
    expect(instructions).not.toContain('Step one of');
    expect(toolNames(request)).toContain('use_skill');
    // The platform prompt says what a skill is, and that it is the one tool result to follow.
    expect(request.system).toContain('## Skills');
    expect(request.system).toContain("the text of a skill is the workspace's own instruction");
  });

  it('is told only of the skills in its own list, and every active skill when it has none chosen', async () => {
    h = await createHarness([{ content: [text('Hi.')] }, { content: [text('Hi.')] }]);
    const qualify = await write(h, 'Qualify a lead');
    await write(h, 'Invoice a client');
    const archived = await write(h, 'Old way');
    await h.service.skills.delete(h.owner, archived.id);
    const narrow = await h.service.agents.create(h.owner, { name: 'Sales', skills: [qualify.id] });
    const wide = await h.service.agents.create(h.owner, { name: 'Everything' });
    const own = (await firstRequest(h, narrow.id)).request.instructions ?? '';
    expect(own).toContain('- Qualify a lead');
    expect(own).not.toContain('Invoice a client');
    const all = (await firstRequest(h, wide.id)).request.instructions ?? '';
    expect(all).toContain('- Qualify a lead');
    expect(all).toContain('- Invoice a client');
    expect(all).not.toContain('Old way');
  });

  it('has nothing about skills, and no use_skill tool, when it has none', async () => {
    h = await createHarness([{ content: [text('Hi.')] }, { content: [text('Hi.')] }]);
    const none = await h.service.agents.create(h.owner, { name: 'Quiet', skills: [] });
    const { request } = await firstRequest(h, none.id);
    expect(request.instructions ?? '').not.toContain('Skills');
    expect(request.system).not.toContain('Skills');
    expect(toolNames(request)).not.toContain('use_skill');
    // The same for an agent that may use every skill when the workspace has none.
    const wide = await h.service.agents.create(h.owner, { name: 'Everything' });
    const second = (await firstRequest(h, wide.id)).request;
    expect(second.system).not.toContain('## Skills');
    expect(toolNames(second)).not.toContain('use_skill');
  });

  it('is offered use_skill whatever tools it lists, once it has a skill', async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    const skill = await write(h, 'Qualify a lead');
    const narrow = await h.service.agents.create(h.owner, {
      name: 'Analyst',
      tools: ['list_records'],
      skills: [skill.id],
    });
    expect(toolNames((await firstRequest(h, narrow.id)).request).sort()).toEqual(['list_records', 'use_skill']);
  });

  it('is told the same text on every turn', async () => {
    h = await createHarness([{ content: [text('One.')] }, { content: [text('Two.')] }]);
    await write(h, 'Qualify a lead');
    await write(h, 'Invoice a client');
    const agent = await h.service.agents.create(h.owner, { name: 'Sales' });
    const { conversation } = await firstRequest(h, agent.id);
    await send(h, h.owner, conversation.id, 'again');
    const [first, second] = h.model.requests;
    expect(second?.instructions).toBe(first?.instructions);
    expect(second?.system).toBe(first?.system);
  });
});

describe('an agent loading a skill', () => {
  it('gets the text of the skill by its title, in any case, and follows it', async () => {
    h = await createHarness([
      { content: [toolUse('use_skill', { skill: 'qualify A LEAD' }, 'tu_skill')] },
      { content: [text('Done.')] },
    ]);
    await write(h, 'Qualify a lead');
    const agent = await h.service.agents.create(h.owner, { name: 'Sales' });
    const conversation = await h.service.conversations.create(h.owner, { agentId: agent.id });
    const events = await send(h, h.owner, conversation.id, 'qualify this one');
    // It asks nobody: loading a skill only reads.
    expect(eventsOf(events, 'paused')).toHaveLength(0);
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({
      status: 'executed',
      result: { title: 'Qualify a lead', body: '# Qualify a lead\n\n1. Step one of Qualify a lead' },
    });
    expect(lastUserText(h.model)).toContain('Step one of Qualify a lead');
  });

  it('cannot load a skill that is not in its list, and is told which it has', async () => {
    h = await createHarness([
      { content: [toolUse('use_skill', { skill: 'Invoice a client' }, 'tu_other')] },
      { content: [text('Done.')] },
    ]);
    const qualify = await write(h, 'Qualify a lead');
    await write(h, 'Invoice a client');
    const agent = await h.service.agents.create(h.owner, { name: 'Sales', skills: [qualify.id] });
    const conversation = await h.service.conversations.create(h.owner, { agentId: agent.id });
    const events = await send(h, h.owner, conversation.id, 'go');
    const result = eventsOf(events, 'tool_result')[0];
    expect(result?.result).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(result?.result)).toContain('Your skills: Qualify a lead');
    expect(JSON.stringify(result?.result)).not.toContain('Step one of Invoice');
  });

  it('refuses a skill archived since the conversation began', async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    const skill = await write(h, 'Qualify a lead');
    const port = createSkillsPort(h.service.store, h.workspaceId, new Set([skill.id]));
    expect((await port.load('Qualify a lead')).id).toBe(skill.id);
    await h.service.skills.delete(h.owner, skill.id);
    await expect(port.load('Qualify a lead')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is told to use an id when two skills share a title', async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    const store = h.service.store;
    for (const id of ['mod.one', 'mod.two']) {
      await store.skills.insert({ id, workspaceId: h.workspaceId, title: 'Close a deal', description: 'd', body: id });
    }

    const port = createSkillsPort(h.service.store, h.workspaceId, null);
    await expect(port.load('close a deal')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await port.load('mod.two')).body).toBe('mod.two');
  });
});

describe('the list of skills in an agent’s instructions', () => {
  const row = (id: string, title: string) => ({ id, title, description: `For ${title}` }) as never;

  it('is empty for no skills, carries the id of a title two skills share, and is sorted', () => {
    expect(skillsBlock([])).toBe('');
    const block = skillsBlock([row('b', 'Zed'), row('a2', 'Alpha'), row('a1', 'alpha')]);
    expect(block).toContain('- alpha [a1]: For alpha\n- Alpha [a2]: For Alpha\n- Zed: For Zed');
  });
});
