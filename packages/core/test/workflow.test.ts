import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionInputProblem,
  countSteps,
  findStep,
  flattenSteps,
  literalObjectOf,
  maskSecret,
  matchesModuleEventTrigger,
  matchesRecordEventTrigger,
  matchesTriggerCondition,
  type RecordEvent,
  type RecordEventTrigger,
  renderTemplate,
  settingsProblem,
  stepDepth,
  stepInputProblem,
  stepLimitsProblem,
  templateReferences,
  triggerFollowsLog,
  triggerObjectIdOf,
  WorkflowInputSchema,
  type WorkflowStepInput,
  WorkflowStepSchema,
  workflowCanRun,
  workflowRetryDelayMs,
  workflowScope,
} from '../src';
import { coreIds } from '../src/core-ids';

const scope = workflowScope({
  workflow: { id: 'wf1', title: 'Kickoff' },
  trigger: { kind: 'record_event' },
  record: { id: 'r1', createdAt: 'x', updatedAt: 'x', name: 'Big fish', amount: 1200, closed: false, owner: null },
  event: {
    type: 'record.updated',
    object: 'opportunity',
    recordId: 'r1',
    changedFields: ['stage'],
    sequence: 7,
    occurredAt: 'x',
  },
  now: new Date('2026-09-28T10:00:00.000Z'),
});

describe('workflow templates', () => {
  it('keeps the type of a whole-string reference and interpolates text otherwise', () => {
    expect(renderTemplate('{{record.amount}}', scope)).toBe(1200);
    expect(renderTemplate('{{ record.closed }}', scope)).toBe(false);
    expect(renderTemplate('{{record.owner}}', scope)).toBeNull();
    expect(renderTemplate('{{record.missing}}', scope)).toBeNull();
    expect(renderTemplate('Kick off {{record.name}} ({{record.amount}}) on {{today}}', scope)).toBe(
      'Kick off Big fish (1200) on 2026-09-28',
    );
    expect(renderTemplate('{{now}}', scope)).toBe('2026-09-28T10:00:00.000Z');
    expect(renderTemplate('{{workflow.title}} / {{event.type}} / {{record.owner}}', scope)).toBe(
      'Kickoff / record.updated / ',
    );
  });

  it('renders nested values and leaves other types alone', () => {
    expect(
      renderTemplate({ title: '{{record.name}}', tags: ['{{event.type}}', 3], done: true, n: null }, scope),
    ).toEqual({
      title: 'Big fish',
      tags: ['record.updated', 3],
      done: true,
      n: null,
    });
    expect(templateReferences({ a: '{{record.name}} {{today}}', b: ['{{record.name}}'] })).toEqual([
      'record.name',
      'today',
    ]);
  });

  it('reads outputs of earlier steps', () => {
    const withSteps = { ...scope, steps: { task: { id: 't1' } } };
    expect(renderTemplate('{{steps.task.id}}', withSteps)).toBe('t1');
  });
});

