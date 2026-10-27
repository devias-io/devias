import { coreIds, type WorkflowRunTrigger } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError, readEventsAfter } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const manual: WorkflowRunTrigger = { kind: 'manual' };

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    return error instanceof EngineError ? error.code : 'other';
  }
};

describe('workflow runs as a queue on PGlite', () => {
  let t: TestEngine;
  let workflowId: string;

  beforeAll(async () => {
    t = await createTestEngine();
    const workflow = await t.engine.workflows.create(t.owner, {
      title: 'Queue',
      trigger: { kind: 'record_event', objectId: 'person', types: ['record.created'] },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'chore', values: { title: 'x' } },
        },
      ],
    });
    workflowId = workflow.id;
  });
  afterAll(() => t.close());

  const runs = async () => (await t.engine.workflows.listRuns(t.owner, workflowId, { limit: 200 })).items;

  it('queues runs and moves the cursor in one transaction, announcing each run as pending', async () => {
    const before = await t.engine.events.currentSequence(t.workspaceId);
    const queued = await t.engine.workflows.enqueueRuns(
      t.workspaceId,
      workflowId,
      [
        { trigger: manual, key: 'one', context: { record: { id: 'r1' } } },
        { trigger: manual, key: 'two' },
      ],
      { cursor: before + 10 },
    );
    expect(queued).toBe(2);
    expect(await t.engine.workflows.getCursor(t.workspaceId, workflowId)).toBe(before + 10);
    const items = await runs();
    expect(items.map((run) => run.status)).toEqual(['pending', 'pending']);
    expect(items[0]).toMatchObject({ startedAt: null, finishedAt: null, steps: [] });
    expect(await t.engine.workflows.openRuns(t.workspaceId, workflowId)).toBe(2);
    const events = await readEventsAfter(t.db, t.workspaceId, before, 10);
    expect(events).toEqual([
      expect.objectContaining({ type: 'workflow.run', workflowId, status: 'pending' }),
      expect.objectContaining({ type: 'workflow.run', workflowId, status: 'pending' }),
    ]);
  });

  it('keeps nothing of a batch that fails halfway: no runs, and the cursor stays', async () => {
    const cursor = await t.engine.workflows.getCursor(t.workspaceId, workflowId);
    const open = await t.engine.workflows.openRuns(t.workspaceId, workflowId);
    const poison = { record: { amount: 10n } };

    await expect(
      t.engine.workflows.enqueueRuns(
        t.workspaceId,
        workflowId,
        [
          { trigger: manual, key: 'fine' },
          { trigger: manual, key: 'poison', context: poison },
        ],
        { cursor: (cursor ?? 0) + 99 },
      ),
    ).rejects.toThrow();
    expect(await t.engine.workflows.getCursor(t.workspaceId, workflowId)).toBe(cursor);
    expect(await t.engine.workflows.openRuns(t.workspaceId, workflowId)).toBe(open);
  });

  it('refuses a key the workflow has used, and says how many it queued', async () => {
    expect(await t.engine.workflows.enqueueRuns(t.workspaceId, workflowId, [{ trigger: manual, key: 'one' }])).toBe(0);
    expect(
      await t.engine.workflows.enqueueRuns(t.workspaceId, workflowId, [
        { trigger: manual, key: 'one' },
        { trigger: manual, key: 'three' },
      ]),
    ).toBe(1);
    // Runs without a key are never the same run.
    expect(
      await t.engine.workflows.enqueueRuns(t.workspaceId, workflowId, [{ trigger: manual }, { trigger: manual }]),
    ).toBe(2);
  });

  it('hands out the oldest run, one at a time per workspace, and fences a runner that lost its lease', async () => {
    const first = await t.engine.workflows.claimRun(t.workspaceId, 1500);
    expect(first).toMatchObject({ attempt: 1, workflowId });
    // A live lease holds the workspace: nothing else is handed out.
    expect(await t.engine.workflows.claimRun(t.workspaceId, 1500)).toBeNull();

    // The lease lapses: the same run is handed out again, and the first holder can no longer write to it.
    await sleep(1600);
    const second = await t.engine.workflows.claimRun(t.workspaceId, 60_000);
    expect(second).toMatchObject({ id: first?.id, attempt: 2 });
    const stale = first as NonNullable<typeof first>;
    const lost = (error: unknown) => error instanceof EngineError && error.code === 'CONFLICT';
    await expect(t.engine.workflows.saveRun(t.workspaceId, stale, 60_000, { steps: [] })).rejects.toSatisfy(lost);
    await expect(
      t.engine.workflows.finishRun(t.workspaceId, stale, { status: 'succeeded', steps: [] }),
    ).rejects.toSatisfy(lost);

    // The holder saves what settled, then finishes; the next run in line is handed out.
    const held = second as NonNullable<typeof second>;
    await t.engine.workflows.saveRun(t.workspaceId, held, 60_000, {
      steps: [{ id: 's1', kind: 'action', status: 'succeeded', output: { id: 'x' } }],
      context: { record: { id: 'r9' } },
    });
    const finished = await t.engine.workflows.finishRun(t.workspaceId, held, {
      status: 'succeeded',
      steps: [{ id: 's1', kind: 'action', status: 'succeeded', output: { id: 'x' } }],
    });
    expect(finished).toMatchObject({ id: held.id, status: 'succeeded', finishedAt: expect.any(String) });
    expect(finished.startedAt).not.toBeNull();
    const next = await t.engine.workflows.claimRun(t.workspaceId, 60_000);
    expect(next).toMatchObject({ attempt: 1 });
    expect(next?.id).not.toBe(held.id);
    const last = await t.engine.workflows.finishRun(t.workspaceId, next as NonNullable<typeof next>, {
      status: 'failed',
      steps: [],
      error: 'x',
    });
    expect((await t.engine.workflows.get(t.owner, workflowId)).lastRunAt).toBe(last.finishedAt);
  });

  it('hands a resumed run the steps and the context its predecessor saved', async () => {
    // Drain what is left, then queue one run, save progress on it and let the lease lapse.
    for (;;) {
      const left = await t.engine.workflows.claimRun(t.workspaceId, 60_000);

      if (!left) {
        break;
      }

      await t.engine.workflows.finishRun(t.workspaceId, left, { status: 'failed', steps: [], error: 'drained' });
    }

    await t.engine.workflows.enqueueRuns(t.workspaceId, workflowId, [
      { trigger: manual, context: { record: { id: 'a' } } },
    ]);
    const stopped = (await t.engine.workflows.claimRun(t.workspaceId, 800)) as NonNullable<
      Awaited<ReturnType<typeof t.engine.workflows.claimRun>>
    >;
    await t.engine.workflows.saveRun(t.workspaceId, stopped, 800, {
      steps: [{ id: 's1', kind: 'action', status: 'succeeded', output: { id: 'a', city: 'Oslo' } }],
      context: { record: { id: 'a', city: 'Oslo' } },
    });
    await sleep(900);
    const resumed = await t.engine.workflows.claimRun(t.workspaceId, 60_000);
    expect(resumed).toMatchObject({
      id: stopped.id,
      attempt: 2,
      steps: [{ id: 's1', status: 'succeeded' }],
      context: { record: { id: 'a', city: 'Oslo' } },
    });
  });

  it('starts a run for a caller at once: leased to them, so the queue leaves the workspace alone', async () => {
    const held = await t.engine.workflows.startRun(t.workspaceId, workflowId, { trigger: manual }, 60_000);
    expect(held).toMatchObject({ attempt: 1 });
    expect((await runs()).find((run) => run.id === held.id)).toMatchObject({ status: 'running' });
    expect(await t.engine.workflows.claimRun(t.workspaceId, 60_000)).toBeNull();
    await t.engine.workflows.finishRun(t.workspaceId, held, { status: 'failed', steps: [], error: 'x' });
  });

  it('reports a workflow by its last finished run, not by one still waiting', async () => {
    await t.engine.workflows.enqueueRuns(t.workspaceId, workflowId, [{ trigger: manual }]);
    const activity = await t.engine.workflows.activity(t.owner);
    const health = activity.workflows.find((item) => item.workflowId === workflowId);
    expect(health).toBeDefined();
    expect(health?.lastStatus).toBe('failed');
  });
  it('lists the runs about a record whichever workflow they belong to, and only the open ones on request', async () => {
    const other = await t.engine.workflows.create(t.owner, {
      title: 'Another',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        { kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: { title: 'y' } } },
      ],
    });
    const about = (recordId: string): WorkflowRunTrigger => ({ kind: 'manual', objectId: 'person', recordId });
    // One queued by the API, one started for a caller, one that has finished, and one about another record.
    const queued = await t.engine.workflows.queueRun(t.workspaceId, workflowId, { trigger: about('rec-1') });
    expect(queued).toMatchObject({ status: 'pending', startedAt: null, finishedAt: null });
    const held = await t.engine.workflows.startRun(t.workspaceId, other.id, { trigger: about('rec-1') }, 60_000);
    await t.engine.workflows.recordRun(t.workspaceId, {
      workflowId,
      status: 'succeeded',
      trigger: about('rec-1'),
      steps: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    await t.engine.workflows.queueRun(t.workspaceId, workflowId, { trigger: about('rec-2') });

    const all = await t.engine.workflows.listRecordRuns(t.member, { recordId: 'rec-1' });
    expect(all.items.map((run) => run.status)).toEqual(['succeeded', 'running', 'pending']);
    expect(new Set(all.items.map((run) => run.workflowId))).toEqual(new Set([workflowId, other.id]));
    // Open: waiting or being worked on.
    const open = await t.engine.workflows.listRecordRuns(t.member, { recordId: 'rec-1', state: 'open' });
    expect(open.items.map((run) => run.status)).toEqual(['running', 'pending']);
    expect((await t.engine.workflows.listRecordRuns(t.member, { recordId: 'rec-1', limit: 1 })).items).toHaveLength(1);

    // Finishing a run takes it out of the open ones.
    await t.engine.workflows.finishRun(t.workspaceId, held, { status: 'succeeded', steps: [] });
    expect(
      (await t.engine.workflows.listRecordRuns(t.member, { recordId: 'rec-1', state: 'open' })).items,
    ).toHaveLength(1);
    expect((await t.engine.workflows.listRecordRuns(t.member, { recordId: 'nothing' })).items).toEqual([]);

    // The runs about any record of the object, which is how a table tells which of its rows are being worked on.
    const ofObject = await t.engine.workflows.listRecordRuns(t.member, { objectId: 'person', state: 'open' });
    expect(new Set(ofObject.items.map((run) => run.trigger.recordId))).toEqual(new Set(['rec-1', 'rec-2']));
    expect(ofObject.items.every((run) => run.status === 'pending' || run.status === 'running')).toBe(true);
    expect((await t.engine.workflows.listRecordRuns(t.member, { objectId: 'company' })).items).toEqual([]);
    // Both given: the runs about that record of that object.
    expect(
      (await t.engine.workflows.listRecordRuns(t.member, { objectId: 'person', recordId: 'rec-2' })).items,
    ).toHaveLength(1);
    // Neither: there is nothing to look for.
    expect(await codeOf(t.engine.workflows.listRecordRuns(t.member, {}))).toBe('VALIDATION');
  });

  it('announces a queued run as pending on the change feed', async () => {
    const before = await t.engine.events.currentSequence(t.workspaceId);
    const run = await t.engine.workflows.queueRun(t.workspaceId, workflowId, { trigger: manual });
    const events = await readEventsAfter(t.db, t.workspaceId, before, 10);
    expect(events).toEqual([expect.objectContaining({ type: 'workflow.run', runId: run.id, status: 'pending' })]);
  });
});
