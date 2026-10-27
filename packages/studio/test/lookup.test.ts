import type { Member } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { describe, expect, it } from 'vitest';
import { lookupEntities } from '../src/editor/lookup';

const member = (userId: string, name: string, email: string): Member =>
  ({
    id: `m-${userId}`,
    userId,
    role: 'member',
    createdAt: '',
    user: { id: userId, name, email, image: null },
  }) as Member;

describe('what @ offers', () => {
  it('offers the workspace’s members by name or email, and tasks and documents by their text', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    const doc = await client.documents.create({ title: 'Ana’s brief' });
    const task = await client.tasks.create({ title: 'Call Ana back' });
    const hits = await lookupEntities(client, 'ana', {
      members: [member('u1', 'Ana Pop', 'ana@acme.test'), member('u2', 'Ion', 'ion@acme.test')],
    });
    expect(hits.map((hit) => [hit.object, hit.recordId, hit.title])).toEqual([
      ['member', 'u1', 'Ana Pop'],
      ['document', doc.id, 'Ana’s brief'],
      ['task', task.id, 'Call Ana back'],
    ]);
    expect(hits.find((hit) => hit.object === 'task')?.subtitle).toBe('Task');
    const agent = await client.ai.agents.create({ label: 'Ana’s helper' });
    const withAgent = await lookupEntities(client, 'ana’s', {});
    expect(withAgent.find((hit) => hit.object === 'agent')).toMatchObject({
      recordId: agent.id,
      title: 'Ana’s helper',
      subtitle: 'Agent',
    });
    const byEmail = await lookupEntities(client, 'ion@', { members: [member('u2', 'Ion', 'ion@acme.test')] });
    expect(byEmail.map((hit) => hit.recordId)).toEqual(['u2']);
    expect(await lookupEntities(client, 'zzz', { members: [member('u1', 'Ana', 'a@b.c')] })).toEqual([]);
  });
});
