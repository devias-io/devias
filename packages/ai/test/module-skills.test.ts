import { defineModule } from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { text, toolUse } from '../src/testing';
import { createHarness, eventsOf, type Harness, send } from './helpers';

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

const skill = (key: string, patch: Partial<{ title: string; description: string; body: string }> = {}) => ({
  id: `lab.${key}`,
  title: `Skill ${key}`,
  description: `Use when asked about ${key}`,
  body: `# ${key}\n\nStep one of ${key}`,
  ...patch,
});

const lab = (version: string, skills = [skill('count'), skill('report')], agentSkills: string[] = ['lab.count']) =>
  defineModule({
    id: 'lab',
    version,
    name: 'Lab',
    skills,
    agents: [
      {
        id: 'lab.analyst',
        name: 'Analyst',
        actionIds: ['core.list_records'],
        skillIds: agentSkills,
      },
    ],
  });

const skillsOf = async (harness: Harness, includeArchived = true) =>
  harness.service.skills.list(harness.owner, { includeArchived });
const titled = async (harness: Harness, title: string) => (await skillsOf(harness)).find((row) => row.title === title);

describe('skills a module ships', () => {
  it('appear when the module is installed, owned by it, and an agent of the module may use the ones it names', async () => {
    h = await createHarness();
    expect(await skillsOf(h)).toEqual([]);
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    expect(await titled(h, 'Skill count')).toMatchObject({
      id: 'lab.count',
      moduleId: 'lab',
      description: 'Use when asked about count',
      archivedAt: null,
    });
    expect((await h.service.skills.get(h.owner, 'lab.report')).body).toContain('Step one of report');
    const analyst = (await h.service.agents.list(h.owner)).find((agent) => agent.id === 'lab.analyst');
    expect(analyst?.skills).toEqual(['lab.count']);
  });

  it('are updated with the module, the same skill each time', async () => {
    h = await createHarness();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    await h.engine.modules.apply(
      h.owner,
      lab('0.2.0', [skill('count', { title: 'Count things', body: 'Newer text' }), skill('report')]),
    );
    expect(await titled(h, 'Skill count')).toBeUndefined();
    expect(await h.service.skills.get(h.owner, 'lab.count')).toMatchObject({
      title: 'Count things',
      body: 'Newer text',
    });
    expect(await skillsOf(h)).toHaveLength(2);
  });

  it('keep what the module wrote to the module, and leave the archive switch to the workspace', async () => {
    h = await createHarness();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));

    for (const patch of [{ title: 'Mine' }, { description: 'Other' }, { body: 'Do anything' }]) {
      const refused = await failure(h.service.skills.update(h.owner, 'lab.count', patch));
      expect(refused.code).toBe('VALIDATION');
      expect(refused.message).toContain('"lab"');
    }

    // A person archives one, and it stays archived across an update of the module.
    await h.service.skills.delete(h.owner, 'lab.count');
    await h.engine.modules.apply(h.owner, lab('0.2.0', [skill('count'), skill('report', { body: 'Changed' })]));
    expect((await h.service.skills.get(h.owner, 'lab.count')).archivedAt).not.toBeNull();
    expect((await h.service.skills.get(h.owner, 'lab.report')).body).toBe('Changed');
    expect((await h.service.skills.update(h.owner, 'lab.count', { archived: false })).archivedAt).toBeNull();
  });

  it('are archived when the module is uninstalled, cannot be restored by hand, and return with it', async () => {
    h = await createHarness();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    // Skills reach the workspace when it next uses them, so look before the module goes.
    expect(await skillsOf(h, false)).toHaveLength(2);
    await h.engine.modules.uninstall(h.owner, 'lab');
    expect(await skillsOf(h, false)).toEqual([]);
    const archived = await skillsOf(h);
    expect(archived).toHaveLength(2);
    expect(archived.every((row) => row.archivedAt !== null)).toBe(true);
    expect((await failure(h.service.skills.update(h.owner, 'lab.count', { archived: false }))).code).toBe('CONFLICT');

    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    expect((await skillsOf(h, false)).map((row) => row.id).sort()).toEqual(['lab.count', 'lab.report']);
  });

  it('may repeat a title the workspace uses, and do not count against the workspace’s fifty', async () => {
    h = await createHarness();
    await h.service.skills.create(h.owner, { title: 'Skill count', description: 'Mine', body: 'Mine' });
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    expect((await skillsOf(h)).filter((row) => row.title === 'Skill count')).toHaveLength(2);
  });

  it('are the only skills of a module’s agent, which loads them and not the workspace’s', async () => {
    h = await createHarness([
      { content: [toolUse('use_skill', { skill: 'Skill count' }, 'tu_count')] },
      { content: [toolUse('use_skill', { skill: 'Skill report' }, 'tu_report')] },
      { content: [text('Done.')] },
    ]);
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    await h.service.skills.create(h.owner, { title: 'Mine', description: 'Workspace skill', body: 'Mine' });
    const conversation = await h.service.conversations.create(h.owner, { agentId: 'lab.analyst' });
    const events = await send(h, h.owner, conversation.id, 'go');
    const instructions = h.model.requests[0]?.instructions ?? '';
    expect(instructions).toContain('- Skill count: Use when asked about count');
    expect(instructions).not.toContain('Skill report');
    expect(instructions).not.toContain('Mine');
    const [loaded, refused] = eventsOf(events, 'tool_result');
    expect(loaded?.result).toMatchObject({ title: 'Skill count' });
    expect(refused?.result).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('are listed to an agent of the workspace that may use every skill', async () => {
    h = await createHarness([{ content: [text('Hi.')] }]);
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const everything = await h.service.agents.create(h.owner, { name: 'Everything' });
    const conversation = await h.service.conversations.create(h.owner, { agentId: everything.id });
    await send(h, h.owner, conversation.id, 'go');
    const instructions = h.model.requests[0]?.instructions ?? '';
    expect(instructions).toContain('Skill count');
    expect(instructions).toContain('Skill report');
  });
});