describe('record-event trigger matching', () => {
  const fieldIds = {
    stage: '01a17522-9490-7455-80c5-c79ecdfd0e61',
    amount: '01a17522-9490-7455-80c5-ca3091cabfb2',
  };
  const trigger: RecordEventTrigger = {
    kind: 'record_event',
    objectId: '01a17522-1ebd-72be-8b8b-aeedf2e383ef',
    types: ['record.updated'],
    fieldIds: [fieldIds.stage, fieldIds.amount],
    condition: { field: fieldIds.stage, op: 'eq', value: 'customer' },
  };
  const fieldIdOf = (name: string) => fieldIds[name as keyof typeof fieldIds] ?? name;
  const fieldNameOf = (ref: string) => Object.entries(fieldIds).find(([, id]) => id === ref)?.[0] ?? ref;
  const event = (patch: Partial<RecordEvent>): RecordEvent => ({
    sequence: 1,
    workspaceId: 'ws',
    actor: { kind: 'user', id: 'u' },
    occurredAt: 'x',
    type: 'record.updated',
    objectId: '01a17522-1ebd-72be-8b8b-aeedf2e383ef',
    object: 'opportunity',
    recordId: 'r',
    changedFields: ['stage'],
    ...patch,
  });

  it('checks object, type and watched fields', () => {
    expect(matchesRecordEventTrigger(trigger, event({}), fieldIdOf)).toBe(true);
    expect(
      matchesRecordEventTrigger(
        trigger,
        event({ objectId: '01a17356-5c6a-71ce-8397-11f6035d5523', object: 'person' }),
        fieldIdOf,
      ),
    ).toBe(false);
    expect(matchesRecordEventTrigger(trigger, event({ type: 'record.created' }), fieldIdOf)).toBe(false);
    expect(matchesRecordEventTrigger(trigger, event({ changedFields: ['name'] }), fieldIdOf)).toBe(false);
    expect(matchesRecordEventTrigger(trigger, event({ changedFields: ['name', 'amount'] }), fieldIdOf)).toBe(true);
    // Watched fields only narrow updates; a creation sets everything.
    expect(
      matchesRecordEventTrigger(
        { ...trigger, types: ['record.created'] },
        event({ type: 'record.created', changedFields: ['name'] }),
        fieldIdOf,
      ),
    ).toBe(true);
  });

  it('evaluates the condition on the record', () => {
    expect(matchesTriggerCondition(trigger, { stage: 'customer' }, fieldNameOf)).toBe(true);
    expect(matchesTriggerCondition(trigger, { stage: 'new' }, fieldNameOf)).toBe(false);
    expect(matchesTriggerCondition(trigger, null, fieldNameOf)).toBe(false);
    expect(matchesTriggerCondition({ ...trigger, condition: undefined }, null, fieldNameOf)).toBe(true);
  });
});

describe('workflow input schema', () => {
  it('requires a name, a trigger with at least one event type, and a step', () => {
    const base = {
      title: 'x',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.update_record,
          input: { object: 'person', id: '{{record.id}}', values: {} },
        },
      ],
    };
    expect(WorkflowInputSchema.safeParse(base).success).toBe(true);
    expect(WorkflowInputSchema.safeParse({ ...base, title: ' ' }).success).toBe(false);
    expect(WorkflowInputSchema.safeParse({ ...base, steps: [] }).success).toBe(false);
    expect(
      WorkflowInputSchema.safeParse({ ...base, trigger: { kind: 'record_event', objectId: 'person', types: [] } })
        .success,
    ).toBe(false);
    const scheduled = (cron: string) => WorkflowInputSchema.safeParse({ ...base, trigger: { kind: 'schedule', cron } });
    expect(scheduled('*/15 * * * *').success).toBe(true);
    expect(scheduled('0 9 * * 1-5').success).toBe(true);

    for (const cron of ['', 'every day', '* * * *', '0 25 * * *', '0 0 30 2 *']) {
      expect(scheduled(cron).success, cron).toBe(false);
    }

    expect(
      WorkflowInputSchema.safeParse({ ...base, steps: [{ kind: 'runFunction', function: 'x/function/y' }] }).success,
    ).toBe(false);
  });
});

