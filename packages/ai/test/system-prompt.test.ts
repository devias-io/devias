import { AI_TOOL_AREAS, type AiToolArea } from '@devias/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt/system';
import { text } from '../src/testing';
import { createHarness, type Harness, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const prompt = (...areas: AiToolArea[]) => buildSystemPrompt(new Set(areas));
const ALL = AI_TOOL_AREAS.map((area) => area.key);

describe('the system prompt by area', () => {
  it('teaches only the work the tools do', () => {
    const base = prompt();
    expect(base).toContain('You are an agent built into Devias');
    expect(base).toContain('## How to work');

    for (const heading of [
      '## How the workspace is organised',
      '## Workflows',
      '## Modules with settings',
      '## Showing things',
    ]) {
      expect(base).not.toContain(heading);
    }

    const analyst = prompt('records', 'model');
    expect(analyst).toContain('## How the workspace is organised');
    expect(analyst).toContain('rich_text');
    expect(analyst).not.toContain('## Workflows');
    expect(analyst).not.toContain('create_workflow');
    expect(analyst).not.toContain('## Modules with settings');

    expect(prompt('workflows')).toContain('## Workflows');
    expect(prompt('workflows')).toContain('[Label](workflow:<id>)');
    expect(prompt('modules')).toContain('## Modules with settings');
    expect(prompt('actions')).toContain('## Modules with settings');
    expect(prompt('interface')).toContain('call navigate');
    // People, notification and agent tools add no section of their own.
    expect(prompt('people', 'notifications', 'agents')).toBe(base);
    // The workflow and module sections stand on their own: a workflow-only agent still gets the vocabulary they use.
    expect(prompt('workflows')).toContain('## How the workspace is organised');
    expect(prompt('modules')).not.toContain('## How the workspace is organised');
  });

  it('teaches skills only to an agent that has some, after how to work', () => {
    const base = prompt();
    // The skills tools alone add nothing: the section is for an agent that can load a skill.
    expect(prompt('skills')).toBe(base);
    const skilled = buildSystemPrompt(new Set(), { skills: true });
    expect(skilled).toContain('## Skills');
    expect(skilled.indexOf('## Skills')).toBeGreaterThan(skilled.indexOf('## How to work'));
    expect(skilled.slice(0, skilled.indexOf('\n\n## Skills'))).toBe(base);
  });

  it('says a comment on a record is not an object, and that the data model does not list the agent’s own tools', () => {
    const records = prompt('records');
    expect(records).toContain('A comment on a record is not an object or a record');
    expect(records).toContain('comment_on_record');
    expect(records).toContain('never your own tools');
    expect(prompt('modules')).not.toContain('A comment on a record is not an object');
  });

  it('gives an agent with every tool every section, in a fixed order', () => {
    const full = buildSystemPrompt(new Set(ALL));
    const order = [
      'You are an agent built into Devias',
      '## How the workspace is organised',
      '## Workflows',
      '## Modules with settings',
      '## How to work',
      '## Showing things',
    ].map((marker) => full.indexOf(marker));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is byte-stable for equal tool sets, whatever order they arrive in', () => {
    expect(buildSystemPrompt(new Set(['workflows', 'records', 'interface']))).toBe(
      buildSystemPrompt(new Set(['interface', 'records', 'workflows'])),
    );
  });

  it('follows the tools of the agent in a real request', async () => {
    h = await createHarness([{ content: [text('Hi.')] }, { content: [text('Hi.')] }]);
    const analyst = await h.service.agents.create(h.owner, {
      label: 'Analyst',
      tools: ['list_records', 'list_objects', 'lookup_records'],
    });
    const general = (await h.service.agents.list(h.owner)).find((agent) => agent.tools === null);
    const narrow = await h.service.conversations.create(h.owner, { agentId: analyst.id });
    await send(h, h.owner, narrow.id, 'hello');
    const wide = await h.service.conversations.create(h.owner, { agentId: general?.id ?? '' });
    await send(h, h.owner, wide.id, 'hello');

    const [first, second] = h.model.requests.map((request) => request.system);
    expect(first).toContain('## How the workspace is organised');
    expect(first).not.toContain('## Workflows');
    expect(first).not.toContain('## Modules with settings');
    expect(first).not.toContain('call navigate');
    // An agent with every tool gets the sections of every area its tools are in.
    expect(second).toContain('## Workflows');
    expect(second).toContain('## Modules with settings');
    expect(second).toContain('call navigate');
  });
});
