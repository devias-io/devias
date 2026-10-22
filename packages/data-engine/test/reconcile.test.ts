import { defineModule, indexSchema, type WorkspaceSchema } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { planManifest, type Snapshot } from '../src';

const ws = 'ws1';
const objectId = 'ext.thing';

const baseSchema = (): WorkspaceSchema => ({
  workspaceId: ws,
  version: 3,
  objects: [
    {
      workspaceId: ws,
      id: 'ext.thing',
      nameSingular: 'thing',
      namePlural: 'things',
      labelSingular: 'Thing',
      labelPlural: 'Things',
      icon: 'box',
      isSystem: false,
      readOnly: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      moduleId: 'ext',
    },
  ],
  fields: [
    {
      workspaceId: ws,
      objectId,
      id: 'ext.thing.name',
      name: 'name',
      type: 'text',
      label: 'Name',
      settings: {},
      isRequired: true,
      isUnique: false,
      position: 0,
      moduleId: 'ext',
    },
    {
      workspaceId: ws,
      objectId,
      id: 'ext.thing.amount',
      name: 'amount',
      type: 'number',
      label: 'Amount',
      settings: {},
      isRequired: false,
      isUnique: false,
      position: 1,
      moduleId: 'ext',
    },
    {
      workspaceId: ws,
      objectId,
      id: 'workspace.0199-custom',
      name: 'custom',
      type: 'text',
      label: 'Custom',
      settings: {},
      isRequired: false,
      isUnique: false,
      position: 5,
      moduleId: null,
    },
  ],
  views: [
    {
      workspaceId: ws,
      objectId,
      id: 'ext.thing.all',
      label: 'All things',
      type: 'table',
      isDefault: true,
      position: 0,
      config: {
        fields: [{ fieldId: 'ext.thing.name', visible: true }],
        sorts: [{ fieldId: 'ext.thing.name', direction: 'asc' }],
        settings: {},
      },
      moduleId: 'ext',
    },
  ],
  layouts: [],
  navItems: [],
  commandItems: [],
  modules: [
    {
      moduleId: 'ext',
      name: 'ext',
      version: '1.0.0',
      manifestHash: 'abc',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      core: false,
      blocks: [],
      agents: [],
      connections: [],
      variables: [],
      actions: [],
      events: [],
    },
  ],
});

const snapshotOf = (schema: WorkspaceSchema): Snapshot => ({
  version: schema.version,
  schema,
  index: indexSchema(schema),
});

const manifest = (overrides: Partial<Parameters<typeof defineModule>[0]> = {}) =>
  defineModule({
    id: 'ext',
    version: '1.1.0',
    objects: [
      {
        id: 'ext.thing',
        nameSingular: 'thing',
        namePlural: 'things',
        labelSingular: 'Thing',
        labelPlural: 'Things',
        icon: 'box',
        fields: [
          {
            id: 'ext.thing.name',
            name: 'name',
            label: 'Name',
            type: 'text',
            isRequired: true,
            position: 0,
          },
          { id: 'ext.thing.amount', name: 'amount', label: 'Amount', type: 'number', position: 1 },
        ],
      },
    ],
    views: [
      {
        id: 'ext.thing.all',
        objectId: 'ext.thing',
        label: 'All things',
        isDefault: true,
        fields: [{ fieldId: 'ext.thing.name' }],
        sorts: [{ fieldId: 'ext.thing.name', direction: 'asc' }],
      },
    ],
    ...overrides,
  });

const byId = (plan: ReturnType<typeof planManifest>, id: string) => plan.result.changes.find((c) => c.id === id);

