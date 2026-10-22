import { isTaskEvent, type TaskInput } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EngineContext, EngineError, readEventsAfter, systemContext } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

describe('tasks on PGlite', () => {
  let t: TestEngine;
  let dealId: string;
  const tasks = () => t.engine.tasks;
  const titles = async (query = {}, ctx: EngineContext = t.owner) =>
    (await tasks().list(ctx, query)).items.map((item) => item.title);

  beforeAll(async () => {
    t = await createTestEngine();
    dealId = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Big deal', amount: 100 })).id;
  });
  afterAll(() => t.close());

  const feed = async (taskId?: string) =>
    (await readEventsAfter(t.db, t.workspaceId, 0, 1000))
      .filter(isTaskEvent)
      .filter((event) => taskId === undefined || event.taskId === taskId);

  it('writes tasks as the caller and tells the change feed', async () => {
    const before = (await readEventsAfter(t.db, t.workspaceId, 0, 1000)).length;
    const task = await tasks().create(t.member, { title: '  Call Ana  ', markdown: 'Ask about **pricing**.' });
    expect(task).toMatchObject({
      title: 'Call Ana',
      status: 'todo',
      priority: 'none',
      assignee: null,
      dueDate: null,
      parentId: null,
      version: 1,
      work: null,
      markdown: 'Ask about **pricing**.',
      subtasks: { total: 0, open: 0 },
      createdBy: { kind: 'user', id: 'u_member' },
      closedAt: null,
    });
    expect(task.body.type).toBe('doc');
    expect(await tasks().get(t.owner, task.id)).toEqual(task);

    const events = await readEventsAfter(t.db, t.workspaceId, 0, 1000);
    expect(events.slice(before)).toEqual([
      expect.objectContaining({ type: 'task.changed', taskId: task.id, action: 'created', status: 'todo' }),
    ]);

    const timeline = await tasks().activity(t.owner, task.id);
    expect(timeline.items.map((entry) => entry.kind)).toEqual(['created']);
    expect(timeline.items[0]?.actor).toEqual({ kind: 'user', id: 'u_member' });
  });

  it('validates what it is given', async () => {
    expect(await codeOf(tasks().create(t.owner, { title: '   ' }))).toBe('VALIDATION');
    expect(await codeOf(tasks().create(t.owner, { title: 'x', body: { type: 'doc' }, markdown: 'y' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(tasks().create(t.owner, { title: 'x', dueDate: '2026-02-31' }))).toBe('VALIDATION');
    expect(await codeOf(tasks().create(t.owner, { title: 'x', assignee: 'robot:1' }))).toBe('VALIDATION');
    expect(await codeOf(tasks().create(t.owner, { title: 'x', parent: 'nope' }))).toBe('VALIDATION');
    expect(await codeOf(tasks().create(t.owner, { title: 'x', parent: '00000000-0000-7000-8000-000000000000' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(tasks().create(t.owner, { title: 'x', about: ['https://example.com'] }))).toBe('VALIDATION');
    expect(await codeOf(tasks().update(t.owner, '00000000-0000-7000-8000-000000000000', { title: 'x' }))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(tasks().get(t.owner, 'not-a-uuid'))).toBe('VALIDATION');
  });

  it('updates fields, counting versions and writing the timeline', async () => {
    const task = await tasks().create(t.owner, { title: 'Draft proposal', priority: 'low' });
    const changed = await tasks().update(t.owner, task.id, {
      title: 'Draft the proposal',
      priority: 'urgent',
      dueDate: '2026-11-01',
      status: 'in_progress',
    });
    expect(changed).toMatchObject({
      title: 'Draft the proposal',
      priority: 'urgent',
      dueDate: '2026-11-01',
      status: 'in_progress',
      version: 2,
    });
    expect(changed.statusChangedAt >= task.statusChangedAt).toBe(true);

    const same = await tasks().update(t.owner, task.id, { priority: 'urgent' });
    expect(same.version).toBe(2);

    const timeline = await tasks().activity(t.owner, task.id);
    expect(timeline.items.map((entry) => entry.kind)).toEqual(['changed', 'created']);
    expect(timeline.items[0]?.data).toEqual({
      changes: [
        { field: 'title', from: 'Draft proposal', to: 'Draft the proposal' },
        { field: 'priority', from: 'low', to: 'urgent' },
        { field: 'dueDate', from: null, to: '2026-11-01' },
        { field: 'status', from: 'todo', to: 'in_progress' },
      ],
    });
    expect(await codeOf(tasks().update(t.owner, task.id, {}))).toBe('VALIDATION');
  });

  it('refuses a change made from an old version, and overwrites when no version is named', async () => {
    const task = await tasks().create(t.owner, { title: 'Versioned' });
    await tasks().update(t.owner, task.id, { title: 'Versioned 2', expectedVersion: 1 });
    expect(await codeOf(tasks().update(t.owner, task.id, { title: 'Late', expectedVersion: 1 }))).toBe('CONFLICT');
    expect((await tasks().update(t.owner, task.id, { title: 'Overwrite' })).version).toBe(3);
  });

  it('closes and reopens, and keeps when it closed', async () => {
    const task = await tasks().create(t.owner, { title: 'Close me' });
    const closed = await tasks().update(t.owner, task.id, { status: 'done' });
    expect(closed.closedAt).not.toBeNull();
    const reopened = await tasks().update(t.owner, task.id, { status: 'todo' });
    expect(reopened.closedAt).toBeNull();
    expect((await feed(task.id)).map((e) => e.action)).toEqual([
      'created',
      'updated',
      'status_changed',
      'updated',
      'status_changed',
    ]);
  });

  it('assigns to people and agents, and tells the feed', async () => {
    const task = await tasks().create(t.owner, { title: 'Assign me' });
    const assigned = await tasks().update(t.owner, task.id, { assignee: 'agent:a1' });
    expect(assigned.assignee).toBe('agent:a1');
    expect((await tasks().update(t.owner, task.id, { assignee: 'u_owner' })).assignee).toBe('user:u_owner');
    expect((await tasks().update(t.owner, task.id, { assignee: null })).assignee).toBeNull();
    expect((await feed(task.id)).filter((e) => e.action === 'assigned').map((e) => e.assignee)).toEqual([
      'agent:a1',
      'user:u_owner',
      null,
    ]);
  });

  it('asks the directory who exists once it is bound', async () => {
    const seen: string[] = [];
    tasks().bindAssignees({
      exists: async (_ctx, assignee) => {
        seen.push(`${assignee.kind}:${assignee.id}`);

        return assignee.id !== 'ghost';
      },
    });

    try {
      expect(await codeOf(tasks().create(t.owner, { title: 'Ghost task', assignee: 'user:ghost' }))).toBe('VALIDATION');
      expect(await codeOf(tasks().create(t.owner, { title: 'Real task', assignee: 'agent:a2' }))).toBe('ok');
      expect(seen).toEqual(['user:ghost', 'agent:a2']);
    } finally {
      tasks().bindAssignees({ exists: async () => true });
    }
  });

  it('makes one task for one key', async () => {
    const first = await tasks().create(t.owner, { title: 'Once', key: 'import:42' });
    const again = await tasks().create(t.owner, { title: 'Twice', key: 'import:42' });
    expect(again.id).toBe(first.id);
    expect(again.title).toBe('Once');
    await tasks().delete(t.owner, first.id);
    const later = await tasks().create(t.owner, { title: 'Again', key: 'import:42' });
    expect(later.id).not.toBe(first.id);
  });

  it('nests subtasks to a depth, and refuses cycles', async () => {
    const root = await tasks().create(t.owner, { title: 'Root' });
    const child = await tasks().create(t.owner, { title: 'Child', parent: root.id });
    const grand = await tasks().create(t.owner, { title: 'Grandchild', parent: child.id });
    const deepest = await tasks().create(t.owner, { title: 'Deepest', parent: grand.id });
    expect(await codeOf(tasks().create(t.owner, { title: 'Too deep', parent: deepest.id }))).toBe('VALIDATION');
    expect((await tasks().get(t.owner, root.id)).subtasks).toEqual({ total: 1, open: 1 });
    expect(await titles({ parent: root.id })).toEqual(['Child']);
    expect(await codeOf(tasks().update(t.owner, root.id, { parent: grand.id }))).toBe('VALIDATION');
    expect(await codeOf(tasks().update(t.owner, root.id, { parent: root.id }))).toBe('VALIDATION');
    // Moving a branch down under a sibling is refused when its subtree would pass the limit.
    const sibling = await tasks().create(t.owner, { title: 'Sibling', parent: root.id });
    expect(await codeOf(tasks().update(t.owner, child.id, { parent: sibling.id }))).toBe('VALIDATION');
    // Moving out works and fixes the depth below.
    await tasks().update(t.owner, child.id, { parent: null });
    expect((await tasks().get(t.owner, child.id)).parentId).toBeNull();
    const regrand = await tasks().create(t.owner, { title: 'Under grand', parent: grand.id });
    expect(regrand.parentId).toBe(grand.id);
    await tasks().update(t.owner, (await tasks().create(t.owner, { title: 'Loose' })).id, { parent: root.id });
    await tasks().update(t.owner, sibling.id, { status: 'done' });
    expect((await tasks().get(t.owner, root.id)).subtasks).toEqual({ total: 2, open: 1 });
  });

  it('removes a task with its subtasks, softly', async () => {
    const root = await tasks().create(t.owner, { title: 'Parent to go' });
    const child = await tasks().create(t.owner, { title: 'Child to go', parent: root.id });
    await tasks().delete(t.owner, root.id);
    expect(await codeOf(tasks().get(t.owner, root.id))).toBe('NOT_FOUND');
    expect(await codeOf(tasks().get(t.owner, child.id))).toBe('NOT_FOUND');
    expect(await codeOf(tasks().delete(t.owner, root.id))).toBe('NOT_FOUND');
    expect(await titles({ search: 'to go' })).toEqual([]);
    expect((await feed()).filter((e) => e.action === 'deleted').map((e) => e.taskId)).toEqual(
      expect.arrayContaining([root.id, child.id]),
    );
  });

  it('indexes what a task mentions and is about, and finds it back', async () => {
    const note = await t.engine.documents.create(t.owner, { title: 'Brief' });
    const other = await tasks().create(t.owner, { title: 'Related' });
    const task = await tasks().create(t.owner, {
      title: 'Follow up',
      markdown: `Talk about [the deal](record:opportunity/${dealId}) and [the brief](document:${note.id}), see [it](task:${other.id}) and [Ana](member:u_member) and [Sales](agent:a1).`,
      about: [`record:opportunity/${dealId}`],
    });
    expect(task.links).toEqual(
      expect.arrayContaining([
        { link: `record:opportunity/${dealId}`, role: 'mention' },
        { link: `record:opportunity/${dealId}`, role: 'about' },
        { link: `document:${note.id}`, role: 'mention' },
        { link: `task:${other.id}`, role: 'mention' },
      ]),
    );
    // Members are mentioned but not indexed.
    expect(task.links.some((link) => link.link.startsWith('member:') || link.link.startsWith('agent:'))).toBe(false);
    expect(task.markdown).toContain('(agent:a1)');
    expect(await codeOf(tasks().create(t.owner, { title: 'x', about: ['agent:a1'] }))).toBe('VALIDATION');
    expect(task.markdown).toContain('(member:u_member)');
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual(['Follow up']);
    expect(await titles({ mentions: `document:${note.id}` })).toEqual(['Follow up']);
    expect(await titles({ mentions: `task:${other.id}` })).toEqual(['Follow up']);
    expect(await codeOf(tasks().list(t.owner, { mentions: 'https://x.dev' }))).toBe('VALIDATION');

    // Editing the description keeps what the task is about; changing `about` keeps what the description mentions.
    await tasks().update(t.owner, task.id, { markdown: 'Plain now.' });
    expect(await titles({ mentions: `document:${note.id}` })).toEqual([]);
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual(['Follow up']);
    await tasks().update(t.owner, task.id, { about: [] });
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual([]);
    expect(await codeOf(tasks().update(t.owner, task.id, { about: [`task:${task.id}`] }))).toBe('VALIDATION');
  });

  it('comments without changing the task, and pages the timeline', async () => {
    const task = await tasks().create(t.owner, { title: 'Talk about it' });
    const first = await tasks().comment(t.member, task.id, { markdown: 'First thought' });
    expect(first).toMatchObject({ kind: 'comment', body: 'First thought', actor: { kind: 'user', id: 'u_member' } });
    await tasks().comment(t.owner, task.id, { markdown: 'Second thought' });
    await tasks().comment(t.owner, task.id, { markdown: 'Third thought' });
    expect((await tasks().get(t.owner, task.id)).version).toBe(1);
    expect(await codeOf(tasks().comment(t.owner, task.id, { markdown: '   ' }))).toBe('VALIDATION');

    const firstPage = await tasks().activity(t.owner, task.id, { limit: 2 });
    expect(firstPage.items.map((entry) => entry.body)).toEqual(['Third thought', 'Second thought']);
    const secondPage = await tasks().activity(t.owner, task.id, { limit: 2, cursor: firstPage.nextCursor as string });
    expect(secondPage.items.map((entry) => entry.kind)).toEqual(['comment', 'created']);
    expect(secondPage.nextCursor).toBeNull();
    expect(await codeOf(tasks().activity(t.owner, task.id, { cursor: 'junk' }))).toBe('INVALID_CURSOR');
    expect((await feed(task.id)).map((e) => e.action)).toEqual(['created', 'commented', 'commented', 'commented']);
  });

  describe('lists', () => {
    let a: string;

    beforeAll(async () => {
      await t.close();
      t = await createTestEngine();
      const make = (input: TaskInput) => tasks().create(t.owner, input);
      a = (await make({ title: 'Alpha', priority: 'high', dueDate: '2026-10-20', assignee: 'user:u_owner' })).id;
      await make({ title: 'Bravo', priority: 'urgent', dueDate: '2026-10-22', assignee: 'agent:a1' });
      await make({ title: 'Charlie', priority: 'low', dueDate: '2026-10-25' });
      await make({ title: 'Delta', priority: 'medium', status: 'done', dueDate: '2026-10-01' });
      await make({ title: 'Echo', priority: 'urgent', assignee: 'user:u_member' });
      await make({ title: 'Foxtrot', status: 'in_review', assignee: 'agent:a1' });
      await make({ title: 'Golf', status: 'canceled' });
      await make({ title: 'Hotel', markdown: 'needle in the body', status: 'backlog' });
    });

    it('filters by status, scope, priority and search', async () => {
      expect(await titles({ status: 'done,canceled', sort: 'title' })).toEqual(['Delta', 'Golf']);
      expect(await titles({ scope: 'closed', sort: 'title' })).toEqual(['Delta', 'Golf']);
      expect((await titles({ scope: 'open' })).length).toBe(6);
      expect(await titles({ priority: 'urgent', sort: 'title' })).toEqual(['Bravo', 'Echo']);
      expect(await titles({ search: 'needle' })).toEqual(['Hotel']);
      expect(await titles({ search: 'ALPHA' })).toEqual(['Alpha']);
      expect(await codeOf(tasks().list(t.owner, { status: 'sleeping' }))).toBe('VALIDATION');
      expect(await codeOf(tasks().list(t.owner, { priority: 'huge' }))).toBe('VALIDATION');
      expect(await codeOf(tasks().list(t.owner, { ids: 'nope' }))).toBe('VALIDATION');
    });

    it('filters by assignee', async () => {
      expect(await titles({ assignee: 'me', sort: 'title' })).toEqual(['Alpha']);
      expect(await titles({ assignee: 'me' }, t.member)).toEqual(['Echo']);
      expect(await titles({ assignee: 'agents', sort: 'title' })).toEqual(['Bravo', 'Foxtrot']);
      expect(await titles({ assignee: 'people', sort: 'title' })).toEqual(['Alpha', 'Echo']);
      expect(await titles({ assignee: 'agent:a1', sort: 'title' })).toEqual(['Bravo', 'Foxtrot']);
      expect(await titles({ assignee: 'user:u_member' })).toEqual(['Echo']);
      expect(await titles({ assignee: 'unassigned', sort: 'title' })).toEqual(['Charlie', 'Delta', 'Golf', 'Hotel']);
      expect(await titles({ assignee: 'me,agent:a1', sort: 'title' })).toEqual(['Alpha', 'Bravo', 'Foxtrot']);
      expect(await codeOf(tasks().list(t.owner, { assignee: 'robot:1' }))).toBe('VALIDATION');
    });

    it('filters by due date from the caller’s day', async () => {
      const today = '2026-10-22';
      expect(await titles({ due: 'overdue', today })).toEqual(['Alpha']);
      expect(await titles({ due: 'today', today })).toEqual(['Bravo']);
      expect(await titles({ due: 'week', today, sort: 'due' })).toEqual(['Bravo', 'Charlie']);
      expect((await titles({ due: 'none', today })).sort()).toEqual(['Echo', 'Foxtrot', 'Golf', 'Hotel']);
      expect(await codeOf(tasks().list(t.owner, { due: 'today', today: 'soon' }))).toBe('VALIDATION');
    });

    it('sorts, and pages with a cursor through every sort and order', async () => {
      expect(await titles({ sort: 'priority', order: 'asc' })).toHaveLength(8);
      expect((await titles({ sort: 'priority' })).slice(0, 2).sort()).toEqual(['Bravo', 'Echo']);
      expect(await titles({ sort: 'due', scope: 'open' })).toEqual([
        'Alpha',
        'Bravo',
        'Charlie',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]);
      expect((await titles({ sort: 'due', order: 'desc', scope: 'open' })).slice(0, 3)).toEqual([
        'Charlie',
        'Bravo',
        'Alpha',
      ]);
      expect(await titles({ sort: 'title', order: 'desc', limit: 3 })).toEqual(['Hotel', 'Golf', 'Foxtrot']);

      for (const sort of ['updated', 'created', 'due', 'priority', 'closed', 'title'] as const) {
        for (const order of ['asc', 'desc'] as const) {
          const everything = (await tasks().list(t.owner, { sort, order, limit: 100 })).items.map((item) => item.id);
          const paged: string[] = [];
          let cursor: string | undefined;

          for (let guard = 0; guard < 10; guard += 1) {
            const page = await tasks().list(t.owner, { sort, order, limit: 3, ...(cursor ? { cursor } : {}) });
            paged.push(...page.items.map((item) => item.id));

            if (!page.nextCursor) {
              break;
            }

            cursor = page.nextCursor;
          }

          expect(paged, `${sort} ${order}`).toEqual(everything);
        }
      }

      const page = await tasks().list(t.owner, { sort: 'title', limit: 3 });
      expect(page.total).toBe(8);
      expect(await codeOf(tasks().list(t.owner, { sort: 'due', cursor: page.nextCursor as string }))).toBe(
        'INVALID_CURSOR',
      );
      expect(await codeOf(tasks().list(t.owner, { cursor: 'junk' }))).toBe('INVALID_CURSOR');
    });

    it('picks tasks by id, and counts', async () => {
      expect(await titles({ ids: a })).toEqual(['Alpha']);
      const counts = await tasks().counts(t.owner, { today: '2026-10-22' });
      expect(counts).toEqual({
        open: 6,
        overdue: 1,
        dueToday: 1,
        dueThisWeek: 2,
        inReview: 1,
        mine: 1,
        agentsWorking: 0,
        byStatus: { backlog: 1, todo: 4, in_progress: 0, in_review: 1, done: 1, canceled: 1 },
      });
      expect((await tasks().counts(t.member, { today: '2026-10-22' })).mine).toBe(1);
    });
  });

  it('checks permissions: members write, keys need a task grant, workflows and modules may', async () => {
    const key = (permissions?: Record<string, string[]>): EngineContext => ({
      workspaceId: t.workspaceId,
      actor: { kind: 'api_key', id: 'k' },
      role: null,
      ...(permissions ? { apiKeyPermissions: permissions } : {}),
    });
    const workflow: EngineContext = {
      workspaceId: t.workspaceId,
      actor: { kind: 'workflow', id: 'wf_1' },
      role: null,
    };
    const stranger: EngineContext = { ...t.member, role: null };
    expect(await codeOf(tasks().list(key()))).toBe('FORBIDDEN');
    expect(await codeOf(tasks().list(key({ record: ['read'] })))).toBe('FORBIDDEN');
    expect(await codeOf(tasks().list(key({ task: ['read'] })))).toBe('ok');
    expect(await codeOf(tasks().create(key({ task: ['read'] }), { title: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(tasks().create(key({ task: ['write'] }), { title: 'From a key' }))).toBe('ok');
    expect(await codeOf(tasks().create(workflow, { title: 'From a workflow' }))).toBe('ok');
    expect(await codeOf(tasks().list(stranger))).toBe('FORBIDDEN');
  });

  describe('agent runs', () => {
    const platform = () => systemContext(t.workspaceId, 'runner');
    const agentIn = (agent: string, run: { id: string; taskId: string }): EngineContext => ({
      workspaceId: t.workspaceId,
      actor: { kind: 'agent', id: agent, onBehalfOf: { kind: 'user', id: 'u_owner' } },
      role: 'owner',
      run,
    });

    it('hands the most urgent task of an agent to the runner, one at a time, acting for who gave it', async () => {
      const low = await tasks().create(t.owner, { title: 'Low', priority: 'low', assignee: 'agent:r1' });
      const urgent = await tasks().create(t.member, { title: 'Urgent', priority: 'urgent', assignee: 'agent:r1' });
      await tasks().create(t.owner, { title: 'Parked', status: 'backlog', assignee: 'agent:r1' });
      await tasks().create(t.owner, { title: 'Not an agent’s', assignee: 'user:u_owner' });
      expect(await tasks().claimNext(platform(), [])).toBeNull();
      expect(await tasks().claimNext(platform(), ['someone-else'])).toBeNull();
      const claim = await tasks().claimNext(platform(), ['r1']);
      expect(claim).toMatchObject({ attempt: 1, requestedBy: { kind: 'user', id: 'u_member' } });
      expect(claim?.task).toMatchObject({ id: urgent.id, status: 'in_progress', work: 'working', runId: claim?.runId });
      // An agent with a task in hand gets no second one.
      expect(await tasks().claimNext(platform(), ['r1'])).toBeNull();
      expect((await tasks().get(t.owner, low.id)).status).toBe('todo');
      expect((await feed(urgent.id)).at(-1)).toMatchObject({
        action: 'status_changed',
        status: 'in_progress',
        runId: claim?.runId,
      });
      // Only the platform claims.
      expect(await codeOf(tasks().claimNext(t.owner, ['r1']))).toBe('FORBIDDEN');
    });

    it('lets the agent touch only its task and the ones below it, and hand it in for review', async () => {
      const task = await tasks().create(t.owner, { title: 'Quote Initech', assignee: 'agent:r2' });
      const other = await tasks().create(t.owner, { title: 'Unrelated' });
      const claim = await tasks().claimNext(platform(), ['r2']);
      const run = { id: claim?.runId as string, taskId: task.id };
      const agent = agentIn('r2', run);
      const sub = await tasks().create(agent, {
        title: 'Check the price list',
        parent: task.id,
        assignee: 'user:u_owner',
      });
      expect(sub.parentId).toBe(task.id);
      expect(await codeOf(tasks().create(agent, { title: 'Loose' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().create(agent, { title: 'Under another', parent: other.id }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().update(agent, other.id, { title: 'Hijacked' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().comment(agent, other.id, { markdown: 'hi' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().update(agent, task.id, { status: 'done' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().update(agent, task.id, { assignee: 'user:u_owner' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().delete(agent, sub.id))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().update(agent, task.id, { priority: 'high', markdown: 'Scoped.' }))).toBe('ok');
      expect(await codeOf(tasks().update(agent, sub.id, { assignee: null }))).toBe('ok');
      await tasks().comment(agent, task.id, { markdown: 'Looking at it.' });
      // What it wrote names the run.
      const timeline = await tasks().activity(t.owner, task.id);
      expect(timeline.items.find((entry) => entry.kind === 'comment')?.cause).toEqual({ runId: run.id });
      expect((await feed(task.id)).filter((e) => e.action === 'commented').at(-1)?.runId).toBe(run.id);

      expect(await codeOf(tasks().finish(t.owner, task.id, { summary: 'x' }))).toBe('FORBIDDEN');
      expect(await codeOf(tasks().finish(agent, task.id, { summary: '  ' }))).toBe('VALIDATION');
      const done = await tasks().finish(agent, task.id, { summary: 'Quoted 3 items.' });
      expect(done).toMatchObject({ status: 'in_review', work: null, runId: null });
      const entries = (await tasks().activity(t.owner, task.id)).items;
      expect(entries[0]).toMatchObject({ kind: 'run', body: 'Quoted 3 items.', data: { outcome: 'in_review' } });
      // A run that is no longer the task’s cannot finish it again.
      expect(await codeOf(tasks().finish(agent, task.id, { summary: 'again' }))).toBe('CONFLICT');
      // Handing it in did not change what a run that is gone could do: the task is a person's to accept.
      expect(await codeOf(tasks().update(t.owner, task.id, { status: 'done' }))).toBe('ok');
    });

    it('ends a run into review, or as failed, only while the run is still the task’s', async () => {
      const a = await tasks().create(t.owner, { title: 'Ends well', assignee: 'agent:r3' });
      const first = await tasks().claimNext(platform(), ['r3']);
      await tasks().setWaiting(platform(), a.id, first?.runId as string, true);
      expect((await tasks().get(t.owner, a.id)).work).toBe('waiting_on_you');
      await tasks().setWaiting(platform(), a.id, first?.runId as string, false);
      await tasks().endRun(platform(), a.id, 'not-the-run', { outcome: 'completed', summary: null });
      expect((await tasks().get(t.owner, a.id)).status).toBe('in_progress');
      await tasks().endRun(platform(), a.id, first?.runId as string, { outcome: 'completed', summary: 'Done it.' });
      expect(await tasks().get(t.owner, a.id)).toMatchObject({ status: 'in_review', work: null, runId: null });

      const b = await tasks().create(t.owner, { title: 'Ends badly', assignee: 'agent:r3' });
      const second = await tasks().claimNext(platform(), ['r3']);
      await tasks().endRun(platform(), b.id, second?.runId as string, {
        outcome: 'failed',
        error: 'The model refused',
      });
      expect(await tasks().get(t.owner, b.id)).toMatchObject({ work: 'failed', runId: null, status: 'in_progress' });
      expect((await feed(b.id)).at(-1)?.action).toBe('run_failed');
      // A failed task is not taken again until someone retries it.
      expect(await tasks().claimNext(platform(), ['r3'])).toBeNull();
      expect(await codeOf(tasks().retry(t.owner, a.id))).toBe('CONFLICT');
      const retried = await tasks().retry(t.member, b.id);
      expect(retried).toMatchObject({ status: 'todo', work: null });
      const again = await tasks().claimNext(platform(), ['r3']);
      expect(again).toMatchObject({ attempt: 1, requestedBy: { kind: 'user', id: 'u_member' } });
      expect(again?.task.id).toBe(b.id);
    });

    it('drops the run when a person stops the agent, moves the task or reassigns it', async () => {
      const stopped = await tasks().create(t.owner, { title: 'Stopped', assignee: 'agent:r4' });
      const claim = await tasks().claimNext(platform(), ['r4']);
      expect(await codeOf(tasks().stop(t.owner, (await tasks().create(t.owner, { title: 'Idle' })).id))).toBe(
        'CONFLICT',
      );
      const after = await tasks().stop(t.owner, stopped.id);
      expect(after).toMatchObject({ work: 'failed', runId: null });
      await tasks().endRun(platform(), stopped.id, claim?.runId as string, { outcome: 'completed', summary: 'late' });
      expect((await tasks().get(t.owner, stopped.id)).status).toBe('in_progress');

      const moved = await tasks().create(t.owner, { title: 'Moved', assignee: 'agent:r5' });
      await tasks().claimNext(platform(), ['r5']);
      expect(await tasks().update(t.owner, moved.id, { status: 'backlog' })).toMatchObject({ work: null, runId: null });

      const handed = await tasks().create(t.owner, { title: 'Handed', assignee: 'agent:r6' });
      await tasks().claimNext(platform(), ['r6']);
      expect(await tasks().update(t.owner, handed.id, { assignee: 'user:u_owner' })).toMatchObject({
        work: null,
        runId: null,
      });
    });
  });

  it('shows one line per write on the timeline, with each field’s old and new value, and keeps it out of the feed', async () => {
    const task = await tasks().create(t.owner, { title: 'Before', markdown: 'First text.', priority: 'low' });
    await tasks().update(t.owner, task.id, {
      title: 'After',
      status: 'in_progress',
      assignee: 'user:u_member',
      priority: 'high',
      markdown: 'Second text, which is long and not shown.',
    });
    const entries = (await tasks().activity(t.owner, task.id)).items;
    // The update made four events for the feed (updated, status_changed, assigned…) and one line.
    expect(entries.map((entry) => entry.kind)).toEqual(['changed', 'created']);
    expect(entries[0]?.data).toEqual({
      changes: [
        { field: 'title', from: 'Before', to: 'After' },
        { field: 'description' },
        { field: 'priority', from: 'low', to: 'high' },
        { field: 'status', from: 'todo', to: 'in_progress' },
        { field: 'assignee', from: null, to: 'user:u_member' },
      ],
    });
    expect(entries[0]?.id).toMatch(/^e\d+$/);
    const events = (await feed(task.id)).map((event) => event.action);
    expect(events).toEqual(['created', 'updated', 'status_changed', 'assigned']);
    // What the feed returns is a fixed set of fields: no diff, no text.
    for (const event of await feed(task.id)) {
      expect(Object.keys(event).sort()).not.toContain('diff');
      expect(JSON.stringify(event)).not.toContain('Second text');
    }
  });

  it('pages a timeline of events and comments, even when they share a moment', async () => {
    const task = await tasks().create(t.owner, { title: 'Busy' });
    await tasks().update(t.owner, task.id, { priority: 'urgent' });
    const moment = '2026-10-22T12:00:00.000Z';

    for (let i = 0; i < 5; i += 1) {
      await t.client.query(
        `INSERT INTO comment (id, workspace_id, entity_kind, entity_id, actor, body, created_at)
         VALUES ($1, $2, 'task', $3, '{"kind":"user","id":"u_owner"}', $4, $5)`,
        [`00000000-0000-7000-8000-00000000000${i}`, t.workspaceId, task.id, `Comment ${i}`, moment],
      );
    }

    const all = (await tasks().activity(t.owner, task.id, { limit: 100 })).items.map((entry) => entry.id);
    expect(all).toHaveLength(7);
    const paged: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 10; guard += 1) {
      const page = await tasks().activity(t.owner, task.id, { limit: 3, ...(cursor ? { cursor } : {}) });
      paged.push(...page.items.map((entry) => entry.id));

      if (!page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
    }

    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(7);
  });

  it('keeps the names task and member for what mentions point at', async () => {
    for (const name of ['task', 'member', 'agent']) {
      expect(
        await codeOf(
          t.engine.metadata.objects.create(t.owner, {
            nameSingular: name,
            namePlural: `${name}s`,
            labelSingular: name,
            labelPlural: `${name}s`,
          }),
        ),
        name,
      ).toBe('VALIDATION');
    }
  });

  it('is emptied with the workspace', async () => {
    const other = await createTestEngine();

    try {
      const parent = await other.engine.tasks.create(other.owner, { title: 'P' });
      await other.engine.tasks.create(other.owner, {
        title: 'C',
        parent: parent.id,
        markdown: `[x](task:${parent.id})`,
      });
      await other.engine.tasks.comment(other.owner, parent.id, { markdown: 'hi' });
      await other.engine.workspaces.purge(other.workspaceId);
      const rows = await other.client.query<{ n: number }>(
        'SELECT (SELECT count(*) FROM task)::int + (SELECT count(*) FROM mention)::int + (SELECT count(*) FROM comment)::int AS n',
      );
      expect(rows.rows[0]?.n).toBe(0);
    } finally {
      await other.close();
    }
  });
});
