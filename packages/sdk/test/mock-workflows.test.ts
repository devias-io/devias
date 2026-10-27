import type { WorkspaceEvent } from '@devias/core';
import { coreIds, defineModule, defineWorkflow } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, q } from '../src';
import { createMockClient, runDueWorkflows } from '../src/mock';
import { demoClient } from './demo-data';

const demo = () => demoClient({ workspaceId: 'ws_test', manifests: [fixture], today: '2026-06-15' });

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mock workflows', () => {
  it('validates like the server and assigns step ids', async () => {
    const client = demo();
    const bad = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'record_event', objectId: 'ghost', types: ['record.created'] },
        steps: [{ kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: {} } }],
      }),
    );
    expect(bad.code).toBe('VALIDATION');
    const unknownField = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'manual', objectId: 'person' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'person', id: '{{record.id}}', values: { nope: 1 } },
          },
        ],
      }),
    );
    expect(unknownField.message).toMatch(/Unknown field "nope"/);
    const workflow = await client.workflows.create({
      title: 'Greet',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { city: 'Lisbon' } },
        },
      ],
    });
    expect(workflow.steps[0]?.id).toBeTruthy();
    // The demo seed ships two workflows of its own.
    expect(await client.workflows.list()).toContainEqual(workflow);
  });

  it('reads text written to a rich-text field as Markdown, and renders a document as Markdown where text is wanted', async () => {
    const client = demo();
    await client.metadata.fields.create({ objectId: 'person', name: 'about', type: 'rich_text', label: 'About' });
    const workflow = await client.workflows.create({
      title: 'Write up',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { about: 'Met **{{record.first_name}}**' } },
        },
        {
          kind: 'action',
          actionId: coreIds.actions.send_notification,
          input: { title: 'About: {{record.about}}', body: '{{record.about}}', to: { roles: ['owner'] } },
        },
      ],
    });
    const person = await client.records.create('person', { first_name: 'Nora', last_name: 'Lind' });
    const run = await client.workflows.run(workflow.id, { recordId: person.id });
    expect(run.status).toBe('succeeded');
    const about = (await client.records.get('person', person.id)).about as { type: string };
    expect(about.type).toBe('doc');
    const sent = (await client.notifications.list()).items.find((item) => item.title.startsWith('About:'));
    expect(sent?.title).toBe('About: Met **Nora**');
    expect(sent?.body).toBe('Met **Nora**');
  });

  it('does not start a record-event workflow for imported records, unless it asks to', async () => {
    const client = demo();
    const make = (title: string, onImport: boolean) =>
      client.workflows.create({
        title,
        trigger: {
          kind: 'record_event',
          objectId: 'company',
          types: ['record.created'],
          ...(onImport ? { onImport } : {}),
        },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { city: 'Lisbon' } },
          },
        ],
      });
    const ignoring = await make('Ignores imports', false);
    const asking = await make('Wants imports', true);
    await client.records.import('company', { columns: ['name'], rows: [['Imported Co']] });
    await flush();
    expect((await client.workflows.runs(ignoring.id)).items).toHaveLength(0);
    expect((await client.workflows.runs(asking.id)).items).toHaveLength(1);
    await client.records.create('company', { name: 'By hand' });
    await flush();
    expect((await client.workflows.runs(ignoring.id)).items).toHaveLength(1);
    expect((await client.workflows.runs(asking.id)).items).toHaveLength(2);
  });

  it('reacts to record events with templates, skips its own writes and records runs', async () => {
    const client = demo();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const workflow = await client.workflows.create({
      title: 'Welcome task',
      trigger: {
        kind: 'record_event',
        objectId: 'person',
        types: ['record.created', 'record.updated'],
        fieldIds: ['city'],
        condition: { field: 'city', op: 'is_not_empty' },
      },
      steps: [
        {
          id: 'chore',
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'chore', values: { title: 'Welcome {{record.first_name}}', person: '{{record.id}}' } },
        },
        {
          id: 'mark',
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { job_title: 'Contact via {{steps.chore.id}}' } },
        },
      ],
    });
    const person = await client.records.create('person', { first_name: 'Nora', last_name: 'Lind' });
    await flush();
    expect((await client.workflows.runs(workflow.id)).items).toHaveLength(0);
    await client.records.update('person', person.id, { job_title: 'CTO' });
    await flush();
    expect((await client.workflows.runs(workflow.id)).items).toHaveLength(0);
    await client.records.update('person', person.id, { city: 'Oslo' });
    await flush();
    const runs = await client.workflows.runs(workflow.id);
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      trigger: {
        kind: 'record_event',
        objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
        recordId: person.id,
        eventType: 'record.updated',
      },
      steps: [
        { id: 'chore', status: 'succeeded' },
        { id: 'mark', status: 'succeeded' },
      ],
    });
    const tasks = await client.records.list(
      q('chore')
        .where((f) => f.eq('person', person.id))
        .build(),
    );
    expect(tasks.items.map((t) => [t.title, t.created_by])).toEqual([['Welcome Nora', workflow.id]]);
    const updated = await client.records.get('person', person.id);
    expect(updated.job_title).toBe(`Contact via ${tasks.items[0]?.id}`);
    expect(events.filter((e) => e.type === 'workflow.run')).toHaveLength(1);
    expect(events.some((e) => e.type === 'record.updated' && e.actor.kind === 'workflow')).toBe(true);
    expect((await client.workflows.get(workflow.id)).lastRunAt).not.toBeNull();
  });

  it('runs manual workflows on demand and reports failing steps', async () => {
    const client = demo();
    const workflow = await client.workflows.create({
      title: 'Mark done',
      trigger: { kind: 'manual', objectId: 'chore' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'chore', id: '{{record.id}}', values: { done: true } },
        },
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'note', values: { title: 'Done: {{record.title}}' } },
        },
      ],
    });
    const task = await client.records.create('chore', { title: 'Ship it' });
    expect((await failure(client.workflows.run(workflow.id))).code).toBe('VALIDATION');
    const run = await client.workflows.run(workflow.id, { recordId: task.id });
    expect(run).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'manual', recordId: task.id, actor: { kind: 'user' } },
      steps: [
        { kind: 'action', actionId: coreIds.actions.update_record, status: 'succeeded' },
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          status: 'succeeded',
          output: { id: expect.any(String) },
        },
      ],
    });
    expect((await client.records.get('chore', task.id)).done).toBe(true);

    await client.workflows.update(workflow.id, {
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'chore', id: '{{record.id}}', values: { due_date: 'soon' } },
        },
      ],
    });
    const failed = await client.workflows.run(workflow.id, { recordId: task.id });
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Step 1 .* failed/);

    // The activity counts both runs, today, and knows the latest one failed.
    const activity = await client.workflows.activity({ days: 7, tz: 'Europe/Bucharest' });
    expect(activity.days).toHaveLength(7);
    expect(activity.days.at(-1)).toMatchObject({ succeeded: 1, failed: 1 });
    expect(activity.workflows.find((health) => health.workflowId === workflow.id)).toEqual({
      workflowId: workflow.id,
      runs: 2,
      failed: 1,
      lastRunId: failed.id,
      lastStatus: 'failed',
      lastError: failed.error,
    });
    expect((await failure(client.workflows.activity({ tz: 'Mars/Olympus' }))).code).toBe('VALIDATION');

    await client.workflows.update(workflow.id, { enabled: false });
    expect((await failure(client.workflows.run(workflow.id, { recordId: task.id }))).code).toBe('CONFLICT');
    await client.workflows.delete(workflow.id);
    expect((await failure(client.workflows.get(workflow.id))).code).toBe('NOT_FOUND');
  });

  it('lists the runs about a record, newest first, whichever workflow they belong to', async () => {
    const client = demo();
    const make = (title: string) =>
      client.workflows.create({
        title,
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'chore', id: '{{record.id}}', values: { done: true } },
          },
        ],
      });
    const [first, second] = await Promise.all([make('First'), make('Second')]);
    const task = await client.records.create('chore', { title: 'Ship it' });
    const elsewhere = await client.records.create('chore', { title: 'Another' });
    await client.workflows.run(first.id, { recordId: task.id });
    await client.workflows.run(second.id, { recordId: task.id, wait: false });
    await client.workflows.run(first.id, { recordId: elsewhere.id });

    const runs = await client.workflows.recordRuns({ recordId: task.id });
    expect(runs.items.map((run) => run.workflowId)).toEqual([second.id, first.id]);
    expect((await client.workflows.recordRuns({ recordId: task.id, limit: 1 })).items).toHaveLength(1);
    // The mock carries a run out as it is made, so none is open.
    expect((await client.workflows.recordRuns({ recordId: task.id, state: 'open' })).items).toEqual([]);
    expect((await client.workflows.recordRuns({ recordId: 'nothing' })).items).toEqual([]);

    // A whole object's runs, for a table to mark its rows: every record's, newest first.
    const object = await client.workflows.recordRuns({ objectId: runs.items[0]?.trigger.objectId ?? '' });
    expect(object.items.map((run) => run.trigger.recordId)).toEqual([elsewhere.id, task.id, task.id]);
    expect((await client.workflows.recordRuns({ objectId: 'nothing' })).items).toEqual([]);
  });

  it('runs one lane of a branch and skips the other', async () => {
    const client = demo();
    const workflow = await client.workflows.create({
      title: 'Size',
      trigger: { kind: 'manual', objectId: 'company' },
      steps: [
        {
          id: 'size',
          kind: 'branch',
          condition: { field: 'employees', op: 'gte', value: 100 },
          yes: [
            {
              id: 'big',
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'company', id: '{{record.id}}', values: { city: 'Big' } },
            },
          ],
          no: [
            {
              id: 'small',
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'company', id: '{{record.id}}', values: { city: 'Small' } },
            },
          ],
        },
      ],
    });
    const small = await client.records.create('company', { name: 'Tiny', employees: 3 });
    const run = await client.workflows.run(workflow.id, { recordId: small.id });
    expect(run.steps.map((s) => [s.id, s.status])).toEqual([
      ['size', 'succeeded'],
      ['small', 'succeeded'],
    ]);
    expect(run.steps[0]?.output).toEqual({ matched: false, branch: 'no' });
    expect((await client.records.get('company', small.id)).city).toBe('Small');
    const bad = await failure(
      client.workflows.create({
        title: 'x',
        trigger: { kind: 'schedule', cron: '*/5 * * * *' },
        steps: [{ kind: 'branch', condition: { field: 'a', op: 'is_empty' }, yes: [], no: [] }],
      }),
    );
    expect(bad.message).toMatch(/branch needs a trigger/);
  });

  it('ticks schedules with runDueWorkflows and pages runs', async () => {
    const client = demo();
    const workflow = await client.workflows.create({
      title: 'Close open tasks',
      trigger: {
        kind: 'schedule',
        cron: '*/30 * * * *',
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
    const open =
      (
        await client.records.list(
          q('chore')
            .where((f) => f.eq('done', false))
            .count()
            .build(),
        )
      ).totalCount ?? 0;
    expect(open).toBeGreaterThan(2);
    expect(runDueWorkflows(client.store)).toBe(0);
    expect(runDueWorkflows(client.store, new Date(Date.now() + 31 * 60_000))).toBe(open);
    expect(
      (
        await client.records.list(
          q('chore')
            .where((f) => f.eq('done', false))
            .build(),
        )
      ).items,
    ).toHaveLength(0);
    const first = await client.workflows.runs(workflow.id, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.workflows.runs(workflow.id, { limit: 500, cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(open - 2);
    expect(second.nextCursor).toBeNull();
    expect((await failure(client.workflows.runs(workflow.id, { cursor: 'nope' }))).code).toBe('INVALID_CURSOR');
  });

  it('keeps workflows and runs across a snapshot round trip', async () => {
    const client = demo();
    await client.workflows.create({
      title: 'Persisted',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: { city: 'Rome' } },
        },
      ],
    });
    const snapshot = client.store.snapshot();
    const other = createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });
    other.store.restore(snapshot);
    expect((await other.workflows.list()).map((w) => w.title)).toContain('Persisted');
  });
  it("installs the workflows a module ships, keeps their text the module's, and takes them away with it", async () => {
    const shipped = (title: string, enabled?: boolean) =>
      defineModule({
        id: 'shipper',
        version: title === 'Tell the team' ? '1.0.0' : '1.1.0',
        workflows: [
          defineWorkflow({
            id: '01a17e45-2fa8-77a2-9f61-43a5fe2693e1',
            title,
            ...(enabled === undefined ? {} : { enabled }),
            trigger: { kind: 'manual', objectId: 'person' },
            steps: [
              {
                id: '01a17e45-2fa8-77a2-9f61-4618f5a25044',
                kind: 'action',
                actionId: coreIds.actions.update_record,
                input: { object: 'person', id: '{{record.id}}', values: { city: 'Rome' } },
              },
            ],
          }),
        ],
      });
    const client = demo();
    const plan = await client.modules.plan(shipped('Tell the team'));
    expect(plan.changes).toEqual([expect.objectContaining({ kind: 'workflow', action: 'create' })]);
    await client.modules.apply(shipped('Tell the team'));
    const [workflow] = (await client.workflows.list()).filter((w) => w.moduleId === 'shipper');
    expect(workflow).toMatchObject({ title: 'Tell the team', enabled: true });

    // The workspace may turn it off; the module's text is not its to change, and it cannot be deleted.
    expect(await client.workflows.update(workflow?.id ?? '', { title: 'Tell the team', enabled: false })).toMatchObject(
      {
        enabled: false,
      },
    );
    expect((await failure(client.workflows.update(workflow?.id ?? '', { title: 'Renamed' }))).code).toBe('CONFLICT');
    expect((await failure(client.workflows.delete(workflow?.id ?? ''))).code).toBe('CONFLICT');

    // A new version replaces the text and leaves the choice alone.
    await client.modules.apply(shipped('Tell everyone', true));
    expect((await client.workflows.list()).filter((w) => w.moduleId === 'shipper')).toEqual([
      expect.objectContaining({ title: 'Tell everyone', enabled: false }),
    ]);
    await client.modules.uninstall('shipper', { allowDestructive: true });
    expect((await client.workflows.list()).filter((w) => w.moduleId === 'shipper')).toEqual([]);
  });
});