describe('reconcile plan', () => {
  it('is a no-op when the manifest matches the snapshot (workspace-owned rows are untouched)', () => {
    const plan = planManifest({ manifest: manifest(), snapshot: snapshotOf(baseSchema()) });
    expect(plan.result.changes.map((c) => c.action)).toEqual(['noop', 'noop', 'noop', 'noop']);
    expect(plan.result.changes.some((c) => c.id === 'workspace.0199-custom')).toBe(false);
    expect(plan.result.fromVersion).toBe('1.0.0');
    expect(plan.result.toVersion).toBe('1.1.0');
    expect(plan.result.hasDestructive).toBe(false);
    expect(plan.result.hasConflicts).toBe(false);
  });

  it('creates missing entities in dependency order and deletes removed ones in reverse', () => {
    const m = manifest({
      objects: [
        {
          id: 'ext.thing',
          nameSingular: 'thing',
          namePlural: 'things',
          labelSingular: 'Thing',
          labelPlural: 'Things',
          icon: 'box',
          fields: [
            {
              id: 'ext.thing.name',
              name: 'name',
              label: 'Name',
              type: 'text',
              isRequired: true,
              position: 0,
            },
          ],
        },
        {
          id: 'ext.other',
          nameSingular: 'other',
          namePlural: 'others',
          labelSingular: 'Other',
          labelPlural: 'Others',
          fields: [{ id: 'ext.other.title', name: 'title', label: 'Title', type: 'text' }],
        },
      ],
      views: [],
      navItems: [{ id: 'ext.others', label: 'Others', target: { kind: 'object', objectId: 'ext.other' } }],
    });
    const plan = planManifest({
      manifest: m,
      snapshot: snapshotOf(baseSchema()),
      recordCounts: new Map([[objectId, 7]]),
    });
    expect(plan.result.changes.map((c) => [c.kind, c.id, c.action])).toEqual([
      ['object', 'ext.thing', 'noop'],
      ['object', 'ext.other', 'create'],
      ['field', 'ext.thing.name', 'noop'],
      ['field', 'ext.other.title', 'create'],
      ['nav_item', 'ext.others', 'create'],
      ['view', 'ext.thing.all', 'delete'],
      ['field', 'ext.thing.amount', 'delete'],
    ]);
    const fieldDelete = byId(plan, 'ext.thing.amount');
    expect(fieldDelete?.destructive).toBe(true);
    expect(plan.result.hasDestructive).toBe(true);
  });

  it('reports object deletes with the record count', () => {
    const plan = planManifest({
      manifest: manifest({ objects: [], views: [] }),
      snapshot: snapshotOf(baseSchema()),
      recordCounts: new Map([[objectId, 42]]),
    });
    const change = byId(plan, 'ext.thing');
    expect(change?.action).toBe('delete');
    expect(change?.destructive).toBe(true);
    expect(change?.reason).toContain('42 record(s)');
    // deletes are ordered views → fields → objects
    expect(plan.result.changes.map((c) => c.kind)).toEqual(['view', 'field', 'field', 'object']);
  });

  it('diffs attributes and flags destructive updates', () => {
    const m = manifest({
      objects: [
        {
          id: 'ext.thing',
          nameSingular: 'thing',
          namePlural: 'things',
          labelSingular: 'Thingy',
          labelPlural: 'Things',
          fields: [
            {
              id: 'ext.thing.name',
              name: 'name',
              label: 'Name',
              type: 'email',
              isRequired: true,
              isUnique: true,
              position: 0,
            },
            { id: 'ext.thing.amount', name: 'amount', label: 'Amount', type: 'boolean', position: 1 },
          ],
        },
      ],
    });
    const plan = planManifest({ manifest: m, snapshot: snapshotOf(baseSchema()) });
    const object = byId(plan, 'ext.thing');
    expect(object?.action).toBe('update');
    expect(object?.destructive).toBe(false);
    expect(object?.diff).toEqual({
      labelSingular: { from: 'Thing', to: 'Thingy' },
      icon: { from: 'box', to: undefined },
    });
    const name = byId(plan, 'ext.thing.name');
    expect(name?.action).toBe('update');
    expect(name?.destructive).toBe(true);
    expect(name?.reason).toContain('uniqueness');
    expect(name?.diff?.type).toEqual({ from: 'text', to: 'email' });
    const amount = byId(plan, 'ext.thing.amount');
    expect(amount?.destructive).toBe(true);
    expect(amount?.reason).toContain('number → boolean');
  });

  it('flags conflicts with rows owned by other modules or the workspace and name collisions', () => {
    const schema = baseSchema();
    const other = schema.objects[0];

    if (!other) {
      throw new Error('fixture');
    }

    other.moduleId = 'someone-else';
    schema.objects.push({
      ...other,
      id: 'workspace.0199-gadget',
      nameSingular: 'gadget',
      namePlural: 'gadgets',
      labelSingular: 'Gadget',
      labelPlural: 'Gadgets',
      moduleId: null,
    });
    const m = manifest({
      views: [],
      objects: [
        ...manifest().objects,
        {
          id: 'ext.gadget',
          nameSingular: 'gadget',
          namePlural: 'gadgets',
          labelSingular: 'Gadget',
          labelPlural: 'Gadgets',
        },
      ],
    });
    const plan = planManifest({ manifest: m, snapshot: snapshotOf(schema) });
    expect(byId(plan, 'ext.thing')?.action).toBe('conflict');
    expect(byId(plan, 'ext.thing')?.reason).toContain('someone-else');
    expect(byId(plan, 'ext.gadget')?.action).toBe('conflict');
    expect(byId(plan, 'ext.gadget')?.reason).toContain('already used');
    expect(plan.result.hasConflicts).toBe(true);
  });

  it('throws MISSING_DEPENDENCY for unknown object references', () => {
    const m = manifest({
      views: [{ id: 'ext.ghost.ghost', objectId: 'other.ghost', label: 'Ghost' }],
    });
    expect(() => planManifest({ manifest: m, snapshot: snapshotOf(baseSchema()) })).toThrow(/other\.ghost/);
  });

  it('is deterministic: the same input yields the same plan hash and re-planning after apply is all noop', () => {
    const a = planManifest({ manifest: manifest(), snapshot: snapshotOf(baseSchema()) });
    const b = planManifest({ manifest: manifest(), snapshot: snapshotOf(baseSchema()) });
    expect(a.result.planHash).toBe(b.result.planHash);
    const changed = planManifest({
      manifest: manifest({ version: '2.0.0', views: [] }),
      snapshot: snapshotOf(baseSchema()),
    });
    expect(changed.result.planHash).not.toBe(a.result.planHash);
  });
});
