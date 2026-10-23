import { EngineError } from '@devias/data-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.close());

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

const input = (title: string, extra: Record<string, string> = {}) => ({
  title,
  description: `Use when a request is about ${title.toLowerCase()}`,
  body: `# ${title}\n\n1. Look it up\n2. Do it`,
  ...extra,
});

describe('skills', () => {
  it('are written, read and listed by people who manage agents, and listed without their text', async () => {
    const created = await h.service.skills.create(h.owner, input('Qualify a lead'));
    expect(created).toMatchObject({
      title: 'Qualify a lead',
      moduleId: null,
      archivedAt: null,
      body: '# Qualify a lead\n\n1. Look it up\n2. Do it',
    });
    expect(created.id).toMatch(/^workspace\./);

    const listed = await h.service.skills.list(h.owner);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('body');
    expect((await h.service.skills.get(h.owner, created.id)).body).toContain('Look it up');
  });

  it('are refused to anyone without ai.manage, and to callers that are not people', async () => {
    const created = await h.service.skills.create(h.owner, input('Qualify a lead'));
    expect((await failure(h.service.skills.list(h.member))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.skills.get(h.member, created.id))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.skills.create(h.member, input('Mine')))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.skills.update(h.member, created.id, { title: 'Hijack' }))).code).toBe('FORBIDDEN');
    expect((await failure(h.service.skills.delete(h.member, created.id))).code).toBe('FORBIDDEN');
    const key = { workspaceId: h.workspaceId, actor: { kind: 'api_key' as const, id: 'k' }, role: 'owner' as const };
    expect((await failure(h.service.skills.list(key))).code).toBe('FORBIDDEN');
  });

  it('change only what is given, and are archived, never deleted, and restored', async () => {
    const created = await h.service.skills.create(h.owner, input('Qualify a lead'));
    const renamed = await h.service.skills.update(h.owner, created.id, { description: 'When a new lead arrives' });
    expect(renamed).toMatchObject({ title: 'Qualify a lead', description: 'When a new lead arrives' });
    expect(renamed.body).toBe(created.body);

    await h.service.skills.delete(h.owner, created.id);
    expect(await h.service.skills.list(h.owner)).toEqual([]);
    expect((await h.service.skills.list(h.owner, { includeArchived: true }))[0]?.archivedAt).not.toBeNull();
    expect((await h.service.skills.get(h.owner, created.id)).archivedAt).not.toBeNull();

    const restored = await h.service.skills.update(h.owner, created.id, { archived: false });
    expect(restored.archivedAt).toBeNull();
    expect(await h.service.skills.list(h.owner)).toHaveLength(1);
  });

  it('keep their limits: a title, a description and a text of a size, and not empty', async () => {
    const { skills } = h.service;
    // The service trusts the schemas for sizes (the API parses them); it refuses what is blank once trimmed.
    expect((await failure(skills.create(h.owner, input('   ')))).code).toBe('VALIDATION');
    expect(await skills.create(h.owner, input('A'.repeat(80)))).toMatchObject({ title: 'A'.repeat(80) });
  });

  it('share no title among the ones the workspace wrote, in any case, and are at most fifty', async () => {
    const first = await h.service.skills.create(h.owner, input('Qualify a lead'));
    expect((await failure(h.service.skills.create(h.owner, input('qualify A LEAD')))).code).toBe('CONFLICT');
    const other = await h.service.skills.create(h.owner, input('Invoice a client'));
    expect((await failure(h.service.skills.update(h.owner, other.id, { title: 'Qualify a lead' }))).code).toBe(
      'CONFLICT',
    );
    // A skill may keep its own title when it is renamed in case only.
    expect((await h.service.skills.update(h.owner, first.id, { title: 'QUALIFY a lead' })).title).toBe(
      'QUALIFY a lead',
    );
    // An archived skill gives its title back, and restoring it clashes again.
    await h.service.skills.delete(h.owner, first.id);
    const again = await h.service.skills.create(h.owner, input('Qualify a lead'));
    expect((await failure(h.service.skills.update(h.owner, first.id, { archived: false }))).code).toBe('CONFLICT');
    await h.service.skills.delete(h.owner, again.id);

    for (let i = 0; i < 48; i++) {
      await h.service.skills.create(h.owner, input(`Skill ${i}`));
    }

    // Active now: 'Invoice a client' and the 48 above. The fiftieth is allowed, the next refused naming the cap.
    expect((await h.service.skills.list(h.owner)).length).toBe(49);
    await h.service.skills.create(h.owner, input('The fiftieth'));
    const refused = await failure(h.service.skills.create(h.owner, input('The fifty-first')));
    expect(refused.code).toBe('CONFLICT');
    expect(refused.message).toContain('50');
  });
});

describe('the skills of an agent', () => {
  it('are null for every skill by default, or a list of active skills that exist', async () => {
    const skill = await h.service.skills.create(h.owner, input('Qualify a lead'));
    const all = await h.service.agents.create(h.owner, { name: 'Sales' });
    expect(all.skills).toBeNull();
    const chosen = await h.service.agents.create(h.owner, { name: 'Billing', skills: [skill.id, skill.id] });
    expect(chosen.skills).toEqual([skill.id]);
    const none = await h.service.agents.create(h.owner, { name: 'Quiet', skills: [] });
    expect(none.skills).toEqual([]);
    expect((await h.service.agents.update(h.owner, chosen.id, { skills: null })).skills).toBeNull();
    // The workspace's first agent starts with every skill.
    expect((await h.service.agents.list(h.owner)).find((agent) => agent.name === 'Assistant')?.skills).toBeNull();
  });

  it('refuse a skill that does not exist or is archived', async () => {
    const skill = await h.service.skills.create(h.owner, input('Qualify a lead'));
    const unknown = await failure(h.service.agents.create(h.owner, { name: 'Sales', skills: ['workspace.nope'] }));
    expect(unknown.code).toBe('VALIDATION');
    expect(unknown.details).toEqual({ unknown: ['workspace.nope'] });
    await h.service.skills.delete(h.owner, skill.id);
    expect((await failure(h.service.agents.create(h.owner, { name: 'Sales', skills: [skill.id] }))).code).toBe(
      'VALIDATION',
    );
    const agent = await h.service.agents.create(h.owner, { name: 'Sales' });
    expect((await failure(h.service.agents.update(h.owner, agent.id, { skills: [skill.id] }))).code).toBe('VALIDATION');
  });

  it('keep a skill that was archived after it was given, so saving the agent is not refused for it', async () => {
    const skill = await h.service.skills.create(h.owner, input('Qualify a lead'));
    const agent = await h.service.agents.create(h.owner, { name: 'Sales', skills: [skill.id] });
    await h.service.skills.delete(h.owner, skill.id);
    const saved = await h.service.agents.update(h.owner, agent.id, { name: 'Sales team', skills: [skill.id] });
    expect(saved).toMatchObject({ name: 'Sales team', skills: [skill.id] });
  });
});
