import { describe, expect, it } from 'vitest';
import {
  type BlockDefinition,
  blocksOn,
  defineBlockComponent,
  defineModule,
  defineModuleStudio,
  defineStudio,
  indexSchema,
  isBlockAvailable,
  isPageAvailable,
  layoutParentOf,
  type PageDefinition,
  pageTitle,
  resolveConfig,
  type WorkspaceSchema,
  WorkspaceSchemaSchema,
  walkStructure,
} from '../src';

const Noop = () => null;

const fieldType = (type: string) =>
  ({ type, label: type, icon: 'circle', cell: Noop, editor: Noop, toText: () => '' }) as never;

/** A module with nothing in its manifest, like the studio's own. */
const bare = (id: string) => defineModule({ id: id, version: '1.0.0' });

describe('resolveConfig', () => {
  it("takes the app's images for agents, none by default, and does not treat them as a contribution", () => {
    expect(resolveConfig(defineStudio({})).agentImages).toEqual({});
    const resolved = resolveConfig(defineStudio({ agentImages: { bot: '/agents/bot.png' } }));
    expect(resolved.agentImages).toEqual({ bot: '/agents/bot.png' });
    expect(resolved.contributions.at(-1)).not.toHaveProperty('agentImages');
  });

  it('is called Devias on the sign-in pages unless the config gives a title', () => {
    expect(resolveConfig(defineStudio({})).title).toBe('Devias');
    expect(resolveConfig(defineStudio({ title: 'Acme' })).title).toBe('Acme');
    expect(resolveConfig(defineStudio({}))).not.toHaveProperty('name');
  });

  it('flattens the modules a module brings depth-first and lets the studio config win', () => {
    const inner = defineModuleStudio(bare('inner'), { fieldTypes: [fieldType('rating')] });
    const outer = defineModuleStudio(bare('outer'), { modules: [inner()], fieldTypes: [fieldType('rating')] });
    const resolved = resolveConfig(
      defineStudio({
        modules: [outer()],
        fieldTypes: [fieldType('rating')],
        pages: [{ path: 'records', label: 'Records', component: Noop }],
      }),
    );
    expect(resolved.contributions.map((c) => c.id)).toEqual(['inner', 'outer', 'studio.config']);
    // The studio config is named by what it is, since it has no name of its own.
    expect(resolved.diagnostics.filter((d) => d.code === 'registry_override').map((d) => d.message)).toEqual([
      '"outer" overrides field type "rating".',
      '"studio.config" overrides field type "rating".',
    ]);
    expect(resolved.registries.fieldTypes.get('rating')).toBeDefined();
  });

  it('collects blocks by id and lands on Home when it is installed', () => {
    const block = (id: string) => ({
      id: id,
      label: id,
      icon: 'circle',
      surfaces: { home: {} },
      component: Noop,
    });
    const withHome = resolveConfig(
      defineStudio({
        modules: [
          defineModuleStudio(bare('01a1751f-5f09-7114-9d75-ce42abd8a6ef'), {
            blocks: [block('01a17522-1eb7-7744-b55d-a6cecb6732fe')],
          })(),
        ],
        blocks: [block('fea4aec2-0a95-4e10-8d49-5876ea2a6cf7')],
        pages: [
          { path: 'home', label: 'Home', component: Noop },
          { path: 'records', label: 'Records', component: Noop },
        ],
      }),
    );
    expect([...withHome.registries.blocks.keys()]).toEqual([
      '01a17522-1eb7-7744-b55d-a6cecb6732fe',
      'fea4aec2-0a95-4e10-8d49-5876ea2a6cf7',
    ]);
    expect(withHome.defaultPage).toBe('home');
    const withoutHome = resolveConfig(
      defineStudio({ pages: [{ path: 'records', label: 'Records', component: Noop }] }),
    );
    expect(withoutHome.defaultPage).toBe('records');
    expect(withoutHome.registries.blocks.size).toBe(0);
  });

  it('remembers which module contributed a block and hides it where the module or its objects are missing', () => {
    const manifest = defineModule({ id: '01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3', version: '1.0.0' });
    const mentionedIn = defineBlockComponent({
      id: '01a1751f-5f13-70e9-8acc-afad2551dcc3',
      label: 'Mentioned in',
      icon: 'file',
      requires: { objectIds: ['01a1751f-5f13-70e9-8acc-b2c0483ede8d'] },
      surfaces: { record: { placement: 'overview' }, home: {} },
      component: Noop,
    });
    const welcome = defineBlockComponent({
      id: 'fea4aec2-0a95-4e10-8d49-5876ea2a6cf7',
      label: 'Welcome',
      icon: 'hand',
      surfaces: { home: { order: 1 } },
      component: Noop,
    });
    const docs = defineModuleStudio(manifest, {
      blocks: [mentionedIn],
      pages: [{ path: 'library', label: 'Library', component: Noop }],
    });
    const resolved = resolveConfig(
      defineStudio({
        modules: [docs()],
        blocks: [welcome],
        pages: [{ path: 'records', label: 'Records', component: Noop }],
      }),
    );
    const stamped = resolved.registries.blocks.get('01a1751f-5f13-70e9-8acc-afad2551dcc3') as BlockDefinition;
    expect(stamped.module).toBe('01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3');
    expect(resolved.registries.blocks.get('fea4aec2-0a95-4e10-8d49-5876ea2a6cf7')?.module).toBeUndefined();

    const schema = (installed: boolean, withObject: boolean): WorkspaceSchema =>
      WorkspaceSchemaSchema.parse({
        workspaceId: 'f165a92b-007b-431e-ad38-667a16d64ca8',
        version: 1,
        objects: withObject
          ? [
              {
                workspaceId: 'f165a92b-007b-431e-ad38-667a16d64ca8',
                id: '01a1751f-5f13-70e9-8acc-b2c0483ede8d',
                nameSingular: 'document',
                namePlural: 'documents',
                labelSingular: 'Document',
                labelPlural: 'Documents',
                moduleId: '01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3',
                createdAt: '',
                updatedAt: '',
              },
            ]
          : [],
        fields: [],
        views: [],
        layouts: [],
        navItems: [],
        commandItems: [],
        modules: installed
          ? [
              {
                id: '01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3',
                label: 'Docs',
                version: '1.0.0',
                manifestHash: 'h',
                installedAt: '',
                updatedAt: '',
              },
            ]
          : [],
      });
    expect(isBlockAvailable(stamped, indexSchema(schema(true, true)))).toBe(true);
    expect(isBlockAvailable(stamped, indexSchema(schema(false, true)))).toBe(false);
    expect(isBlockAvailable(stamped, indexSchema(schema(true, false)))).toBe(false);
    // A core module's blocks never wait for an install row.
    expect(
      isBlockAvailable(stamped, indexSchema(schema(false, true)), new Set(['01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3'])),
    ).toBe(true);
    const blocks = resolved.registries.blocks.values();
    expect(blocksOn('home', blocks, indexSchema(schema(true, true))).map((b) => b.id)).toEqual([
      'fea4aec2-0a95-4e10-8d49-5876ea2a6cf7',
      '01a1751f-5f13-70e9-8acc-afad2551dcc3',
    ]);
    expect(blocksOn('panel', resolved.registries.blocks.values(), indexSchema(schema(true, true)))).toEqual([]);

    // Pages follow the same rule: a module's pages leave the sidebar, the palette and their routes where it is not
    // installed; the studio config's own pages stay.
    const library = resolved.registries.pages.get('library') as PageDefinition;
    const records = resolved.registries.pages.get('records') as PageDefinition;
    expect(library.module).toBe('01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3');
    expect(records.module).toBeUndefined();
    expect(isPageAvailable(library, indexSchema(schema(true, false)))).toBe(true);
    expect(isPageAvailable(library, indexSchema(schema(false, false)))).toBe(false);
    expect(
      isPageAvailable(library, indexSchema(schema(false, false)), new Set(['01a1751f-5f13-70e9-8acc-c6ae9f1dc4c3'])),
    ).toBe(true);
    expect(isPageAvailable(records, indexSchema(schema(false, false)))).toBe(true);
  });

  it('reports blocks a module registers without declaring them, and the other way round', () => {
    const manifest = defineModule({
      id: '01a1751f-5f0f-73b8-8e84-4b553640c961',
      version: '1.0.0',
      blocks: [
        { id: '01a1751f-5f13-70e9-8acc-b68bc424eace', label: 'Declared', surfaces: ['record'] },
        { id: '01a1751f-5f13-70e9-8acc-bb59e87ce4fd', label: 'Both', surfaces: ['home'] },
      ],
    });
    const block = (id: string, surfaces: BlockDefinition['surfaces']) =>
      defineBlockComponent({ id, label: id, icon: 'hand', surfaces, component: Noop });
    const ext = defineModuleStudio(manifest, {
      blocks: [
        block('01a1751f-5f13-70e9-8acc-bb59e87ce4fd', { record: {} }),
        block('9f34a101-7a9b-43f5-8785-9684ae2607ed', { home: {} }),
      ],
    });
    const { diagnostics } = resolveConfig(defineStudio({ modules: [ext()] }));
    expect(diagnostics.filter((d) => d.code === 'block_declaration').map((d) => d.message)).toEqual([
      '"01a1751f-5f0f-73b8-8e84-4b553640c961" declares block "01a1751f-5f13-70e9-8acc-bb59e87ce4fd" for other surfaces than it renders on (record).',
      '"01a1751f-5f0f-73b8-8e84-4b553640c961" registers block "9f34a101-7a9b-43f5-8785-9684ae2607ed" but its manifest does not declare it.',
      '"01a1751f-5f0f-73b8-8e84-4b553640c961" declares block "01a1751f-5f13-70e9-8acc-b68bc424eace" but registers none.',
    ]);
  });

  it('keeps the contact link for the shell, and has none by default', () => {
    expect(resolveConfig(defineStudio({}))).not.toHaveProperty('contact');
    const resolved = resolveConfig(defineStudio({ contact: { href: 'mailto:team@acme.test' } }));
    expect(resolved.contact).toEqual({ href: 'mailto:team@acme.test' });
    // It is the app's own setting, not something a module contributes.
    expect(resolved.contributions.at(-1)).not.toHaveProperty('contact');
  });

  it('takes an approval widget as a block like any other: declared in the manifest, and only live where its module is', () => {
    const manifest = defineModule({
      id: '01a1751f-5f13-70e9-8acc-ca15f44ce35b',
      version: '1.0.0',
      blocks: [{ id: '01a1751f-5f13-70e9-8acc-bfae84a66236', label: 'Confirm', surfaces: ['approval'] }],
    });
    const confirm = defineBlockComponent({
      id: '01a1751f-5f13-70e9-8acc-bfae84a66236',
      label: 'Confirm',
      icon: 'hand',
      // Typed with the call and the two answers, not the record.
      surfaces: { approval: { tools: ['pay_me__charge'] } },
      component: (props) => (props.surface === 'approval' && props.call.name ? null : null),
    });
    const ext = defineModuleStudio(manifest, { blocks: [confirm] });
    const resolved = resolveConfig(defineStudio({ modules: [ext()] }));
    expect(resolved.diagnostics.filter((d) => d.code === 'block_declaration')).toEqual([]);

    const installed = (on: boolean) =>
      indexSchema(
        WorkspaceSchemaSchema.parse({
          workspaceId: 'f165a92b-007b-431e-ad38-667a16d64ca8',
          version: 1,
          objects: [],
          fields: [],
          views: [],
          layouts: [],
          navItems: [],
          commandItems: [],
          modules: on
            ? [
                {
                  id: '01a1751f-5f13-70e9-8acc-ca15f44ce35b',
                  label: 'Pay me',
                  version: '1.0.0',
                  manifestHash: 'h',
                  installedAt: '',
                  updatedAt: '',
                },
              ]
            : [],
        }),
      );
    const blocks = [...resolved.registries.blocks.values()];
    expect(blocksOn('approval', blocks, installed(true)).map((b) => b.id)).toEqual([
      '01a1751f-5f13-70e9-8acc-bfae84a66236',
    ]);
    expect(blocksOn('approval', blocks, installed(false))).toEqual([]);
    expect(blocksOn('record', blocks, installed(true))).toEqual([]);
  });

  it('keeps the first of a module listed twice and reports it, and passes options to a module factory', () => {
    const dup = defineModuleStudio(bare('dup'));
    const resolved = resolveConfig(
      defineStudio({
        modules: [dup(), dup()],
        pages: [{ path: 'records', label: 'Records', component: Noop }],
      }),
    );
    expect(resolved.contributions.filter((c) => c.id === 'dup')).toHaveLength(1);
    expect(resolved.diagnostics.some((d) => d.code === 'duplicate_module')).toBe(true);
    const withOptions = defineModuleStudio<{ shortcut: string }>(bare('opt'), (options) => ({
      commands: [
        { id: '01a1751f-5f13-70e9-8acc-c3df4f3941b6', label: 'Go', shortcut: options.shortcut, run: () => {} },
      ],
    }));
    expect(withOptions({ shortcut: 'g o' }).commands?.[0]?.shortcut).toBe('g o');
    expect(withOptions.manifest.id).toBe('opt');
  });

  it('runs the structure resolver and registers component nodes as hidden pages', () => {
    const resolved = resolveConfig(
      defineStudio({
        pages: [{ path: 'records', label: 'Records', component: Noop }],
        structure: (S) =>
          S.list()
            .label('Root')
            .items([
              S.navItems(),
              S.divider(),
              S.listItem()
                .label('Sales')
                .child(S.list().items([S.objectList('opportunity', { view: 'pipeline' })])),
              S.page({ id: '01a1751f-5f13-70e9-8acc-cdc42c85188c', label: 'Reports', component: Noop }),
              S.page('missing'),
            ]),
      }),
    );
    const kinds: string[] = [];
    walkStructure(resolved.structure, (n) => kinds.push(n.kind));
    expect(kinds).toEqual(['list', 'dynamic', 'divider', 'listItem', 'list', 'objectList', 'page', 'page']);
    expect([...resolved.registries.pages.values()].some((page) => page.label === 'Reports')).toBe(true);
    expect(resolved.diagnostics.some((d) => d.code === 'missing_page' && d.message.includes('missing'))).toBe(true);
  });

  it('collects module manifests and flags duplicate ids across modules', () => {
    const manifest = (id: string) =>
      defineModule({
        id: id,
        version: '1.0.0',
        objects: [
          {
            id: `${id}.thing`,
            nameSingular: 'thing',
            namePlural: 'things',
            labelSingular: 'Thing',
            labelPlural: 'Things',
            fields: [{ id: `${id}.thing.name`, name: 'name', label: 'Name', type: 'text' }],
          },
        ],
      });
    const a = defineModuleStudio(manifest('ext-a'));
    const b = defineModuleStudio(manifest('ext-b'));
    const resolved = resolveConfig(
      defineStudio({
        modules: [a(), b()],
        pages: [{ path: 'records', label: 'Records', component: Noop }],
      }),
    );
    expect(resolved.manifests.map((m) => m.id)).toEqual(['ext-a', 'ext-b']);
    expect(a.manifest.id).toBe('ext-a');
    expect(resolved.diagnostics.filter((d) => d.code === 'duplicate_id')).toHaveLength(0);
  });
});

describe('page helpers', () => {
  const pages = new Map<string, PageDefinition>(
    [
      { path: 'billing', label: 'Billing', component: Noop },
      { path: 'billing/new', component: Noop },
      { path: 'billing/payouts', label: 'Payouts', component: Noop },
      { path: 'settings', label: 'Settings', layout: Noop, component: Noop },
      { path: 'settings/$section', component: Noop },
      { path: 'home', label: 'Home', component: Noop },
    ].map((page) => [page.path, page]),
  );

  it('titles a page from itself, else from its nearest titled ancestor', () => {
    expect(pageTitle(pages, 'billing/new')).toBe('Billing');
    expect(pageTitle(pages, 'billing/payouts')).toBe('Payouts');
    expect(pageTitle(pages, 'billing/inv-1/edit')).toBe('Billing');
    expect(pageTitle(pages, 'elsewhere')).toBeUndefined();
  });

  it('finds the layout a page sits in', () => {
    expect(layoutParentOf(pages, 'settings/$section')?.path).toBe('settings');
    expect(layoutParentOf(pages, 'settings')).toBeUndefined();
    expect(layoutParentOf(pages, 'billing/new')).toBeUndefined();
  });
});
