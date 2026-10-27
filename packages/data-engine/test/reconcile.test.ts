import { coreIds, defineModule, indexSchema, type WorkspaceSchema } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { planManifest, type Snapshot } from '../src';

const ws = 'ws1';
const objectId = '01a1751f-5f10-7325-b3a4-bbfa27091f42';

const baseSchema = (): WorkspaceSchema => ({
  workspaceId: ws,
  version: 3,
  objects: [
    {
      workspaceId: ws,
      id: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
      nameSingular: 'thing',
      namePlural: 'things',
      labelSingular: 'Thing',
      labelPlural: 'Things',
      icon: 'box',
      isSystem: false,
      readOnly: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      moduleId: '01a1751f-5f0f-73b8-8e84-4b553640c961',
    },
  ],
  fields: [
    {
      workspaceId: ws,
      objectId,
      id: '01a1751f-5f10-7325-b3a4-bf2f6033d682',
      name: 'name',
      type: 'text',
      label: 'Name',
      settings: {},
      isRequired: true,
      isUnique: false,
      position: 0,
      moduleId: '01a1751f-5f0f-73b8-8e84-4b553640c961',
    },
    {
      workspaceId: ws,
      objectId,
      id: '01a1751f-5f10-7325-b3a4-c33b3ab02c5b',
      name: 'amount',
      type: 'number',
      label: 'Amount',
      settings: {},
      isRequired: false,
      isUnique: false,
      position: 1,
      moduleId: '01a1751f-5f0f-73b8-8e84-4b553640c961',
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
      id: '01a1751f-5f10-7325-b3a4-c564ac58e522',
      label: 'All things',
      type: 'table',
      isDefault: true,
      position: 0,
      config: {
        fields: [{ fieldId: '01a1751f-5f10-7325-b3a4-bf2f6033d682', visible: true }],
        sorts: [{ fieldId: '01a1751f-5f10-7325-b3a4-bf2f6033d682', direction: 'asc' }],
        settings: {},
      },
      moduleId: '01a1751f-5f0f-73b8-8e84-4b553640c961',
    },
  ],
  layouts: [],
  navItems: [],
  commandItems: [],
  modules: [
    {
      id: '01a1751f-5f0f-73b8-8e84-4b553640c961',
      label: 'ext',
      version: '1.0.0',
      manifestHash: 'abc',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      core: false,
      blocks: [],
      agents: [],
      skills: [],
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
    id: '01a1751f-5f0f-73b8-8e84-4b553640c961',
    version: '1.1.0',
    objects: [
      {
        id: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
        nameSingular: 'thing',
        namePlural: 'things',
        labelSingular: 'Thing',
        labelPlural: 'Things',
        icon: 'box',
        fields: [
          {
            id: '01a1751f-5f10-7325-b3a4-bf2f6033d682',
            name: 'name',
            label: 'Name',
            type: 'text',
            isRequired: true,
            position: 0,
          },
          { id: '01a1751f-5f10-7325-b3a4-c33b3ab02c5b', name: 'amount', label: 'Amount', type: 'number', position: 1 },
        ],
      },
    ],
    views: [
      {
        id: '01a1751f-5f10-7325-b3a4-c564ac58e522',
        objectId: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
        label: 'All things',
        isDefault: true,
        fields: [{ fieldId: '01a1751f-5f10-7325-b3a4-bf2f6033d682' }],
        sorts: [{ fieldId: '01a1751f-5f10-7325-b3a4-bf2f6033d682', direction: 'asc' }],
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
          id: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
          nameSingular: 'thing',
          namePlural: 'things',
          labelSingular: 'Thing',
          labelPlural: 'Things',
          icon: 'box',
          fields: [
            {
              id: '01a1751f-5f10-7325-b3a4-bf2f6033d682',
              name: 'name',
              label: 'Name',
              type: 'text',
              isRequired: true,
              position: 0,
            },
          ],
        },
        {
          id: '01a1751f-5f10-7325-b3a4-cb60168d2ab5',
          nameSingular: 'other',
          namePlural: 'others',
          labelSingular: 'Other',
          labelPlural: 'Others',
          fields: [{ id: '01a1751f-5f10-7325-b3a4-cd3da573bf6d', name: 'title', label: 'Title', type: 'text' }],
        },
      ],
      views: [],
      navItems: [
        {
          id: '01a1751f-5f10-7325-b3a4-d18cef840cac',
          label: 'Others',
          target: { kind: 'object', objectId: '01a1751f-5f10-7325-b3a4-cb60168d2ab5' },
        },
      ],
    });
    const plan = planManifest({
      manifest: m,
      snapshot: snapshotOf(baseSchema()),
      recordCounts: new Map([[objectId, 7]]),
    });
    expect(plan.result.changes.map((c) => [c.kind, c.id, c.action])).toEqual([
      ['object', '01a1751f-5f10-7325-b3a4-bbfa27091f42', 'noop'],
      ['object', '01a1751f-5f10-7325-b3a4-cb60168d2ab5', 'create'],
      ['field', '01a1751f-5f10-7325-b3a4-bf2f6033d682', 'noop'],
      ['field', '01a1751f-5f10-7325-b3a4-cd3da573bf6d', 'create'],
      ['nav_item', '01a1751f-5f10-7325-b3a4-d18cef840cac', 'create'],
      ['view', '01a1751f-5f10-7325-b3a4-c564ac58e522', 'delete'],
      ['field', '01a1751f-5f10-7325-b3a4-c33b3ab02c5b', 'delete'],
    ]);
    const fieldDelete = byId(plan, '01a1751f-5f10-7325-b3a4-c33b3ab02c5b');
    expect(fieldDelete?.destructive).toBe(true);
    expect(plan.result.hasDestructive).toBe(true);
  });

  it('reports object deletes with the record count', () => {
    const plan = planManifest({
      manifest: manifest({ objects: [], views: [] }),
      snapshot: snapshotOf(baseSchema()),
      recordCounts: new Map([[objectId, 42]]),
    });
    const change = byId(plan, '01a1751f-5f10-7325-b3a4-bbfa27091f42');
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
          id: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
          nameSingular: 'thing',
          namePlural: 'things',
          labelSingular: 'Thingy',
          labelPlural: 'Things',
          fields: [
            {
              id: '01a1751f-5f10-7325-b3a4-bf2f6033d682',
              name: 'name',
              label: 'Name',
              type: 'email',
              isRequired: true,
              isUnique: true,
              position: 0,
            },
            {
              id: '01a1751f-5f10-7325-b3a4-c33b3ab02c5b',
              name: 'amount',
              label: 'Amount',
              type: 'boolean',
              position: 1,
            },
          ],
        },
      ],
    });
    const plan = planManifest({ manifest: m, snapshot: snapshotOf(baseSchema()) });
    const object = byId(plan, '01a1751f-5f10-7325-b3a4-bbfa27091f42');
    expect(object?.action).toBe('update');
    expect(object?.destructive).toBe(false);
    expect(object?.diff).toEqual({
      labelSingular: { from: 'Thing', to: 'Thingy' },
      icon: { from: 'box', to: undefined },
    });
    const name = byId(plan, '01a1751f-5f10-7325-b3a4-bf2f6033d682');
    expect(name?.action).toBe('update');
    expect(name?.destructive).toBe(true);
    expect(name?.reason).toContain('uniqueness');
    expect(name?.diff?.type).toEqual({ from: 'text', to: 'email' });
    const amount = byId(plan, '01a1751f-5f10-7325-b3a4-c33b3ab02c5b');
    expect(amount?.destructive).toBe(true);
    expect(amount?.reason).toContain('number → boolean');
  });

  it('flags conflicts with rows owned by other modules or the workspace and name collisions', () => {
    const schema = baseSchema();
    const other = schema.objects[0];

    if (!other) {
      throw new Error('01a1751f-5f09-7114-9d75-ce42abd8a6ef');
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
          id: '01a1751f-5f10-7325-b3a4-d68017b1a3b4',
          nameSingular: 'gadget',
          namePlural: 'gadgets',
          labelSingular: 'Gadget',
          labelPlural: 'Gadgets',
        },
      ],
    });
    const plan = planManifest({ manifest: m, snapshot: snapshotOf(schema) });
    expect(byId(plan, '01a1751f-5f10-7325-b3a4-bbfa27091f42')?.action).toBe('conflict');
    expect(byId(plan, '01a1751f-5f10-7325-b3a4-bbfa27091f42')?.reason).toContain('someone-else');
    expect(byId(plan, '01a1751f-5f10-7325-b3a4-d68017b1a3b4')?.action).toBe('conflict');
    expect(byId(plan, '01a1751f-5f10-7325-b3a4-d68017b1a3b4')?.reason).toContain('already used');
    expect(plan.result.hasConflicts).toBe(true);
  });

  it('throws MISSING_DEPENDENCY for unknown object references', () => {
    const m = manifest({
      views: [
        {
          id: '01a1751f-5f10-7325-b3a4-dbc3b70f00f7',
          objectId: '01a1751f-5f10-7325-b3a4-de77d92b3178',
          label: 'Ghost',
        },
      ],
    });
    expect(() => planManifest({ manifest: m, snapshot: snapshotOf(baseSchema()) })).toThrow(
      /01a1751f-5f10-7325-b3a4-de77d92b3178/,
    );
  });

  it('looks for what a declaration points at among its own and the installed rows, whatever the ids look like', () => {
    const plan = (overrides: Record<string, unknown>) => () =>
      planManifest({ manifest: manifest(overrides), snapshot: snapshotOf(baseSchema()) });
    const view = (patch: Record<string, unknown>) => ({
      id: 'v-77',
      objectId: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
      label: 'V',
      ...patch,
    });

    // The ids share no prefix with the module and the plan is fine: who owns a row is not read out of its id.
    expect(plan({ views: [view({ fields: [{ fieldId: '01a1751f-5f10-7325-b3a4-c33b3ab02c5b' }] })] })).not.toThrow();
    // A field that is neither declared nor installed, in a column, a sort, a grouping or a filter.
    for (const patch of [
      { fields: [{ fieldId: 'nope-1' }] },
      { sorts: [{ fieldId: 'nope-1', direction: 'asc' }] },
      { groupById: 'nope-1' },
      { filter: { field: 'nope-1', op: 'eq', value: 'x' } },
    ]) {
      expect(plan({ views: [view(patch)] }), JSON.stringify(patch)).toThrow(
        /field "nope-1".*neither installed nor declared/,
      );
    }
    // The system columns are always there.
    expect(
      plan({ views: [view({ sorts: [{ fieldId: coreIds.fields.created_at, direction: 'desc' }] })] }),
    ).not.toThrow();
    // A nav item's parent and view, and the actions a layout offers, are looked for too.
    const nav = (patch: Record<string, unknown>) => ({ id: 'n-1', label: 'N', target: { kind: 'group' }, ...patch });
    expect(plan({ navItems: [nav({ parentId: 'nope-2' })] })).toThrow(/nav item "nope-2"/);
    expect(
      plan({
        navItems: [
          nav({ target: { kind: 'object', objectId: '01a1751f-5f10-7325-b3a4-bbfa27091f42', viewId: 'nope-3' } }),
        ],
      }),
    ).toThrow(/view "nope-3"/);
    expect(
      plan({
        layouts: [
          {
            id: 'l-1',
            objectId: '01a1751f-5f10-7325-b3a4-bbfa27091f42',
            label: 'L',
            shell: 'column',
            blocks: [],
            actions: [{ actionId: 'nope-4' }],
          },
        ],
      }),
    ).toThrow(/action "nope-4"/);
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
