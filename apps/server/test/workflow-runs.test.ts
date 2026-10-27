import { coreIds, defineModule } from '@devias/core';
import { type EngineContext, EngineError } from '@devias/data-engine';
import { defineActionHandler, defineModuleServer, RetryableError } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { createWorkflowRunner, type WorkflowActionsPort } from '../src/runtime/workflow-runner';
import { choresManifest } from './chores';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

interface RunStepView {
  id: string;
  status: string;
  attempt?: number;
  retryAt?: string;
}

const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many steps run at once, across every runner that shares the gauge. */
const gauge = () => ({ active: 0, peak: 0 });

/** A stand-in for the action registry: it notes which step ran, and how many ran at once. */
const stub = (
  behave: (input: Record<string, unknown>) => Promise<unknown> | unknown = () => null,
  shared = gauge(),
) => {
  const calls: string[] = [];
  const steps: NonNullable<EngineContext['step']>[] = [];
  const port: WorkflowActionsPort = {
    invoke: async (ctx, actionId, input) => {
      const values = input as Record<string, unknown>;

      if (ctx.step) {
        steps.push(ctx.step);
      }

      calls.push(String((values.values as Record<string, unknown> | undefined)?.title ?? actionId));
      shared.active += 1;
      shared.peak = Math.max(shared.peak, shared.active);

      try {
        return (await behave(values)) ?? { done: true };
      } finally {
        shared.active -= 1;
      }
    },
  };

  return { port, calls, steps };
};

