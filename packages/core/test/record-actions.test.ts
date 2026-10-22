import { describe, expect, it } from 'vitest';
import { ActionDefinitionSchema, type InstalledModule, layoutActionProblem, recordActionsOf } from '../src';

const company = 'books.company';
const invoice = 'books.invoice';

const installed = (id: string, actions: InstalledModule['actions']): InstalledModule => ({
  moduleId: id,
  name: id,
  version: '1.0.0',
  manifestHash: 'h',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  core: false,
  blocks: [],
  agents: [],
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
    id: `books.${id}`,
    label: `Do ${id}`,
    input: [recordField('company_id', company)],
    external: false,
    ...extra,
  });

const modules = [
  installed('books', [
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
        { actionId: 'books.archive', primary: true },
        { actionId: 'books.sync', label: 'Refresh' },
      ],
      modules,
    );
    expect(resolved.map((item) => [item.key, item.label, item.primary, item.input])).toEqual([
      ['books.archive', 'Do archive', true, 'company_id'],
      ['books.sync', 'Refresh', false, 'company_id'],
    ]);
    // The entry did not name an icon, so the action's own shows; an action without one gets a default.
    expect(resolved.map((item) => item.icon)).toEqual(['zap', 'refresh-cw']);
    expect(resolved[1]).toMatchObject({ moduleId: 'books' });
  });

  it('offers nothing without a list: an action does not place itself', () => {
    expect(recordActionsOf(company, [], modules)).toEqual([]);
    expect(recordActionsOf(company, undefined, modules)).toEqual([]);
  });

  it('leaves out entries that cannot run: not installed, for another object, no record field, or repeated', () => {
    const resolved = recordActionsOf(
      company,
      [
        { actionId: 'gone.sync' },
        { actionId: 'books.bill' },
        { actionId: 'books.note' },
        { actionId: 'books.merge' },
        { actionId: 'books.sync' },
        { actionId: 'books.sync', label: 'Again' },
      ],
      modules,
    );
    expect(resolved.map((item) => [item.key, item.label])).toEqual([['books.sync', 'Do sync']]);
  });

  it('takes the record field the entry names when the action has several for the object', () => {
    const [item] = recordActionsOf(company, [{ actionId: 'books.merge', input: 'into_id' }], modules);
    expect(item?.input).toBe('into_id');
  });

  it('carries the entry’s filter', () => {
    const when = { field: 'status', op: 'eq' as const, value: 'open' };
    const [item] = recordActionsOf(company, [{ actionId: 'books.sync', when }], modules);
    expect(item?.when).toEqual(when);
  });
});

describe('layoutActionProblem', () => {
  it('names what is wrong with an entry, so the agent can fix it', () => {
    expect(layoutActionProblem({ actionId: 'books.sync' }, modules, company)).toBeNull();
    expect(layoutActionProblem({ actionId: 'books.nope' }, modules, company)).toContain(
      'not an action of an installed module',
    );
    expect(layoutActionProblem({ actionId: 'books.bill' }, modules, company)).toContain(
      `takes a record of ${invoice}, not one of this layout's object (${company})`,
    );
    expect(layoutActionProblem({ actionId: 'books.note' }, modules, company)).toContain('takes no record');
    expect(layoutActionProblem({ actionId: 'books.merge' }, modules, company)).toContain('needs `input`');
    expect(layoutActionProblem({ actionId: 'books.sync', input: 'id' }, modules, company)).toContain(
      'no record field "id"',
    );
    expect(layoutActionProblem({ actionId: 'books.merge', input: 'from_id' }, modules, company)).toBeNull();
  });
});

describe('action fields', () => {
  it('a record field names its object, and only a record field does', () => {
    expect(
      ActionDefinitionSchema.safeParse({
        id: 'books.a',
        label: 'A',
        input: [{ name: 'x', label: 'X', type: 'record' }],
      }).success,
    ).toBe(false);
    expect(
      ActionDefinitionSchema.safeParse({
        id: 'books.a',
        label: 'A',
        input: [{ name: 'x', label: 'X', objectId: company }],
      }).success,
    ).toBe(false);
    expect(
      ActionDefinitionSchema.safeParse({ id: 'books.a', label: 'A', input: [recordField('x', company)] }).success,
    ).toBe(true);
  });
});
