import { describe, expect, it } from 'vitest';
import { ActionDefinitionSchema, type InstalledModule, layoutActionProblem, recordActionsOf } from '../src';

const ids = {
  books: '01a17522-1ec1-7a05-a6c3-0f2d5b0c9e11',
  company: '01a17522-1ec1-7a05-a6c3-13a8c4e7d2f0',
  sync: '01a17522-1ec1-7a05-a6c3-16b7e9a1c3d4',
  archive: '01a17522-1ec1-7a05-a6c3-1b04f6d8e5a2',
  merge: '01a17522-1ec1-7a05-a6c3-1e93a7c2b4f6',
  bill: '01a17522-1ec1-7a05-a6c3-2158d0e3f7a9',
  note: '01a17522-1ec1-7a05-a6c3-26c1b5a8d9e0',
  missing: '01a17522-1ec1-7a05-a6c3-2a7e3f4b6c1d',
  nope: '01a17522-1ec1-7a05-a6c3-2d40c8e5a7b2',
};
const actionIds: Record<string, string> = {
  sync: ids.sync,
  archive: ids.archive,
  merge: ids.merge,
  bill: ids.bill,
  note: ids.note,
};
const company = ids.company;
const invoice = '01a17522-1eb4-726b-9ea4-50173f291e22';

const installed = (id: string, actions: InstalledModule['actions']): InstalledModule => ({
  id: id,
  label: id,
  version: '1.0.0',
  manifestHash: 'h',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  core: false,
  blocks: [],
  agents: [],
  skills: [],
  connections: [],
  variables: [],
  actions,
  events: [],
});

const recordField = (name: string, objectId: string) => ({
  name,
  label: name,
  type: 'record' as const,
  objectId,
  required: true,
});

const action = (id: string, extra: Partial<InstalledModule['actions'][number]> = {}) =>
  ActionDefinitionSchema.parse({
    id: actionIds[id],
    name: id,
    label: `Do ${id}`,
    input: [recordField('company_id', company)],
    external: false,
    ...extra,
  });

const modules = [
  installed(ids.books, [
    action('sync', { icon: 'refresh-cw' }),
    action('archive'),
    action('merge', { input: [recordField('from_id', company), recordField('into_id', company)] }),
    action('bill', { input: [recordField('invoice_id', invoice)] }),
    action('note', { input: [{ name: 'text', label: 'Text', type: 'text', required: false }] }),
  ]),
];

describe('recordActionsOf', () => {
  it('offers exactly the layout’s list, in that order, with what an entry leaves out taken from the action', () => {
    const resolved = recordActionsOf(
      company,
      [
        { actionId: ids.archive, primary: true },
        { actionId: ids.sync, label: 'Refresh' },
      ],
      modules,
    );
    expect(resolved.map((item) => [item.key, item.label, item.primary, item.input])).toEqual([
      [ids.archive, 'Do archive', true, 'company_id'],
      [ids.sync, 'Refresh', false, 'company_id'],
    ]);
    // The entry did not name an icon, so the action's own shows; an action without one gets a default.
    expect(resolved.map((item) => item.icon)).toEqual(['zap', 'refresh-cw']);
    expect(resolved[1]).toMatchObject({ moduleId: ids.books });
  });

  it('offers nothing without a list: an action does not place itself', () => {
    expect(recordActionsOf(company, [], modules)).toEqual([]);
    expect(recordActionsOf(company, undefined, modules)).toEqual([]);
  });

  it('leaves out entries that cannot run: not installed, for another object, no record field, or repeated', () => {
    const resolved = recordActionsOf(
      company,
      [
        { actionId: ids.missing },
        { actionId: ids.bill },
        { actionId: ids.note },
        { actionId: ids.merge },
        { actionId: ids.sync },
        { actionId: ids.sync, label: 'Again' },
      ],
      modules,
    );
    expect(resolved.map((item) => [item.key, item.label])).toEqual([[ids.sync, 'Do sync']]);
  });

  it('takes the record field the entry names when the action has several for the object', () => {
    const [item] = recordActionsOf(company, [{ actionId: ids.merge, input: 'into_id' }], modules);
    expect(item?.input).toBe('into_id');
  });

  it('carries the entry’s filter', () => {
    const when = { field: 'status', op: 'eq' as const, value: 'open' };
    const [item] = recordActionsOf(company, [{ actionId: ids.sync, when }], modules);
    expect(item?.when).toEqual(when);
  });
});

describe('layoutActionProblem', () => {
  it('names what is wrong with an entry, so the agent can fix it', () => {
    expect(layoutActionProblem({ actionId: ids.sync }, modules, company)).toBeNull();
    expect(layoutActionProblem({ actionId: ids.nope }, modules, company)).toContain(
      'not an action of an installed module',
    );
    expect(layoutActionProblem({ actionId: ids.bill }, modules, company)).toContain(
      `takes a record of ${invoice}, not one of this layout's object (${company})`,
    );
    expect(layoutActionProblem({ actionId: ids.note }, modules, company)).toContain('takes no record');
    expect(layoutActionProblem({ actionId: ids.merge }, modules, company)).toContain('needs `input`');
    expect(layoutActionProblem({ actionId: ids.sync, input: 'id' }, modules, company)).toContain(
      'no record field "id"',
    );
    expect(layoutActionProblem({ actionId: ids.merge, input: 'from_id' }, modules, company)).toBeNull();
  });
});

describe('action fields', () => {
  it('a record field names its object, and only a record field does', () => {
    expect(
      ActionDefinitionSchema.safeParse({
        id: '01a17522-1ebd-72be-8b8b-c58dbc10ab79',
        name: 'a',
        label: 'A',
        input: [{ name: 'x', label: 'X', type: 'record' }],
      }).success,
    ).toBe(false);
    expect(
      ActionDefinitionSchema.safeParse({
        id: '01a17522-1ebd-72be-8b8b-c58dbc10ab79',
        name: 'a',
        label: 'A',
        input: [{ name: 'x', label: 'X', objectId: company }],
      }).success,
    ).toBe(false);
    expect(
      ActionDefinitionSchema.safeParse({
        id: '01a17522-1ebd-72be-8b8b-c58dbc10ab79',
        name: 'a',
        label: 'A',
        input: [recordField('x', company)],
      }).success,
    ).toBe(true);
  });
});
