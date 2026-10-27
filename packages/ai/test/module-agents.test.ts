import { coreIds, defineModule, moduleActionSpec } from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { text } from '../src/testing';
import { createHarness, type Harness, send } from './helpers';

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

const lab = (
  version: string,
  agent: Partial<{ label: string; instructions: string; actionIds: string[]; starterPrompts: string[] }> = {},
  more: { id: string; label: string; actionIds: string[] }[] = [],
) =>
  defineModule({
    id: '01a1751f-5f08-717d-a428-446a0ff330a8',
    version,
    name: 'Lab',
    agents: [
      {
        id: '01a1751f-5f0a-70f6-b258-b45fac72016c',
        label: 'Analyst',
        description: 'Reads the lab',
        instructions: 'Only read.',
        actionIds: [coreIds.actions.list_records, coreIds.actions.lookup_records],
        starterPrompts: ['see what is new'],
        ...agent,
      },
      ...more,
    ],
  });

const find = async (harness: Harness, name: string, includeArchived = true) =>
  (await harness.service.agents.list(harness.owner, { includeArchived })).find((agent) => agent.label === name);

describe('agents a module ships', () => {
  it('appear when the module is installed, owned by it, with their tools, and not before', async () => {
    h = await createHarness();
    expect(await find(h, 'Analyst')).toBeUndefined();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const analyst = await find(h, 'Analyst');
    expect(analyst).toMatchObject({
      moduleId: '01a1751f-5f08-717d-a428-446a0ff330a8',
      id: '01a1751f-5f0a-70f6-b258-b45fac72016c',
      description: 'Reads the lab',
      instructions: 'Only read.',
      tools: ['list_records', 'lookup_records'],
      starterPrompts: ['see what is new'],
      approvalOverrides: {},
      archivedAt: null,
    });
    // Members see it too: it is an agent like any other.
    expect((await h.service.agents.list(h.member)).map((agent) => agent.label)).toContain('Analyst');
  });

  it("are updated with the module, keeping the workspace's own settings and the same agent", async () => {
    h = await createHarness();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const before = await find(h, 'Analyst');
    await h.service.agents.update(h.owner, before?.id ?? '', { approvalOverrides: { list_records: 'approve' } });
    await h.service.settings.update(h.owner, { defaultAgentId: before?.id ?? null });

    await h.engine.modules.apply(
      h.owner,
      lab('0.2.0', {
        label: 'Lab analyst',
        instructions: 'Read and explain.',
        actionIds: [coreIds.actions.list_records, coreIds.actions.get_record_with_labels],
      }),
    );
    const after = await find(h, 'Lab analyst');
    expect(after).toMatchObject({
      id: before?.id,
      instructions: 'Read and explain.',
      tools: ['list_records', 'get_record'],
      approvalOverrides: { list_records: 'approve' },
    });
    expect(await find(h, 'Analyst')).toBeUndefined();
    expect((await h.service.settings.get(h.owner)).defaultAgentId).toBe(before?.id);
  });

  it('leave out tools that do not exist or that reach beyond their name, and are not made with none left', async () => {
    h = await createHarness();
    await h.engine.modules.apply(
      h.owner,
      lab(
        '0.1.0',
        {
          actionIds: [
            coreIds.actions.list_records,
            'core.fly_to_the_moon',
            coreIds.actions.run_workflow,
            coreIds.actions.create_api_key,
            coreIds.actions.archive_agent,
          ],
        },
        [
          {
            id: '01a1751f-5f18-7600-95e3-d90a731c1bf4',
            label: 'Broken',
            actionIds: ['core.fly_to_the_moon', 'core.install_module'],
          },
        ],
      ),
    );
    expect((await find(h, 'Analyst'))?.tools).toEqual(['list_records']);
    expect(await find(h, 'Broken')).toBeUndefined();
  });

  it('keep what the module wrote to the module, and leave approvals and the archive switch to the workspace', async () => {
    h = await createHarness();
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const analyst = await find(h, 'Analyst');

    for (const patch of [
      { label: 'Mine' },
      { instructions: 'Do anything.' },
      { tools: null },
      { starterPrompts: ['x'] },
    ]) {
      const refused = await failure(h.service.agents.update(h.owner, analyst?.id ?? '', patch));
      expect(refused.code).toBe('VALIDATION');
      expect(refused.message).toContain('"01a1751f-5f08-717d-a428-446a0ff330a8"');
    }

    expect(await find(h, 'Analyst')).toMatchObject({ label: 'Analyst', instructions: 'Only read.' });
    const changed = await h.service.agents.update(h.owner, analyst?.id ?? '', {
      approvalOverrides: { lookup_records: 'approve' },
    });
    expect(changed.approvalOverrides).toEqual({ lookup_records: 'approve' });

    // A person archives it, and a module update does not bring it back.
    await h.service.agents.update(h.owner, analyst?.id ?? '', { archived: true });
    await h.engine.modules.apply(h.owner, lab('0.2.0', { instructions: 'Read it all.' }));
    expect((await find(h, 'Analyst'))?.archivedAt).not.toBeNull();
    expect((await find(h, 'Analyst'))?.instructions).toBe('Read it all.');
    const restored = await h.service.agents.update(h.owner, analyst?.id ?? '', { archived: false });
    expect(restored.archivedAt).toBeNull();
  });

  it('are archived when the module is uninstalled, keep their conversations readable, and return with it', async () => {
    h = await createHarness([{ content: [text('Hello.')] }]);
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const analyst = await find(h, 'Analyst');
    const conversation = await h.service.conversations.create(h.owner, { agentId: analyst?.id ?? '' });
    await send(h, h.owner, conversation.id, 'hello');

    await h.engine.modules.uninstall(h.owner, '01a1751f-5f08-717d-a428-446a0ff330a8');
    expect((await h.service.agents.list(h.owner)).map((agent) => agent.label)).not.toContain('Analyst');
    expect((await find(h, 'Analyst'))?.archivedAt).not.toBeNull();
    // The thread stays, new messages and conversations are refused, and it cannot be restored by hand.
    expect((await h.service.conversations.get(h.owner, conversation.id)).conversation.agentId).toBe(analyst?.id);
    expect((await failure(send(h, h.owner, conversation.id, 'still there?'))).code).toBe('CONFLICT');
    expect((await failure(h.service.conversations.create(h.owner, { agentId: analyst?.id ?? '' }))).code).toBe(
      'CONFLICT',
    );
    expect((await failure(h.service.agents.update(h.owner, analyst?.id ?? '', { archived: false }))).code).toBe(
      'CONFLICT',
    );

    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    expect(await find(h, 'Analyst')).toMatchObject({ id: analyst?.id, archivedAt: null });
  });

  it('talk with their instructions and only their tools', async () => {
    h = await createHarness([{ content: [text('Hello.')] }]);
    await h.engine.modules.apply(h.owner, lab('0.1.0'));
    const analyst = await find(h, 'Analyst');
    const conversation = await h.service.conversations.create(h.owner, { agentId: analyst?.id ?? '' });
    await send(h, h.owner, conversation.id, 'hello');
    const request = h.model.requests[0];
    expect(request?.tools.map((tool) => tool.name)).toEqual(['list_records', 'lookup_records']);
    expect(request?.instructions).toContain('Only read.');
  });
});

describe('agents a module ships with one of its own actions', () => {
  it('get its tool, which is called by the action’s name, not by the end of its id', async () => {
    const counter = defineModule({
      id: '01a1751f-5f08-717d-a428-446a0ff330a8',
      version: '0.1.0',
      label: 'Lab',
      actions: [
        {
          id: '01a1751f-5f15-7708-9f78-5b80167990e5',
          name: 'count_samples',
          label: 'Count samples',
          external: false,
          approval: 'auto',
        },
      ],
      agents: [
        {
          id: '01a1751f-5f0a-70f6-b258-b45fac72016c',
          label: 'Analyst',
          actionIds: ['01a1751f-5f15-7708-9f78-5b80167990e5'],
        },
      ],
    });
    const spec = moduleActionSpec(counter, counter.actions[0] as never, z.object({}));
    h = await createHarness([], { actions: { specs: [spec], invoke: async () => ({}) } });
    await h.engine.modules.apply(h.owner, counter);
    expect((await find(h, 'Analyst'))?.tools).toEqual(['count_samples']);
  });
});
