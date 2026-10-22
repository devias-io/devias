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
  workflowScope,
} from '../src';

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
  const trigger: RecordEventTrigger = {
    kind: 'record_event',
    objectId: 'crm.opportunity',
    types: ['record.updated'],
    fieldIds: ['crm.opportunity.stage', 'crm.opportunity.amount'],
    condition: { field: 'crm.opportunity.stage', op: 'eq', value: 'customer' },
  };
  const fieldIdOf = (name: string) => `crm.opportunity.${name}`;
  const fieldNameOf = (ref: string) => ref.split('.').pop() ?? ref;
  const event = (patch: Partial<RecordEvent>): RecordEvent => ({
    sequence: 1,
    workspaceId: 'ws',
    actor: { kind: 'user', id: 'u' },
    occurredAt: 'x',
    type: 'record.updated',
    objectId: 'crm.opportunity',
    object: 'opportunity',
    recordId: 'r',
    changedFields: ['stage'],
    ...patch,
  });

  it('checks object, type and watched fields', () => {
    expect(matchesRecordEventTrigger(trigger, event({}), fieldIdOf)).toBe(true);
    expect(matchesRecordEventTrigger(trigger, event({ objectId: 'crm.person', object: 'person' }), fieldIdOf)).toBe(
      false,
    );
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
          actionId: 'core.update_record',
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
    expect(WorkflowInputSchema.safeParse({ ...base, trigger: { kind: 'schedule', everyMinutes: 0 } }).success).toBe(
      false,
    );
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
      actionId: 'core.update_record',
      input: { object: 'person', id: '{{record.id}}', values: { x: 1 } },
    },
    {
      id: 'if1',
      kind: 'branch',
      condition: { field: 'stage', op: 'eq', value: 'won' },
      yes: [
        { id: 'b', kind: 'action', actionId: 'core.create_record', input: { object: 'chore', values: {} } },
        {
          id: 'if2',
          kind: 'branch',
          condition: { field: 'amount', op: 'gt', value: 100 },
          yes: [
            {
              id: 'c',
              kind: 'action',
              actionId: 'core.update_record',
              input: { object: 'person', id: '{{record.id}}', values: {} },
            },
          ],
          no: [],
        },
      ],
      no: [{ id: 'd', kind: 'action', actionId: 'mailer.send_email', input: {} }],
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
              actionId: 'core.update_record',
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
    expect(findStep(nested, 'c')).toMatchObject({ kind: 'action', actionId: 'core.update_record' });
    expect(findStep(nested, 'zzz')).toBeUndefined();
  });

  it('reports size limits', () => {
    expect(stepLimitsProblem(nested)).toBeNull();
    expect(stepLimitsProblem([])).toMatch(/at least one/);
    const many: WorkflowStepInput[] = Array.from({ length: 51 }, () => ({
      kind: 'action',
      actionId: 'core.update_record',
      input: { object: 'person', id: '{{record.id}}', values: {} },
    }));
    expect(stepLimitsProblem(many)).toMatch(/at most 50/);
    let deep: WorkflowStepInput[] = [
      {
        kind: 'action',
        actionId: 'core.update_record',
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
      trigger: { kind: 'event', moduleId: 'payments', types: ['invoice.paid'] },
      steps: [
        {
          kind: 'action',
          actionId: 'mailer.send_email',
          input: { to: '{{event.payload.email}}' },
        },
      ],
    });
    expect(parsed.trigger.kind).toBe('event');
    expect(triggerObjectIdOf(parsed.trigger)).toBeUndefined();
    expect(triggerFollowsLog(parsed.trigger)).toBe(true);
    expect(triggerFollowsLog({ kind: 'manual' })).toBe(false);
    const trigger = { kind: 'event' as const, moduleId: 'payments', types: ['invoice.paid'] };
    expect(matchesModuleEventTrigger(trigger, { moduleId: 'payments', eventType: 'invoice.paid' })).toBe(true);
    expect(matchesModuleEventTrigger(trigger, { moduleId: 'payments', eventType: 'invoice.voided' })).toBe(false);
    expect(matchesModuleEventTrigger(trigger, { moduleId: 'mailer', eventType: 'invoice.paid' })).toBe(false);
    expect(matchesModuleEventTrigger({ ...trigger, types: ['*'] }, { moduleId: 'payments', eventType: 'x' })).toBe(
      true,
    );
    expect(WorkflowStepSchema.safeParse({ id: 's', kind: 'action', actionId: '', input: {} }).success).toBe(false);
  });

  it('renders module event payloads into templates', () => {
    const eventScope = workflowScope({
      workflow: { id: 'wf1', title: 'Paid' },
      trigger: { kind: 'event' },
      event: { type: 'invoice.paid', module: 'payments', id: 'e1', payload: { data: { object: { amount: 1200 } } } },
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
    expect(workflowCanRun(spec('core.update_record'))).toBe(true);
    expect(workflowCanRun(spec('core.add_record_note'))).toBe(true);
    expect(workflowCanRun(spec('core.aggregate_records'))).toBe(true);
    expect(workflowCanRun(spec('core.change_member_role'))).toBe(false);
    expect(workflowCanRun(spec('core.run_workflow'))).toBe(false);
    expect(workflowCanRun(spec('core.apply_module'))).toBe(false);
    expect(workflowCanRun({ permission: 'module.run', sessionOnly: false })).toBe(true);
  });

  it('checks an input against the action: unknown keys and missing required ones, templates welcome', () => {
    const update = spec('core.update_record');
    expect(
      stepInputProblem(update, { object: 'person', id: '{{record.id}}', values: { name: '{{record.name}}' } }),
    ).toBeNull();
    expect(stepInputProblem(update, { object: 'person', values: {} })).toMatchObject({ key: 'id' });
    expect(stepInputProblem(update, { object: 'person', id: 'x', values: {}, extra: 1 })).toMatchObject({
      key: 'extra',
    });
    expect(stepInputProblem(spec('core.aggregate_records'), { object: 'deal' })).toBeNull();
    expect(literalObjectOf({ object: 'person' })).toBe('person');
    expect(literalObjectOf({ object: '{{event.payload.object}}' })).toBeUndefined();
    expect(literalObjectOf({})).toBeUndefined();
  });
});
