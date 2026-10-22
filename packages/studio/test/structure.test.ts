import { indexSchema, type PageDefinition } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { settingsPages } from '../src/pages/settings';
import { resolvePinned, resolveStructure } from '../src/shell/structure';
import { resolvedFixture, schemaFixture } from '../src/testing';

describe('resolveStructure', () => {
  const index = indexSchema(schemaFixture());
  const pages = new Map([
    ['records', { id: 'test.records', path: 'records', component: () => null }],
    ['settings', { ...(settingsPages[0] as PageDefinition), id: 'test.settings' }],
  ]);
  const ctx = { index, pages, slug: 'acme', pathname: '/workspaces/acme/records/person', search: {} };

  it('maps structure nodes to sidebar groups with dividers starting new groups', () => {
    const config = resolvedFixture({
      structure: (S) =>
        S.list().items([
          S.navItems(),
          S.divider('Sales'),
          S.listItem()
            .label('Pipeline')
            .icon('briefcase')
            .child(S.list().items([S.objectList('person', { view: 'fixture.person.all' }), S.objectList('company')])),
          S.page('settings'),
          S.page('missing-page'),
          S.objectList('nope'),
        ]),
    });
    const groups = resolveStructure(config.structure, ctx);
    expect(groups.map((g) => g.id)).toEqual(['main', expect.stringMatching(/^divider-/)]);
    const [main, sales] = groups;
    expect(main?.items.map((i) => [i.label, i.href])).toEqual([
      ['People', '/workspaces/acme/records/person'],
      ['Docs', 'https://example.com'],
    ]);
    expect(main?.items[0]?.active).toBe(true);
    expect(sales?.title).toBe('Sales');
    expect(sales?.items.map((i) => i.label)).toEqual(['Pipeline', 'Settings']);
    expect(sales?.items[0]?.children?.map((i) => [i.label, i.href])).toEqual([
      ['People', '/workspaces/acme/records/person?view=fixture.person.all'],
      ['Companies', '/workspaces/acme/records/company'],
    ]);
    expect(sales?.items[1]?.href).toBe('/workspaces/acme/settings');
  });

  it('skips nav items that point at an object that no longer exists', () => {
    const fixture = schemaFixture();
    const [first] = fixture.navItems;

    if (!first) {
      throw new Error('fixture');
    }

    const orphan = {
      ...first,
      id: 'workspace.orphan',
      label: 'Invoices',
      target: { kind: 'object' as const, objectId: 'workspace.gone' },
    };
    const withOrphan = indexSchema({ ...fixture, navItems: [...fixture.navItems, orphan] });
    const config = resolvedFixture({ structure: (S) => S.list().items([S.navItems()]) });
    const [main] = resolveStructure(config.structure, { ...ctx, index: withOrphan });
    expect(main?.items.map((i) => i.label)).toEqual(['People', 'Docs']);
  });

  it('expands the objects source and marks active by pathname and view param', () => {
    const config = resolvedFixture({ structure: (S) => S.list().items([S.objects()]) });
    const groups = resolveStructure(config.structure, { ...ctx, pathname: '/workspaces/acme/records/company/c1' });
    expect(groups[0]?.items.map((i) => [i.label, i.active])).toEqual([
      ['People', false],
      ['Companies', true],
    ]);
  });

  it('keeps a row that links to one view active on the other views and records of its object', () => {
    const config = resolvedFixture({
      structure: (S) => S.list().items([S.objectList('person', { view: 'fixture.person.all' })]),
    });
    const activeOn = (pathname: string, search: Record<string, string> = {}) =>
      resolveStructure(config.structure, { ...ctx, pathname, search })[0]?.items[0]?.active;
    expect(activeOn('/workspaces/acme/records/person', { view: 'fixture.person.all' })).toBe(true);
    expect(activeOn('/workspaces/acme/records/person', { view: 'another-view' })).toBe(true);
    expect(activeOn('/workspaces/acme/records/person/p1')).toBe(true);
    expect(activeOn('/workspaces/acme/records')).toBe(false);
  });

  it('nests workspace nav items under a group heading, which has no link of its own', () => {
    const schema = schemaFixture();
    const base = { workspaceId: 'ws1', moduleId: null, createdAt: '', updatedAt: '' } as const;
    const withNav = indexSchema({
      ...schema,
      navItems: [
        {
          ...base,
          id: 'fixture.contacts',
          label: 'Contacts',
          icon: 'users',
          target: { kind: 'group' },
          position: 0,
          parentId: null,
        },
        {
          ...base,
          id: 'fixture.people',
          label: 'People',
          target: { kind: 'object', objectId: 'fixture.person' },
          position: 0,
          parentId: 'fixture.contacts',
        },
        // A heading with nothing under it shows nothing.
        {
          ...base,
          id: 'fixture.empty',
          label: 'Empty',
          target: { kind: 'group' },
          position: 1,
          parentId: null,
        },
      ] as never,
    });
    const config = resolvedFixture({ structure: (S) => S.list().items([S.navItems()]) });
    const [main] = resolveStructure(config.structure, { ...ctx, index: withNav });
    expect(main?.items.map((i) => i.label)).toEqual(['Contacts']);
    const contacts = main?.items[0];
    expect(contacts?.href).toBeUndefined();
    expect(contacts?.children?.map((c) => [c.label, c.href])).toEqual([['People', '/workspaces/acme/records/person']]);
  });

  it('shows the workspace’s own names and order, and leaves hidden items (and what is under them) out', () => {
    const base = { workspaceId: 'ws1', moduleId: 'fixture', createdAt: '', updatedAt: '', icon: undefined } as const;
    const withNav = indexSchema({
      ...schemaFixture(),
      navItems: [
        {
          ...base,
          id: 'fixture.people',
          label: 'People',
          target: { kind: 'object', objectId: 'fixture.person' },
          position: 0,
          parentId: null,
          overrides: { label: 'Everyone', position: 5 },
        },
        {
          ...base,
          id: 'fixture.companies',
          label: 'Companies',
          target: { kind: 'object', objectId: 'fixture.company' },
          position: 1,
          parentId: null,
          overrides: null,
        },
        {
          ...base,
          id: 'fixture.section',
          label: 'Sales',
          target: { kind: 'group' },
          position: 2,
          parentId: null,
          overrides: { hidden: true },
        },
        {
          ...base,
          id: 'fixture.pipeline',
          label: 'Pipeline',
          target: { kind: 'object', objectId: 'fixture.opportunity' },
          position: 0,
          parentId: 'workspace.settings',
          overrides: null,
        },
        {
          ...base,
          id: 'fixture.notes',
          label: 'Notes',
          target: { kind: 'object', objectId: 'fixture.person' },
          position: 3,
          parentId: null,
          overrides: { hidden: true },
        },
      ] as never,
    });
    const config = resolvedFixture({ structure: (S) => S.list().items([S.navItems()]) });
    const [main] = resolveStructure(config.structure, { ...ctx, index: withNav });
    // Companies first (People moved to position 5), People under its own name, the rest hidden.
    expect(main?.items.map((i) => i.label)).toEqual(['Companies', 'Everyone']);
  });

  it('places a page with a nav item (shown or hidden), and skips one this workspace does not have', () => {
    const base = { workspaceId: 'ws1', moduleId: null, createdAt: '', updatedAt: '', overrides: null } as const;
    const navItems = [
      {
        ...base,
        id: 'workspace.records',
        label: 'All records',
        target: { kind: 'page', pageId: 'test.records' },
        position: 0,
        parentId: null,
      },
      {
        ...base,
        id: 'workspace.ghost',
        label: 'Ghost',
        target: { kind: 'page', pageId: 'test.not-installed' },
        position: 1,
        parentId: null,
      },
      {
        ...base,
        id: 'workspace.settings',
        label: 'Hidden settings',
        target: { kind: 'page', pageId: 'test.settings' },
        position: 2,
        parentId: null,
        overrides: { hidden: true },
      },
    ] as never;
    const index = indexSchema({ ...schemaFixture(), navItems });
    const config = resolvedFixture({ structure: (S) => S.list().items([S.navItems()]) });
    const [main] = resolveStructure(config.structure, { ...ctx, index });
    // The tool shows under its own name where the item puts it; the missing tool and the hidden item do not.
    expect(main?.items.map((i) => [i.label, i.href])).toEqual([['All records', '/workspaces/acme/records']]);
  });

  it('keeps pinned nav items out of the sections and gives them to the pinned list, in position order', () => {
    const base = { workspaceId: 'ws1', moduleId: 'studio', createdAt: '', updatedAt: '', overrides: null } as const;
    const navItems = [
      {
        ...base,
        id: 'studio.workflows',
        label: 'Workflows',
        pinned: true,
        position: -20,
        parentId: null,
        target: { kind: 'page', pageId: 'test.settings' },
      },
      {
        ...base,
        id: 'studio.home',
        label: 'Home',
        pinned: true,
        position: -30,
        parentId: null,
        target: { kind: 'page', pageId: 'test.records' },
      },
      {
        ...base,
        id: 'studio.gone',
        label: 'Gone',
        pinned: true,
        position: -10,
        parentId: null,
        target: { kind: 'page', pageId: 'test.not-installed' },
      },
      {
        ...base,
        id: 'fixture.people',
        label: 'People',
        pinned: false,
        position: 0,
        parentId: null,
        target: { kind: 'object', objectId: 'fixture.person' },
      },
      {
        ...base,
        id: 'fixture.hidden',
        label: 'Hidden',
        pinned: true,
        position: -5,
        parentId: null,
        target: { kind: 'page', pageId: 'test.records' },
        overrides: { hidden: true },
      },
    ] as never;
    const index = indexSchema({ ...schemaFixture(), navItems });
    const config = resolvedFixture({ structure: (S) => S.list().items([S.navItems()]) });
    const [main] = resolveStructure(config.structure, { ...ctx, index });
    // The sections never hold a pinned row, wherever the workspace arranged it.
    expect(main?.items.map((i) => i.label)).toEqual(['People']);
    // Pinned rows come in position order; a page this workspace does not have and a hidden row are left out.
    expect(resolvePinned({ ...ctx, index }).map((i) => [i.label, i.href])).toEqual([
      ['Home', '/workspaces/acme/records'],
      ['Workflows', '/workspaces/acme/settings'],
    ]);
  });
});
