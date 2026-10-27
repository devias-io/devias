import { coreIds, defineModule, defineWorkflow } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const ids = {
  ticket: '01a17e45-2fa7-765a-8af7-032f756e806b',
  title: '01a17e45-2fa8-77a2-9f61-35db0be6eb8d',
  notify: '01a17e45-2fa8-77a2-9f61-394676afb38f',
  escalated: '01a17e45-2fa8-77a2-9f61-3f167d53f504',
  onCreate: '01a17e45-2fa8-77a2-9f61-43a5fe2693e1',
  onCreateStep: '01a17e45-2fa8-77a2-9f61-4618f5a25044',
  onEscalate: '01a17e45-2fa8-77a2-9f61-4a70f87b9e9b',
  onEscalateStep: '01a17e45-2fa8-77a2-9f61-4d5cc2845363',
  weekly: '01a17e45-2fa8-77a2-9f61-5276aca3194a',
  weeklyStep: '01a17e45-2fa8-77a2-9f61-57c2e2bf3823',
};
const MODULE = 'helpdesk';

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

/** A module that ships three workflows: on a record event, on its own event, and on a schedule. */
const helpdesk = (version = '1.0.0', options: { stepTitle?: string; dropWeekly?: boolean; cron?: string } = {}) =>
  defineModule({
    id: MODULE,
    version,
    objects: [
      {
        id: ids.ticket,
        nameSingular: 'ticket',
        namePlural: 'tickets',
        labelSingular: 'Ticket',
        labelPlural: 'Tickets',
        primaryFieldId: ids.title,
        fields: [{ id: ids.title, name: 'title', label: 'Title', type: 'text', isRequired: true }],
      },
    ],
    actions: [
      {
        id: ids.notify,
        name: 'notify_team',
        label: 'Notify the team',
        input: [{ name: 'title', label: 'Title', required: true }],
        external: false,
      },
    ],
    events: [{ id: ids.escalated, name: 'ticket.escalated' }],
    workflows: [
      defineWorkflow({
        id: ids.onCreate,
        title: 'Tell the team about a new ticket',
        trigger: { kind: 'record_event', objectId: ids.ticket, types: ['record.created'] },
        steps: [
          {
            id: ids.onCreateStep,
            kind: 'action',
            actionId: ids.notify,
            input: { title: options.stepTitle ?? 'New ticket: {{record.title}}' },
          },
        ],
      }),
      defineWorkflow({
        id: ids.onEscalate,
        title: 'Open a ticket for an escalation',
        enabled: false,
        trigger: { kind: 'module_event', moduleId: MODULE, types: ['ticket.escalated'] },
        steps: [
          {
            id: ids.onEscalateStep,
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: { object: 'ticket', values: { title: 'Escalated: {{event.payload.subject}}' } },
          },
        ],
      }),
      ...(options.dropWeekly
        ? []
        : [
            defineWorkflow({
              id: ids.weekly,
              title: 'Weekly digest',
              trigger: { kind: 'schedule', cron: options.cron ?? '0 9 * * 1' },
              steps: [{ id: ids.weeklyStep, kind: 'action', actionId: ids.notify, input: { title: 'Weekly digest' } }],
            }),
          ]),
    ],
  });