describe('durable workflow runs', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let workspaceId: string;

  beforeAll(async () => {
    server = await createTestServer();
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    const workspace = await createWorkspace(api, 'Acme', 'acme');
    workspaceId = workspace.id;
    base = `/api/workspaces/${workspace.id}`;
  });
  afterAll(() => server.close());

  const runner = (port: WorkflowActionsPort, leaseMs = 60_000) =>
    createWorkflowRunner({ engine: server.engine, actions: port, logger: silent, leaseMs });

  const step = (title: string) => ({
    kind: 'action',
    actionId: coreIds.actions.create_record,
    input: { object: 'chore', values: { title } },
  });

  /** Starts on chores created with a title that begins with `prefix`, so the tests do not trigger each other. */
  const onChores = (prefix: string) => ({
    kind: 'record_event',
    objectId: 'chore',
    types: ['record.created'],
    condition: { field: 'title', op: 'starts_with', value: prefix },
  });

  const workflow = async (title: string, steps: unknown[], trigger: unknown) => {
    const created = await api(`${base}/workflows`, { body: { title, trigger, steps } });
    expect(created.status).toBe(201);

    return (created.json as { id: string }).id;
  };

  const runsOf = async (id: string) =>
    (
      (await api(`${base}/workflows/${id}/runs`)).json as {
        items: { id: string; status: string; error?: string; steps: RunStepView[] }[];
      }
    ).items;

  /** A trigger reads the log from where it was created: one pass lets it settle before the test makes its events. */
  const arm = (idle: ReturnType<typeof runner>) => idle.runOnce(workspaceId);

  it('queues a run per event, records it as it goes, and does not run the same event twice', async () => {
    const id = await workflow('Two steps', [step('first'), step('second')], onChores('Trigger'));
    const { port, calls } = stub();
    const r = runner(port);
    await arm(r);
    await api(`${base}/records/chore`, { body: { title: 'Trigger one' } });

    expect(await r.runOnce(workspaceId)).toBe(1);
    expect(calls).toEqual(['first', 'second']);
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run?.steps).toHaveLength(2);

    // The cursor has moved past the event; pushing it back replays the event, which the run's key refuses.
    await server.engine.workflows.enqueueRuns(workspaceId, id, [], { cursor: 0 });
    expect(await r.runOnce(workspaceId)).toBe(0);
    expect(await runsOf(id)).toHaveLength(1);
  });

  it('goes on after the steps a stopped runner had settled, and the stopped runner cannot finish it', async () => {
    const id = await workflow(
      'Resumable',
      [
        step('A'),
        {
          id: 'lane',
          kind: 'branch',
          condition: { field: 'title', op: 'starts_with', value: 'Resume' },
          yes: [step('B')],
          no: [step('never')],
        },
        step('C'),
      ],
      onChores('Resume'),
    );
    // The first runner reaches B and hangs there for good, as a process that was killed would.
    let release: (() => void) | undefined;
    const first = stub((values) =>
      (values.values as { title?: string } | undefined)?.title === 'B'
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : null,
    );
    // The second runner pauses at C, so the first wakes up while the run is in the second's hands.
    let releaseC: (() => void) | undefined;
    const second = stub((values) =>
      (values.values as { title?: string } | undefined)?.title === 'C'
        ? new Promise<void>((resolve) => {
            releaseC = resolve;
          })
        : null,
    );
    const dead = runner(first.port, 50);
    const alive = runner(second.port, 5000);
    await arm(dead);
    await api(`${base}/records/chore`, { body: { title: 'Resume me' } });

    const stuck = dead.runOnce(workspaceId);
    await sleep(30);
    expect(first.calls).toEqual(['A', 'B']);
    expect((await runsOf(id))[0]).toMatchObject({ status: 'running' });

    // Its lease lapses (the runner is gone, as far as the database can tell); another runner takes the run and goes
    // on at B, without running A or deciding the lane again.
    await sleep(80);
    const taking = alive.runOnce(workspaceId);
    await sleep(60);
    expect(second.calls).toEqual(['B', 'C']);

    // The first runner wakes up to find the run in other hands: it does not go on to C or write over the run.
    release?.();
    await stuck;
    expect(first.calls).toEqual(['A', 'B']);

    releaseC?.();
    expect(await taking).toBe(1);
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run?.steps).toHaveLength(4);
    expect(await runsOf(id)).toHaveLength(1);
  });

  it('never works on one run twice, nor on two runs of a workspace at once, across runners', async () => {
    const id = await workflow('Busy', [step('work')], onChores('Busy'));
    const slow = () => sleep(15);
    const shared = gauge();
    const a = stub(slow, shared);
    const b = stub(slow, shared);
    const first = runner(a.port);
    const second = runner(b.port);
    await arm(first);

    for (let i = 0; i < 6; i += 1) {
      await api(`${base}/records/chore`, { body: { title: `Busy ${i}` } });
    }

    const [x, y] = await Promise.all([first.runOnce(workspaceId), second.runOnce(workspaceId)]);
    expect(x + y).toBe(6);
    expect(a.calls.length + b.calls.length).toBe(6);
    // One run at a time in the workspace: while a runner works, the other finds a live lease and leaves.
    expect(shared.peak).toBe(1);
    const runs = await runsOf(id);
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map((run) => run.status))).toEqual(new Set(['succeeded']));
  });

  it('fails the runs of a workflow that was turned off before they ran', async () => {
    const id = await workflow('Switched off', [step('late')], onChores('Late'));
    const { port, calls } = stub();
    const r = runner(port);
    // Queue a run without carrying it out, then switch the workflow off.
    await server.engine.workflows.enqueueRuns(workspaceId, id, [{ trigger: { kind: 'manual' }, key: 'by-hand' }]);
    await api(`${base}/workflows/${id}`, { method: 'PATCH', body: { enabled: false } });

    await r.runOnce(workspaceId);
    expect(calls).toEqual([]);
    expect((await runsOf(id))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('turned off') });
  });

  it('gives up on a run that keeps stopping its runner', async () => {
    const id = await workflow('Poison', [step('boom')], onChores('Poison'));
    const { port, calls } = stub();
    const r = runner(port, 20);
    await server.engine.workflows.enqueueRuns(workspaceId, id, [{ trigger: { kind: 'manual' }, key: 'poison' }]);

    // Six runners take it in turn and vanish.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const held = await server.engine.workflows.claimRun(workspaceId, 20);
      expect(held?.attempt).toBe(attempt);
      await sleep(35);
    }

    await r.runOnce(workspaceId);
    expect(calls).toEqual([]);
    expect((await runsOf(id))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('too many times') });
  });

  /** A failure its action says is worth another try, with the delay it suggests. */
  const busy = (afterMs?: number) =>
    new EngineError('NETWORK', 'Service is busy', {
      retryable: true,
      ...(afterMs === undefined ? {} : { retryAfterMs: afterMs }),
    });

  it('tries a step again later when its action asks for it, and goes on from that step', async () => {
    const id = await workflow('Flaky', [step('A'), step('B'), step('C')], onChores('Flaky'));
    let failures = 2;
    const { port, calls, steps } = stub((values) => {
      if ((values.values as { title?: string }).title === 'B' && failures > 0) {
        failures -= 1;

        throw busy(1500);
      }

      return null;
    });
    const r = runner(port);
    await arm(r);
    await api(`${base}/records/chore`, { body: { title: 'Flaky one' } });

    // The first try fails: the run waits, with the step marked and when it will be tried.
    expect(await r.runOnce(workspaceId)).toBe(1);
    let [run] = await runsOf(id);
    expect(run).toMatchObject({ status: 'pending' });
    expect(run?.steps).toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({
        status: 'retrying',
        attempt: 1,
        error: expect.stringContaining('busy'),
        retryAt: expect.any(String),
      }),
    ]);
    // Not before it is due.
    expect(await r.runOnce(workspaceId)).toBe(0);

    await sleep(1600);
    expect(await r.runOnce(workspaceId)).toBe(1);
    expect((await runsOf(id))[0]).toMatchObject({ status: 'pending' });
    await sleep(1600);
    expect(await r.runOnce(workspaceId)).toBe(1);
    [run] = await runsOf(id);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run?.steps.map((item) => [item.status, item.attempt])).toEqual([
      ['succeeded', undefined],
      ['succeeded', 3],
      ['succeeded', undefined],
    ]);
    // A ran once; B three times, each told which try it is and the same key; C once.
    expect(calls).toEqual(['A', 'B', 'B', 'B', 'C']);
    const b = steps.filter((call) => call.stepId === run?.steps[1]?.id);
    expect(b.map((call) => call.attempt)).toEqual([1, 2, 3]);
    expect(new Set(b.map((call) => call.key)).size).toBe(1);
    expect(b[0]).toMatchObject({ runId: run?.id, maxAttempts: 6, key: `${run?.id}:${run?.steps[1]?.id}` });
  });

  it('waits the default backoff when the action names no delay, and gives up after the last retry', async () => {
    const id = await workflow('Always busy', [step('X')], onChores('Always'));
    const { port, calls } = stub(() => {
      throw busy(1);
    });
    const r = runner(port);
    await arm(r);
    await api(`${base}/records/chore`, { body: { title: 'Always busy' } });

    for (let i = 0; i < 60 && (await runsOf(id))[0]?.status !== 'failed'; i += 1) {
      await r.runOnce(workspaceId);
      await sleep(10);
    }

    // The first try and five retries.
    expect(calls).toHaveLength(6);
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ status: 'failed', error: expect.stringContaining('Service is busy') });
    expect(run?.steps).toEqual([expect.objectContaining({ status: 'failed', attempt: 6 })]);

    // Without a suggested delay the wait is the default: half a minute for the first retry.
    const other = await workflow('Default wait', [step('Y')], onChores('Default'));
    const unsure = stub(() => {
      throw busy();
    });
    const slow = runner(unsure.port);
    await arm(slow);
    await api(`${base}/records/chore`, { body: { title: 'Default wait' } });
    await slow.runOnce(workspaceId);
    const waiting = (await runsOf(other))[0]?.steps[0];
    expect(waiting).toMatchObject({ status: 'retrying' });
    const wait = Date.parse(waiting?.retryAt ?? '') - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThanOrEqual(30_000);
    expect(await slow.runOnce(workspaceId)).toBe(0);
  });

  it('does not retry a failure its action did not mark as retryable', async () => {
    const id = await workflow('Plain failure', [step('Z')], onChores('Plain'));
    const { port, calls } = stub(() => {
      throw new EngineError('NETWORK', 'Gateway down');
    });
    const r = runner(port);
    await arm(r);
    await api(`${base}/records/chore`, { body: { title: 'Plain failure' } });
    await r.runOnce(workspaceId);
    await r.runOnce(workspaceId);
    expect(calls).toEqual(['Z']);
    expect((await runsOf(id))[0]).toMatchObject({ status: 'failed' });
  });

  it('queues one run per fire time of a schedule, and refuses the same tick twice', async () => {
    const id = await workflow('Every hour', [step('tick')], { kind: 'schedule', cron: '0 * * * *' });
    const { port, calls } = stub();
    const r = runner(port);
    const fire = new Date(Date.now() - 1000);
    await server.engine.workflows.enqueueRuns(workspaceId, id, [], { nextRunAt: fire });

    expect(await r.runOnce(workspaceId)).toBe(1);
    expect(calls).toEqual(['tick']);
    // The same tick booked again (as a crash between booking and finishing would leave it) does not run twice.
    await server.engine.workflows.enqueueRuns(workspaceId, id, [], { nextRunAt: fire });
    expect(await r.runOnce(workspaceId)).toBe(0);
    expect(await runsOf(id)).toHaveLength(1);
  });
  it('queues a run by hand without waiting, shows it as open on its record, and finishes it when a runner takes it', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Tidy a chore',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'chore', id: '{{record.id}}', values: { status: 'done' } },
          },
        ],
      },
    });
    const id = (created.json as { id: string }).id;
    const chore = (await api(`${base}/records/chore`, { body: { title: 'Tidy me' } })).json as { id: string };

    const queued = await api(`${base}/workflows/${id}/run`, { body: { recordId: chore.id, wait: false } });
    expect(queued.status).toBe(201);
    expect(queued.json).toMatchObject({
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      trigger: { recordId: chore.id },
    });
    // Nothing has run yet: the record is as it was, and the run is open on it.
    expect(((await api(`${base}/records/chore/${chore.id}`)).json as { status: string }).status).toBe('todo');
    // A table asks the same of the whole object: which of its records have runs open.
    const objectId = (queued.json as { trigger: { objectId: string } }).trigger.objectId;
    const ofObject = (await api(`${base}/workflow-runs?objectId=${objectId}&state=open`)).json as {
      items: { trigger: { recordId: string } }[];
    };
    expect(ofObject.items.map((run) => run.trigger.recordId)).toContain(chore.id);
    const open = (await api(`${base}/workflow-runs?recordId=${chore.id}&state=open`)).json as {
      items: { id: string; status: string }[];
    };
    expect(open.items).toEqual([
      expect.objectContaining({ id: (queued.json as { id: string }).id, status: 'pending' }),
    ]);

    // A runner takes it: the record is updated, and the run is no longer open.
    expect(await server.workflows.runOnce(workspaceId)).toBeGreaterThanOrEqual(1);
    expect(((await api(`${base}/records/chore/${chore.id}`)).json as { status: string }).status).toBe('done');
    expect(
      ((await api(`${base}/workflow-runs?recordId=${chore.id}&state=open`)).json as { items: unknown[] }).items,
    ).toEqual([]);
    const all = (await api(`${base}/workflow-runs?recordId=${chore.id}`)).json as { items: { status: string }[] };
    expect(all.items).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    // Waiting for the result, as before, still returns it finished.
    const waited = await api(`${base}/workflows/${id}/run`, { body: { recordId: chore.id } });
    expect(waited.json).toMatchObject({ status: 'succeeded' });
    const stillOpen = (await api(`${base}/workflow-runs?objectId=${objectId}&state=open`)).json as {
      items: { trigger: { recordId: string } }[];
    };
    expect(stillOpen.items.map((run) => run.trigger.recordId)).not.toContain(chore.id);
    // A query about nothing in particular is refused.
    expect((await api(`${base}/workflow-runs`)).status).toBe(400);
  });
});

