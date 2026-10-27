import { calendarDay, coreIds, type Workflow } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError, readEventsAfter } from '../src';
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

const followUp = {
  title: 'Follow up on new people',
  trigger: { kind: 'record_event', objectId: 'person', types: ['record.created'] },
  steps: [
    {
      kind: 'action',
      actionId: coreIds.actions.create_record,
      input: { object: 'chore', values: { title: 'Call {{record.first_name}}', person: '{{record.id}}' } },
    },
  ],
};

describe('workflows on PGlite', () => {
  let t: TestEngine;

  beforeAll(async () => {
    t = await createTestEngine();
  });
  afterAll(() => t.close());

  it('creates a workflow with step ids, a cursor at the current sequence and a change-feed event', async () => {
    const before = await t.engine.events.currentSequence(t.workspaceId);
    const workflow = await t.engine.workflows.create(t.owner, followUp);
    expect(workflow).toMatchObject({
      title: 'Follow up on new people',
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      trigger: { kind: 'record_event', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8', types: ['record.created'] },
    });
    expect(workflow.steps[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await t.engine.workflows.getCursor(t.workspaceId, workflow.id)).toBe(before);
    const events = await readEventsAfter(t.db, t.workspaceId, before, 10);
    expect(events).toEqual([
      expect.objectContaining({ type: 'workflow.changed', workflowId: workflow.id, action: 'created' }),
    ]);
    expect(await t.engine.workflows.list(t.member)).toEqual([workflow]);
    expect(await t.engine.workflows.get(t.member, workflow.id)).toEqual(workflow);
    expect((await t.engine.workflows.listEnabled(t.workspaceId)).map((w) => w.id)).toContain(workflow.id);
  });

  it('checks the trigger and the steps against the metadata', async () => {
    const create = (input: unknown) => t.engine.workflows.create(t.owner, input);
    expect(await codeOf(create({ ...followUp, trigger: { ...followUp.trigger, objectId: 'ghost' } }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(create({ ...followUp, trigger: { ...followUp.trigger, fieldIds: ['nope'] } }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(
        create({
          ...followUp,
          trigger: { ...followUp.trigger, condition: { field: 'first_name', op: 'gt', value: 1 } },
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({
          ...followUp,
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: { nope: 1 } },
            },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({
          ...followUp,
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: { id: 'x' } },
            },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({
          ...followUp,
          steps: [{ kind: 'action', actionId: '01a1751f-5f0e-7530-b194-d508af8201bd', input: {} }],
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({
          ...followUp,
          trigger: { kind: 'schedule', cron: '0 * * * *' },
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: { first_name: 'x' } },
            },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    expect(await codeOf(create({ ...followUp, steps: [] }))).toBe('VALIDATION');
    // Branches test the triggering record, so they need one and a condition that fits its fields.
    const branch = (
      condition: unknown,
      yes: unknown[] = [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { city: 'x' } },
        },
      ],
    ) => ({
      kind: 'branch',
      condition,
      yes,
      no: [],
    });
    expect(await codeOf(create({ ...followUp, steps: [branch({ field: 'nope', op: 'is_empty' })] }))).toBe(
      'VALIDATION',
    );
    expect(
      await codeOf(
        create({
          ...followUp,
          trigger: { kind: 'schedule', cron: '*/5 * * * *' },
          steps: [
            branch({ field: 'city', op: 'is_empty' }, [
              { kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: {} } },
            ]),
          ],
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        create({
          ...followUp,
          steps: [
            branch({ field: 'city', op: 'is_empty' }, [
              {
                id: 'dup',
                kind: 'action',
                actionId: coreIds.actions.update_record,
                input: { object: 'person', id: '{{record.id}}', values: {} },
              },
              {
                id: 'dup',
                kind: 'action',
                actionId: coreIds.actions.update_record,
                input: { object: 'person', id: '{{record.id}}', values: {} },
              },
            ]),
          ],
        }),
      ),
    ).toBe('VALIDATION');
    const branched = await create({
      ...followUp,
      title: 'Branched',
      steps: [
        branch({ field: 'city', op: 'is_empty' }, [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'person', id: '{{record.id}}', values: { city: 'Unknown' } },
          },
        ]),
      ],
    });
    expect(branched.steps[0]).toMatchObject({
      kind: 'branch',
      yes: [{ kind: 'action', actionId: coreIds.actions.update_record }],
      no: [],
    });
    expect((branched.steps[0] as { yes: { id: string }[] }).yes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await codeOf(create({ ...followUp, title: '  ' }))).toBe('VALIDATION');
    // Functions are not workflow steps: callable code is an action.
    expect(
      await codeOf(
        create({ ...followUp, steps: [{ kind: 'runFunction', function: 'fixture/function/won-deal-creates-task' }] }),
      ),
    ).toBe('VALIDATION');
  });

  it('only admins manage workflows; members see and run them', async () => {
    expect(await codeOf(t.engine.workflows.create(t.member, followUp))).toBe('FORBIDDEN');
    const [workflow] = await t.engine.workflows.list(t.member);

    if (!workflow) {
      throw new Error('no workflow');
    }

    expect(await codeOf(t.engine.workflows.update(t.member, workflow.id, { title: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(t.engine.workflows.delete(t.member, workflow.id))).toBe('FORBIDDEN');
    expect(await codeOf(t.engine.workflows.listRuns(t.member, workflow.id))).toBe('ok');
    expect(t.engine.permissions.can(t.member, 'workflow.run')).toBe(true);
  });

  it('schedules the next tick and restarts the cursor when the trigger or enabled state changes', async () => {
    const workflow = await t.engine.workflows.create(t.owner, {
      title: 'Nightly',
      trigger: {
        kind: 'schedule',
        cron: '0 3 * * *',
        objectId: 'chore',
        condition: { field: 'done', op: 'eq', value: false },
      },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'chore', id: '{{record.id}}', values: { done: true } },
        },
      ],
    });
    // The next 03:00 UTC: ahead of now, and within a day of it.
    const next = new Date(workflow.nextRunAt ?? '');
    expect([next.getUTCHours(), next.getUTCMinutes()]).toEqual([3, 0]);
    expect(next.getTime() - Date.now()).toBeGreaterThan(0);
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(await t.engine.workflows.getCursor(t.workspaceId, workflow.id)).toBeNull();

    const renamed = await t.engine.workflows.update(t.owner, workflow.id, {
      title: 'Hourly cleanup',
      description: 'x',
    });
    expect(renamed).toMatchObject({ title: 'Hourly cleanup', description: 'x', nextRunAt: workflow.nextRunAt });

    const disabled = await t.engine.workflows.update(t.owner, workflow.id, { enabled: false });
    expect(disabled.nextRunAt).toBeNull();
    expect((await t.engine.workflows.listEnabled(t.workspaceId)).map((w) => w.id)).not.toContain(workflow.id);

    await t.engine.records.create(t.owner, 'chore', { title: 'Something happened meanwhile' });
    const current = await t.engine.events.currentSequence(t.workspaceId);
    const switched = await t.engine.workflows.update(t.owner, workflow.id, {
      enabled: true,
      trigger: { kind: 'record_event', objectId: 'chore', types: ['record.updated'], fieldIds: ['done'] },
    });
    expect(switched.nextRunAt).toBeNull();
    expect(await t.engine.workflows.getCursor(t.workspaceId, workflow.id)).toBe(current);

    const events = await readEventsAfter(t.db, t.workspaceId, current, 10);
    expect(events.at(-1)).toMatchObject({ type: 'workflow.changed', workflowId: workflow.id, action: 'updated' });
    expect(await codeOf(t.engine.workflows.update(t.owner, workflow.id, { steps: [] }))).toBe('VALIDATION');
  });

  it('records runs newest first with paging, stamps lastRunAt and announces each run', async () => {
    const workflow = (await t.engine.workflows.list(t.owner)).find(
      (w) => w.title === 'Follow up on new people',
    ) as Workflow;
    const before = await t.engine.events.currentSequence(t.workspaceId);

    for (let i = 0; i < 3; i += 1) {
      const run = await t.engine.workflows.recordRun(t.workspaceId, {
        workflowId: workflow.id,
        status: i === 1 ? 'failed' : 'succeeded',
        trigger: {
          kind: 'record_event',
          objectId: 'person',
          recordId: `r${i}`,
          eventType: 'record.created',
          sequence: i,
        },
        steps: [
          {
            id: 's1',
            kind: 'action',
            actionId: coreIds.actions.create_record,
            status: i === 1 ? 'failed' : 'succeeded',
            ...(i === 1 ? { error: 'boom' } : {}),
          },
        ],
        ...(i === 1 ? { error: 'Step 1 (createRecord) failed: boom' } : {}),
        startedAt: new Date(2026, 0, 1, 0, i).toISOString(),
        finishedAt: new Date(2026, 0, 1, 0, i, 1).toISOString(),
      });
      expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    }

    const events = await readEventsAfter(t.db, t.workspaceId, before, 10);
    expect(events.map((e) => e.type)).toEqual(['workflow.run', 'workflow.run', 'workflow.run']);
    expect(events[1]).toMatchObject({
      type: 'workflow.run',
      workflowId: workflow.id,
      status: 'failed',
      actor: { kind: 'workflow', id: workflow.id },
    });

    const first = await t.engine.workflows.listRuns(t.owner, workflow.id, { limit: 2 });
    expect(first.items.map((r) => r.trigger.recordId)).toEqual(['r2', 'r1']);
    expect(first.items[1]).toMatchObject({ status: 'failed', error: 'Step 1 (createRecord) failed: boom' });
    expect(first.nextCursor).not.toBeNull();
    const second = await t.engine.workflows.listRuns(t.owner, workflow.id, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((r) => r.trigger.recordId)).toEqual(['r0']);
    expect(second.nextCursor).toBeNull();
    expect(await codeOf(t.engine.workflows.listRuns(t.owner, workflow.id, { cursor: 'nope' }))).toBe('INVALID_CURSOR');
    expect((await t.engine.workflows.get(t.owner, workflow.id)).lastRunAt).toBe(
      new Date(2026, 0, 1, 0, 2, 1).toISOString(),
    );
  });

  it('counts runs per day in a time zone and says how each workflow last ran', async () => {
    const workflow = (await t.engine.workflows.list(t.owner)).find(
      (w) => w.title === 'Follow up on new people',
    ) as Workflow;
    const tz = 'Europe/Bucharest';
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    for (const [finishedAt, status] of [
      [ago(26 * 60), 'succeeded'],
      [ago(5), 'failed'],
    ] as const) {
      await t.engine.workflows.recordRun(t.workspaceId, {
        workflowId: workflow.id,
        status,
        trigger: { kind: 'manual' },
        steps: [],
        ...(status === 'failed' ? { error: 'Step 1 failed: nope' } : {}),
        startedAt: finishedAt,
        finishedAt,
      });
    }

    const activity = await t.engine.workflows.activity(t.owner, { days: 7, tz });
    expect(activity.days).toHaveLength(7);
    expect(activity.days.at(-1)?.date).toBe(calendarDay(new Date(), tz));
    const day = (at: string) => activity.days.find((d) => d.date === calendarDay(new Date(at), tz));
    expect(day(ago(5))?.failed).toBe(1);
    expect(activity.days.reduce((sum, d) => sum + d.succeeded + d.failed, 0)).toBe(2);
    // The three runs from January are outside the week; the latest run decides the status.
    expect(activity.workflows.find((w) => w.workflowId === workflow.id)).toEqual({
      workflowId: workflow.id,
      runs: 2,
      failed: 1,
      lastRunId: expect.any(String),
      lastStatus: 'failed',
      lastError: 'Step 1 failed: nope',
    });
    expect(await codeOf(t.engine.workflows.activity(t.owner, { tz: 'Mars/Olympus' }))).toBe('VALIDATION');
    expect(await codeOf(t.engine.workflows.activity(t.member))).toBe('ok');
  });

  it('deletes a workflow with its runs', async () => {
    const workflow = (await t.engine.workflows.list(t.owner)).find(
      (w) => w.title === 'Follow up on new people',
    ) as Workflow;
    await t.engine.workflows.delete(t.owner, workflow.id);
    expect(await codeOf(t.engine.workflows.get(t.owner, workflow.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.workflows.listRuns(t.owner, workflow.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.workflows.delete(t.owner, workflow.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.workflows.get(t.owner, 'not-a-uuid'))).toBe('NOT_FOUND');
  });
});