describe('workflows a module ships', () => {
  let t: TestEngine;
  const other = 'ws_other';
  const otherOwner = () => ({ ...t.owner, workspaceId: other });

  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
    await t.engine.workspaces.initialize(other);
  });
  afterAll(() => t.close());

  const workflowsOf = async (ctx = t.owner) =>
    (await t.engine.workflows.list(ctx)).filter((workflow) => workflow.moduleId === MODULE);
  const byTitle = async (title: string, ctx = t.owner) => {
    const found = (await workflowsOf(ctx)).find((workflow) => workflow.title === title);
    expect(found, title).toBeDefined();

    return found as NonNullable<typeof found>;
  };

  it('puts them in the install plan, and makes them with the module', async () => {
    const before = await t.engine.events.currentSequence(t.workspaceId);
    const plan = await t.engine.modules.plan(t.owner, helpdesk());
    expect(plan.changes.filter((change) => change.kind === 'workflow')).toEqual([
      expect.objectContaining({
        id: ids.onCreate,
        action: 'create',
        label: 'Workflow "Tell the team about a new ticket"',
      }),
      expect.objectContaining({ id: ids.onEscalate, action: 'create' }),
      expect.objectContaining({ id: ids.weekly, action: 'create' }),
    ]);
    await t.engine.modules.apply(t.owner, helpdesk(), { expectedPlanHash: plan.planHash });

    const onCreate = await byTitle('Tell the team about a new ticket');
    expect(onCreate).toMatchObject({
      moduleId: MODULE,
      enabled: true,
      trigger: { kind: 'record_event', objectId: ids.ticket },
    });
    // It starts reading the log from now, not from the beginning.
    expect(await t.engine.workflows.getCursor(t.workspaceId, onCreate.id)).toBe(before);
    // The module says where it starts: this one is off until the workspace turns it on.
    expect(await byTitle('Open a ticket for an escalation')).toMatchObject({ enabled: false });
    expect(await byTitle('Weekly digest')).toMatchObject({ nextRunAt: expect.any(String) });
    // Applying the same version again changes nothing.
    const again = await t.engine.modules.plan(t.owner, helpdesk());
    expect(
      again.changes.filter((change) => change.kind === 'workflow').every((change) => change.action === 'noop'),
    ).toBe(true);
  });

  it('makes their own for a second workspace, unaffected by the first', async () => {
    await t.engine.modules.apply(otherOwner(), helpdesk());
    const mine = await workflowsOf();
    const theirs = await workflowsOf(otherOwner());
    expect(theirs).toHaveLength(3);
    expect(new Set([...mine, ...theirs].map((workflow) => workflow.id)).size).toBe(6);
    await t.engine.workflows.update(otherOwner(), (await byTitle('Weekly digest', otherOwner())).id, {
      enabled: false,
    });
    expect(await byTitle('Weekly digest')).toMatchObject({ enabled: true });
  });

  it('lets the workspace turn one on or off, and nothing else of it', async () => {
    const workflow = await byTitle('Open a ticket for an escalation');
    expect(await t.engine.workflows.update(t.owner, workflow.id, { enabled: true })).toMatchObject({ enabled: true });
    // A form that sends everything back is not changing anything.
    expect(
      await t.engine.workflows.update(t.owner, workflow.id, { title: workflow.title, enabled: false }),
    ).toMatchObject({
      enabled: false,
    });
    const refused = t.engine.workflows.update(t.owner, workflow.id, { title: 'Renamed' });
    expect(await codeOf(refused)).toBe('CONFLICT');
    await expect(t.engine.workflows.update(t.owner, workflow.id, { title: 'Renamed' })).rejects.toThrow(
      /title cannot be changed/,
    );
    expect(await codeOf(t.engine.workflows.update(t.owner, workflow.id, { steps: [] }))).toBe('VALIDATION');
    expect(await codeOf(t.engine.workflows.delete(t.owner, workflow.id))).toBe('CONFLICT');
    expect((await byTitle('Open a ticket for an escalation')).title).toBe('Open a ticket for an escalation');
  });

  it('replaces what the module owns when it is updated, and leaves the workspace its choice', async () => {
    const weekly = await byTitle('Weekly digest');
    await t.engine.workflows.update(t.owner, weekly.id, { enabled: false });
    const plan = await t.engine.modules.plan(
      t.owner,
      helpdesk('1.1.0', { stepTitle: 'Ticket: {{record.title}}', cron: '0 8 * * 1' }),
    );
    expect(
      plan.changes.filter((change) => change.kind === 'workflow' && change.action === 'update').map((c) => c.id),
    ).toEqual([ids.onCreate, ids.weekly]);
    await t.engine.modules.apply(
      t.owner,
      helpdesk('1.1.0', { stepTitle: 'Ticket: {{record.title}}', cron: '0 8 * * 1' }),
    );

    const onCreate = await byTitle('Tell the team about a new ticket');
    expect(onCreate.steps[0]).toMatchObject({ input: { title: 'Ticket: {{record.title}}' } });
    // Same row, same place in the log: an update does not start it over.
    expect(onCreate.id).toBe((await workflowsOf()).find((w) => w.title === onCreate.title)?.id);
    const after = await byTitle('Weekly digest');
    expect(after).toMatchObject({ id: weekly.id, enabled: false, trigger: { cron: '0 8 * * 1' } });
  });

  it('removes one the module stops shipping, with its runs', async () => {
    const weekly = await byTitle('Weekly digest');
    await t.engine.workflows.enqueueRuns(t.workspaceId, weekly.id, [{ trigger: { kind: 'schedule' }, key: 'x' }]);
    await t.engine.modules.apply(t.owner, helpdesk('1.2.0', { dropWeekly: true }));
    expect((await workflowsOf()).map((workflow) => workflow.title)).not.toContain('Weekly digest');
    expect(await codeOf(t.engine.workflows.get(t.owner, weekly.id))).toBe('NOT_FOUND');
    expect(await workflowsOf(otherOwner())).toHaveLength(3);
  });

  it('refuses a workflow that names something that is not there, and installs nothing', async () => {
    const broken = defineModule({
      id: 'broken-helpdesk',
      version: '1.0.0',
      workflows: [
        defineWorkflow({
          id: ids.onCreate,
          title: 'Points nowhere',
          trigger: { kind: 'record_event', objectId: ids.ticket, types: ['record.created'] },
          steps: [{ id: ids.onCreateStep, kind: 'action', actionId: ids.notify, input: { title: 'x' } }],
        }),
      ],
    });
    // The object and the action belong to a module this workspace has not got.
    expect(
      await codeOf(
        t.engine.modules.plan(otherOwner(), {
          ...broken,
          workflows: broken.workflows.map((w) => ({ ...w, trigger: { ...w.trigger, objectId: 'nope-object' } })),
        }),
      ),
    ).toBe('MISSING_DEPENDENCY');
    const unknownAction = defineModule({
      id: 'unknown-action',
      version: '1.0.0',
      workflows: [
        defineWorkflow({
          id: ids.onCreate,
          title: 'Bad step',
          trigger: { kind: 'manual', objectId: ids.ticket },
          steps: [{ id: ids.onCreateStep, kind: 'action', actionId: 'no-such-action', input: {} }],
        }),
      ],
    });
    expect(await codeOf(t.engine.modules.plan(t.owner, unknownAction))).toBe('MISSING_DEPENDENCY');
    // A step the engine would refuse when a person saves it is refused here too, and the whole install rolls back.
    const badInput = defineModule({
      id: 'bad-input',
      version: '9.0.0',
      workflows: [
        defineWorkflow({
          id: ids.onCreate,
          title: 'Wrong input',
          trigger: { kind: 'manual', objectId: ids.ticket },
          steps: [
            { id: ids.onCreateStep, kind: 'action', actionId: coreIds.actions.create_record, input: { nonsense: 1 } },
          ],
        }),
      ],
    });
    expect(await codeOf(t.engine.modules.apply(t.owner, badInput))).toBe('VALIDATION');
    expect((await t.engine.modules.list(t.owner)).some((module) => module.id === 'bad-input')).toBe(false);
  });

  it('takes its workflows away when the module is uninstalled', async () => {
    await t.engine.modules.uninstall(t.owner, MODULE, { allowDestructive: true });
    expect(await workflowsOf()).toEqual([]);
    expect(await workflowsOf(otherOwner())).toHaveLength(3);
  });
});
