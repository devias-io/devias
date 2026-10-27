import { coreIds, defineModule } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient } from '../src/mock';

const client = () => createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });
const input = (label: string) => ({ label, description: `When a request is about ${label}`, body: `1. Do ${label}` });

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error.code;
    }

    throw error;
  }
};

describe('mock skills', () => {
  it('writes, lists without the text, reads, archives and restores', async () => {
    const { skills } = client().ai;
    const created = await skills.create(input('Qualify a lead'));
    expect(created).toMatchObject({ label: 'Qualify a lead', moduleId: null, archivedAt: null });
    const listed = await skills.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('body');
    expect((await skills.get(created.id)).body).toBe('1. Do Qualify a lead');

    await skills.delete(created.id);
    expect(await skills.list()).toEqual([]);
    expect(await skills.list({ includeArchived: true })).toHaveLength(1);
    expect((await skills.update(created.id, { archived: false })).archivedAt).toBeNull();
    expect(await code(skills.get('missing'))).toBe('NOT_FOUND');
  });

  it('refuses a repeated label, in any case, and more than fifty', async () => {
    const { skills } = client().ai;
    await skills.create(input('Qualify a lead'));
    expect(await code(skills.create(input('QUALIFY a lead')))).toBe('CONFLICT');

    for (let i = 0; i < 49; i++) {
      await skills.create(input(`Skill ${i}`));
    }

    expect(await code(skills.create(input('One too many')))).toBe('CONFLICT');
  });

  it('gives an agent every skill, or a list of ones that exist and are active', async () => {
    const c = client();
    const skill = await c.ai.skills.create(input('Qualify a lead'));
    expect((await c.ai.agents.list()).every((agent) => agent.skills === null)).toBe(true);
    const chosen = await c.ai.agents.create({ label: 'Billing', skills: [skill.id] });
    expect(chosen.skills).toEqual([skill.id]);
    expect(await code(c.ai.agents.create({ label: 'Lost', skills: ['workspace.nope'] }))).toBe('VALIDATION');
    await c.ai.skills.delete(skill.id);
    // An archived skill cannot be given to an agent that lacks it, and an agent that has it keeps it.
    const other = await c.ai.agents.create({ label: 'Other' });
    expect(await code(c.ai.agents.update(other.id, { skills: [skill.id] }))).toBe('VALIDATION');
    expect((await c.ai.agents.update(chosen.id, { label: 'Billing team', skills: [skill.id] })).skills).toEqual([
      skill.id,
    ]);
  });
});

describe('mock skills a module ships', () => {
  const lab = defineModule({
    id: '01a1751f-5f08-717d-a428-446a0ff330a8',
    version: '1.0.0',
    label: 'Lab',
    skills: [
      {
        id: '01a1751f-5f15-7708-9f78-5b80167990e5',
        label: 'Count things',
        description: 'When asked to count',
        body: '1. Count',
      },
    ],
    agents: [
      {
        id: '01a1751f-5f0a-70f6-b258-b45fac72016c',
        label: 'Analyst',
        actionIds: [coreIds.actions.list_records],
        skillIds: ['01a1751f-5f15-7708-9f78-5b80167990e5'],
      },
    ],
  });

  it('appear with the module, are the module’s to change, and go with it', async () => {
    const c = createMockClient({ workspaceId: 'ws_test', manifests: [fixture, lab] });
    const listed = await c.ai.skills.list();
    expect(listed).toEqual([
      expect.objectContaining({
        id: '01a1751f-5f15-7708-9f78-5b80167990e5',
        label: 'Count things',
        moduleId: '01a1751f-5f08-717d-a428-446a0ff330a8',
      }),
    ]);
    expect(
      (await c.ai.agents.list()).find((agent) => agent.id === '01a1751f-5f0a-70f6-b258-b45fac72016c')?.skills,
    ).toEqual(['01a1751f-5f15-7708-9f78-5b80167990e5']);
    expect(await code(c.ai.skills.update('01a1751f-5f15-7708-9f78-5b80167990e5', { label: 'Mine' }))).toBe(
      'VALIDATION',
    );

    await c.ai.skills.delete('01a1751f-5f15-7708-9f78-5b80167990e5');
    expect((await c.ai.skills.get('01a1751f-5f15-7708-9f78-5b80167990e5')).archivedAt).not.toBeNull();
    expect(
      (await c.ai.skills.update('01a1751f-5f15-7708-9f78-5b80167990e5', { archived: false })).archivedAt,
    ).toBeNull();

    await c.modules.uninstall('01a1751f-5f08-717d-a428-446a0ff330a8');
    expect(await c.ai.skills.list()).toEqual([]);
    expect(await code(c.ai.skills.update('01a1751f-5f15-7708-9f78-5b80167990e5', { archived: false }))).toBe(
      'CONFLICT',
    );
  });
});