const FLAKY_MODULE = '01a17e37-7f2b-70d8-bad8-69f1837f4f2a';
const FLAKY_ACTION = '01a17e37-7f2c-757d-9402-00f063553e06';

describe('a module action that asks to be tried again', () => {
  const seen: { attempt: number; key: string }[] = [];
  const flaky = defineModuleServer(
    defineModule({
      id: FLAKY_MODULE,
      version: '0.1.0',
      actions: [{ id: FLAKY_ACTION, name: 'sync', label: 'Sync', input: [], external: false }],
    }),
    {
      actions: [
        defineActionHandler({
          id: FLAKY_ACTION,
          input: z.object({}),
          run: (_input, ctx) => {
            seen.push({ attempt: ctx.step?.attempt ?? 0, key: ctx.step?.key ?? '' });

            if (seen.length < 2) {
              throw new RetryableError('Rate limited', 10);
            }

            return { synced: true };
          },
        }),
      ],
    },
  );
  let server: Server;
  let api: Api;
  let base: string;
  let workspaceId: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [flaky], builtin: [choresManifest], pgliteDataDir: 'memory://' },
    );
    const owner = await signUp(server, 'owner@flaky.test');
    api = client(server, { cookie: owner.cookie });
    const workspace = await createWorkspace(api, 'Flaky', 'flaky');
    workspaceId = workspace.id;
    base = `/api/workspaces/${workspace.id}`;
  });
  afterAll(() => server.close());

  it('is tried again by the workflow that runs it, as the same step', async () => {
    expect((await api(`${base}/modules/apply`, { body: { manifest: flaky.manifest } })).status).toBe(200);
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Sync by hand',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [{ kind: 'action', actionId: FLAKY_ACTION, input: {} }],
      },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const workflowId = (created.json as { id: string }).id;
    const chore = (await api(`${base}/records/chore`, { body: { title: 'Anything' } })).json as { id: string };

    const started = await api(`${base}/workflows/${workflowId}/run`, { body: { recordId: chore.id } });
    expect(started.status).toBe(201);
    expect(started.json).toMatchObject({ status: 'pending', steps: [{ status: 'retrying', attempt: 1 }] });

    await sleep(30);
    expect(await server.workflows.runOnce(workspaceId)).toBe(1);
    const runs = (await api(`${base}/workflows/${workflowId}/runs`)).json as {
      items: { status: string; steps: unknown[] }[];
    };
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      steps: [{ status: 'succeeded', attempt: 2, output: { synced: true } }],
    });
    expect(seen.map((call) => call.attempt)).toEqual([1, 2]);
    expect(new Set(seen.map((call) => call.key)).size).toBe(1);
  });
});
