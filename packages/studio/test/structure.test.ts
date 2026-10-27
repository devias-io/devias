import { indexSchema, type PageDefinition } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { settingsPages } from '../src/pages/settings';
import { resolvePinned, resolveStructure } from '../src/shell/structure';
import { resolvedFixture, schemaFixture } from '../src/testing';

describe('resolveStructure', () => {
  const index = indexSchema(schemaFixture());
  const pages = new Map([
    ['records', { id: '01a17522-1eb7-7744-b55d-96b2254a9895', path: 'records', component: () => null }],
    ['settings', { ...(settingsPages[0] as PageDefinition), id: '01a17522-1eb7-7744-b55d-9a79ac411ec5' }],
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
            .child(
              S.list().items([
                S.objectList('person', { view: '01a17522-948a-774f-9272-cf1d32843a07' }),
                S.objectList('company'),
              ]),
            ),
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
      ['People', '/workspaces/acme/records/person?view=01a17522-948a-774f-9272-cf1d32843a07'],
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
      structure: (S) => S.list().items([S.objectList('person', { view: '01a17522-948a-774f-9272-cf1d32843a07' })]),
    });
    const activeOn = (pathname: string, search: Record<string, string> = {}) =>
      resolveStructure(config.structure, { ...ctx, pathname, search })[0]?.items[0]?.active;
    expect(activeOn('/workspaces/acme/records/person', { view: '01a17522-948a-774f-9272-cf1d32843a07' })).toBe(true);
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
          id: '01a1751f-5f09-7114-9d75-b7755caf4904',
          label: 'Contacts',
          icon: 'users',
          target: { kind: 'group' },
          position: 0,
          parentId: null,
        },
        {
          ...base,
          id: '01a1751f-5f09-7114-9d75-bae48e0719e6',
          label: 'People',
          target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
          position: 0,
          parentId: '01a1751f-5f09-7114-9d75-b7755caf4904',
        },
        // A heading with nothing under it shows nothing.
        {
          ...base,
          id: '01a17522-1eb7-7744-b55d-9f325bef54ae',
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
    const base = {
      workspaceId: 'ws1',
      moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
      createdAt: '',
      updatedAt: '',
      icon: undefined,
    } as const;
    const withNav = indexSchema({
      ...schemaFixture(),
      navItems: [
        {
          ...base,
          id: '01a1751f-5f09-7114-9d75-bae48e0719e6',
          label: 'People',
          target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
          position: 0,
          parentId: null,
          overrides: { label: 'Everyone', position: 5 },
        },
        {
          ...base,
          id: '01a1751f-5f09-7114-9d75-c382766ba2a2',
          label: 'Companies',
          target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' },
          position: 1,
          parentId: null,
          overrides: null,
        },
        {
          ...base,
          id: '01a17522-1eb7-7744-b55d-a339373d029e',
          label: 'Sales',
          target: { kind: 'group' },
          position: 2,
          parentId: null,
          overrides: { hidden: true },
        },
        {
          ...base,
          id: '01a17522-1eb7-7744-b55d-a6cecb6732fe',
          label: 'Pipeline',
          target: { kind: 'object', objectId: '01a17522-1eb7-7744-b55d-ab0f8f95f17d' },
          position: 0,
          parentId: 'workspace.settings',
          overrides: null,
        },
        {
          ...base,
          id: '01a17522-1eb7-7744-b55d-aee680c0f0f2',
          label: 'Notes',
          target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
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
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-96b2254a9895' },
        position: 0,
        parentId: null,
      },
      {
        ...base,
        id: 'workspace.ghost',
        label: 'Ghost',
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-b2792ab66759' },
        position: 1,
        parentId: null,
      },
      {
        ...base,
        id: 'workspace.settings',
        label: 'Hidden settings',
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-9a79ac411ec5' },
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
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-9a79ac411ec5' },
      },
      {
        ...base,
        id: 'studio.home',
        label: 'Home',
        pinned: true,
        position: -30,
        parentId: null,
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-96b2254a9895' },
      },
      {
        ...base,
        id: 'studio.gone',
        label: 'Gone',
        pinned: true,
        position: -10,
        parentId: null,
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-b2792ab66759' },
      },
      {
        ...base,
        id: '01a1751f-5f09-7114-9d75-bae48e0719e6',
        label: 'People',
        pinned: false,
        position: 0,
        parentId: null,
        target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
      },
      {
        ...base,
        id: '01a17522-1eb7-7744-b55d-b509d4f967fa',
        label: 'Hidden',
        pinned: true,
        position: -5,
        parentId: null,
        target: { kind: 'page', pageId: '01a17522-1eb7-7744-b55d-96b2254a9895' },
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