describe('branches', () => {
  const nested: WorkflowStepInput[] = [
    {
      id: 'a',
      kind: 'action',
      actionId: coreIds.actions.update_record,
      input: { object: 'person', id: '{{record.id}}', values: { x: 1 } },
    },
    {
      id: 'if1',
      kind: 'branch',
      condition: { field: 'stage', op: 'eq', value: 'won' },
      yes: [
        { id: 'b', kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: {} } },
        {
          id: 'if2',
          kind: 'branch',
          condition: { field: 'amount', op: 'gt', value: 100 },
          yes: [
            {
              id: 'c',
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: {} },
            },
          ],
          no: [],
        },
      ],
      no: [{ id: 'd', kind: 'action', actionId: '01a1751f-5f0a-70f6-b258-808951d74c84', input: {} }],
    },
  ];

  it('parses nested branches with ids', () => {
    const parsed = WorkflowStepSchema.safeParse({ ...nested[1], yes: [], no: [] });
    expect(parsed.success).toBe(true);
    const withoutId = WorkflowInputSchema.safeParse({
      title: 'x',
      trigger: { kind: 'manual', objectId: 'person' },
      steps: [
        {
          kind: 'branch',
          condition: { field: 'a', op: 'is_empty' },
          yes: [
            {
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'person', id: '{{record.id}}', values: {} },
            },
          ],
          no: [],
        },
      ],
    });
    expect(withoutId.success).toBe(true);
    const bad = WorkflowStepSchema.safeParse({ id: 'x', kind: 'branch', condition: { nope: 1 }, yes: [], no: [] });
    expect(bad.success).toBe(false);
  });

  it('walks, counts, measures and finds steps across lanes', () => {
    expect(flattenSteps(nested).map((s) => s.id)).toEqual(['a', 'if1', 'b', 'if2', 'c', 'd']);
    expect(countSteps(nested)).toBe(6);
    expect(stepDepth(nested)).toBe(2);
    expect(stepDepth([nested[0] as WorkflowStepInput])).toBe(0);
    expect(findStep(nested, 'c')).toMatchObject({ kind: 'action', actionId: coreIds.actions.update_record });
    expect(findStep(nested, 'zzz')).toBeUndefined();
  });

  it('reports size limits', () => {
    expect(stepLimitsProblem(nested)).toBeNull();
    expect(stepLimitsProblem([])).toMatch(/at least one/);
    const many: WorkflowStepInput[] = Array.from({ length: 51 }, () => ({
      kind: 'action',
      actionId: coreIds.actions.update_record,
      input: { object: 'person', id: '{{record.id}}', values: {} },
    }));
    expect(stepLimitsProblem(many)).toMatch(/at most 50/);
    let deep: WorkflowStepInput[] = [
      {
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'person', id: '{{record.id}}', values: {} },
      },
    ];

    for (let i = 0; i < 6; i += 1) {
      deep = [{ kind: 'branch', condition: { field: 'a', op: 'is_empty' }, yes: deep, no: [] }];
    }

    expect(stepLimitsProblem(deep)).toMatch(/nest at most 5/);
  });
});

describe('module event triggers and action steps', () => {
  it('parses the event trigger and action step and matches events by module and type', () => {
    const parsed = WorkflowInputSchema.parse({
      title: 'Invoice paid',
      trigger: { kind: 'module_event', moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0', types: ['invoice.paid'] },
      steps: [
        {
          kind: 'action',
          actionId: '01a1751f-5f0a-70f6-b258-808951d74c84',
          input: { to: '{{event.payload.email}}' },
        },
      ],
    });
    expect(parsed.trigger.kind).toBe('module_event');
    expect(triggerObjectIdOf(parsed.trigger)).toBeUndefined();
    expect(triggerFollowsLog(parsed.trigger)).toBe(true);
    expect(triggerFollowsLog({ kind: 'manual' })).toBe(false);
    const trigger = {
      kind: 'module_event' as const,
      moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
      types: ['invoice.paid'],
    };
    expect(
      matchesModuleEventTrigger(trigger, {
        moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
        eventType: 'invoice.paid',
      }),
    ).toBe(true);
    expect(
      matchesModuleEventTrigger(trigger, {
        moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0',
        eventType: 'invoice.voided',
      }),
    ).toBe(false);
    expect(
      matchesModuleEventTrigger(trigger, {
        moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
        eventType: 'invoice.paid',
      }),
    ).toBe(false);
    expect(
      matchesModuleEventTrigger(
        { ...trigger, types: ['*'] },
        { moduleId: '01a1751f-5f15-7708-9f78-5224e878aec0', eventType: 'x' },
      ),
    ).toBe(true);
    expect(WorkflowStepSchema.safeParse({ id: 's', kind: 'action', actionId: '', input: {} }).success).toBe(false);
  });

  it('renders module event payloads into templates', () => {
    const eventScope = workflowScope({
      workflow: { id: 'wf1', title: 'Paid' },
      trigger: { kind: 'module_event' },
      event: {
        type: 'invoice.paid',
        module: 'payments',
        id: 'e1',
        payload: { data: { object: { amount: 1200 } } },
      },
    });
    expect(renderTemplate('{{event.payload.data.object.amount}}', eventScope)).toBe(1200);
    expect(renderTemplate('{{event.module}} sent {{event.type}}', eventScope)).toBe('payments sent invoice.paid');
    expect(renderTemplate('{{record.name}}', eventScope)).toBeNull();
  });
});

describe('settings and action helpers', () => {
  it('masks secrets and checks settings and action inputs', () => {
    expect(maskSecret('sk_test_1234567890abcdef')).toBe('sk_t…cdef');
    expect(maskSecret('short')).toBe('••••');
    const settings = [
      { name: 'api_key', label: 'API key', secret: true, required: true },
      { name: 'extra', label: 'Extra', secret: true, required: false },
    ];
    expect(settingsProblem(settings, { api_key: 'x' })).toBeNull();
    expect(settingsProblem(settings, {})).toEqual({ message: 'API key is required', name: 'api_key' });
    expect(settingsProblem(settings, {}, { partial: true })).toBeNull();
    expect(settingsProblem(settings, { nope: 'x' })?.name).toBe('nope');
    const action = {
      input: [
        { name: 'to', label: 'To', type: 'email' as const, required: true },
        { name: 'body', label: 'Body', type: 'text' as const, required: false },
      ],
    };
    expect(actionInputProblem(action, { to: '{{record.email}}' })).toBeNull();
    expect(actionInputProblem(action, { body: 'x' })).toEqual({ message: 'To is required', name: 'to' });
    expect(actionInputProblem(action, { to: 'a', other: 1 })?.name).toBe('other');
  });
});

describe('action steps', () => {
  const spec = (id: string) => {
    const found = ACTIONS.find((candidate) => candidate.id === id);

    if (!found) {
      throw new Error(`no action ${id}`);
    }

    return found;
  };

  it('lets workflows run what their own permissions allow, never people-only or managing actions', () => {
    expect(workflowCanRun(spec(coreIds.actions.update_record))).toBe(true);
    expect(workflowCanRun(spec(coreIds.actions.comment_on_record))).toBe(true);
    expect(workflowCanRun(spec(coreIds.actions.aggregate_records))).toBe(true);
    expect(workflowCanRun(spec(coreIds.actions.change_member_role))).toBe(false);
    expect(workflowCanRun(spec(coreIds.actions.run_workflow))).toBe(false);
    expect(workflowCanRun(spec(coreIds.actions.apply_module))).toBe(false);
    expect(workflowCanRun({ permission: 'module.run', sessionOnly: false })).toBe(true);
  });

  it('checks an input against the action: unknown keys and missing required ones, templates welcome', () => {
    const update = spec(coreIds.actions.update_record);
    expect(
      stepInputProblem(update, { object: 'person', id: '{{record.id}}', values: { name: '{{record.name}}' } }),
    ).toBeNull();
    expect(stepInputProblem(update, { object: 'person', values: {} })).toMatchObject({ key: 'id' });
    expect(stepInputProblem(update, { object: 'person', id: 'x', values: {}, extra: 1 })).toMatchObject({
      key: 'extra',
    });
    expect(stepInputProblem(spec(coreIds.actions.aggregate_records), { object: 'deal' })).toBeNull();
    expect(literalObjectOf({ object: 'person' })).toBe('person');
    expect(literalObjectOf({ object: '{{event.payload.object}}' })).toBeUndefined();
    expect(literalObjectOf({})).toBeUndefined();
  });
});

describe('workflowRetryDelayMs', () => {
  it('waits half a minute before the first retry, doubles, and never more than an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(workflowRetryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
  });
});
