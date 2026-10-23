import {
  ActionDefinitionSchema,
  type BlockDefinition,
  type LayoutAction,
  layoutContentOf,
  makeLayout,
} from '@devias/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordActionButton, useRecordPage } from '../src/record';
import { RecordPage } from '../src/record/record-page';
import { saveStatusText } from '../src/record/shells/column-shell';
import { createStaticNavigation } from '../src/router/navigation';
import {
  createFakeClient,
  installLayoutStubs,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../src/testing';

beforeAll(() => {
  installLayoutStubs();
});
afterEach(cleanup);

/** An installed module with one action that takes a company. */
const booksModule = {
  moduleId: 'books',
  version: '0.1.0',
  manifestHash: 'h',
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  name: 'Books',
  core: false,
  blocks: [],
  agents: [],
  skills: [],
  connections: [],
  variables: [],
  actions: [
    ActionDefinitionSchema.parse({
      id: 'books.sync',
      label: 'Sync with Books',
      icon: 'refresh-cw',
      input: [{ name: 'company_id', label: 'Company', type: 'record', objectId: 'fixture.company', required: true }],
    }),
  ],
  events: [],
};

/** The fixture's company with a layout of its own in the given shell. */
const open = (
  layout: { shell: 'tabs' | 'column' | 'split'; actions?: unknown[]; [key: string]: unknown },
  options: { readOnly?: boolean; blocks?: BlockDefinition[] } = {},
) => {
  const base = schemaFixture();
  const found = base.objects.find((object) => object.nameSingular === 'company');

  if (!found) {
    throw new Error('fixture');
  }

  const company = { ...found, readOnly: options.readOnly ?? found.readOnly };
  const schema = {
    ...base,
    modules: [booksModule],
    objects: base.objects.map((object) => (object.id === company.id ? company : object)),
    layouts: [
      makeLayout(
        {
          workspaceId: company.workspaceId,
          objectId: company.id,
          id: 'fixture.company',
          label: 'Company',
          kind: 'record',
          isDefault: true,
          actions: (layout.actions ?? []) as LayoutAction[],
          moduleId: null,
        },
        layout.shell,
        layoutContentOf(layout),
      ),
    ],
  };
  // biome-ignore lint/suspicious/noExplicitAny: the test hands in loosely typed layout cells
  const client = createFakeClient(schema as any, recordsFixture());
  const update = vi.spyOn(client.records, 'update');
  const remove = vi.spyOn(client.records, 'delete');
  render(
    <TestProviders
      client={client}
      // biome-ignore lint/suspicious/noExplicitAny: see above
      schema={schema as any}
      config={resolvedFixture({ blocks: options.blocks ?? [] })}
      navigation={createStaticNavigation('/workspaces/acme/records/company/c1')}
    >
      <RecordPage object={company} recordId="c1" />
    </TestProviders>,
  );

  return { update, remove };
};

const columnLayout = {
  shell: 'column' as const,
  blocks: [
    { name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } },
    { name: 'body', blockId: 'core.rich_text', label: '', config: { fieldId: 'notes', autosaveMs: 50 } },
  ],
};

describe('the column shape', () => {
  it('is a slim toolbar over one column of bare blocks: no breadcrumbs, header, tabs or cards', async () => {
    open(columnLayout);
    const title = (await screen.findByLabelText('Title')) as HTMLTextAreaElement;
    expect(title.value).toBe('Acme');
    expect(document.querySelector('[data-slot="column-shell"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="record-header"]')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    // No card around a block: nothing carries the section frame.
    expect(document.querySelector('[data-slot="section"]')).toBeNull();
  });

  it('shows exactly the layout’s blocks, and none that places itself', async () => {
    open(columnLayout);
    await screen.findByLabelText('Title');
    expect(document.querySelector('[data-block="core.activity"]')).toBeNull();
    expect(document.querySelector('[data-block="core.notes"]')).toBeNull();
    expect(document.querySelector('[data-block="core.mentioned_in"]')).toBeNull();
  });

  it('gives a cell’s own title as a small heading, and none by default', async () => {
    open({
      shell: 'column',
      blocks: [
        { name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } },
        { name: 'fields', blockId: 'core.fields', label: 'Facts', config: { fieldIds: ['name'] } },
      ],
    });
    expect(await screen.findByRole('heading', { name: 'Facts' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull();
  });
});

const splitLayout = {
  shell: 'split' as const,
  main: [
    { name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } },
    { name: 'body', blockId: 'core.rich_text', label: '', config: { fieldId: 'notes' } },
    { name: 'activity', blockId: 'core.activity', label: 'Activity', config: {} },
  ],
  aside: [{ name: 'facts', blockId: 'core.fields', label: 'Facts', config: { fieldIds: ['name'] } }],
};

describe('the split shape', () => {
  it('is a top bar over a main column and an aside, with no header card, tabs or cards', async () => {
    open(splitLayout);
    const title = (await screen.findByLabelText('Title')) as HTMLTextAreaElement;
    expect(title.value).toBe('Acme');
    expect(document.querySelector('[data-slot="split-shell"]')).toBeTruthy();
    // The top bar has the breadcrumbs back to the object, and the ⋯ menu.
    expect(document.querySelector('[data-slot="breadcrumbs"]')?.textContent).toContain('Acme');
    expect(screen.getByRole('button', { name: 'Record actions' })).toBeTruthy();
    expect(document.querySelector('[data-slot="record-header"]')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelector('[data-slot="section"]')).toBeNull();
  });

  it('puts the layout’s main blocks in the main column and its aside beside it, named by its heading', async () => {
    open(splitLayout);
    await screen.findByLabelText('Title');
    const main = document.querySelector('[data-slot="split-main"]');
    const aside = screen.getByRole('complementary', { name: 'Facts' });
    expect([...(main?.querySelectorAll('[data-cell]') ?? [])].map((cell) => cell.getAttribute('data-cell'))).toEqual([
      'title',
      'body',
      'activity',
    ]);
    expect(aside.querySelector('[data-cell="facts"]')).toBeTruthy();
    expect(main?.contains(aside)).toBe(false);
    // A titled cell is a region with a heading, set off from the cell above it.
    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    expect(main?.querySelector('[data-cell="activity"]')?.className).toContain('border-t');
  });

  it('has no aside without blocks for it, and draws its title smaller than a column’s', async () => {
    open({ ...splitLayout, aside: [] });
    const title = await screen.findByLabelText('Title');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(title.className).toContain('text-xl');
    cleanup();
    open(columnLayout);
    expect((await screen.findByLabelText('Title')).className).toContain('text-2xl');
  });
});

describe('the split shape’s aside', () => {
  const KEY = 'devias:record-aside-width';
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  // The test environment has no storage of its own.
  beforeEach(() => {
    memory.clear();
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'localStorage');
  });

  it('can be resized with its grip or the arrow keys, remembers its width, and goes back on a double click', async () => {
    open(splitLayout);
    const grip = await screen.findByRole('separator', { name: 'Resize details' });
    const aside = document.querySelector('[data-slot="split-aside"]') as HTMLElement;
    // Until a width is given, the aside is the layout's own.
    expect(aside.style.getPropertyValue('--aside-width')).toBe('');
    expect(aside.className).toContain('@4xl:w-96');

    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    await waitFor(() => expect(aside.style.getPropertyValue('--aside-width')).toMatch(/^\d+px$/));
    expect(aside.className).toContain('@4xl:w-(--aside-width)');
    expect(window.localStorage.getItem(KEY)).toMatch(/^\d+$/);

    // A page opened later keeps it.
    cleanup();
    open(splitLayout);
    await screen.findByRole('separator', { name: 'Resize details' });
    expect(
      (document.querySelector('[data-slot="split-aside"]') as HTMLElement).style.getPropertyValue('--aside-width'),
    ).toMatch(/^\d+px$/);

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize details' }));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
    expect(
      (document.querySelector('[data-slot="split-aside"]') as HTMLElement).style.getPropertyValue('--aside-width'),
    ).toBe('');
  });

  it('has no grip when there is no aside', async () => {
    open({ ...splitLayout, aside: [] });
    await screen.findByLabelText('Title');
    expect(screen.queryByRole('separator', { name: 'Resize details' })).toBeNull();
  });
});

describe('the title block', () => {
  it('saves what is typed once the field is left, and not an empty title', async () => {
    const { update } = open(columnLayout);
    const title = (await screen.findByLabelText('Title')) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Acme Corp' } });
    fireEvent.blur(title);
    await waitFor(() => expect(update).toHaveBeenCalledWith('company', 'c1', { name: 'Acme Corp' }));
    update.mockClear();
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    // The last saved title comes back, and nothing is sent.
    await waitFor(() => expect(title.value).toBe('Acme Corp'));
    expect(update).not.toHaveBeenCalled();
  });

  it('puts the caret in the body on Enter', async () => {
    open(columnLayout);
    const title = await screen.findByLabelText('Title');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true));
  });

  it('is read-only on a read-only object', async () => {
    open(columnLayout, { readOnly: true });
    const title = (await screen.findByLabelText('Title')) as HTMLTextAreaElement;
    expect(title.readOnly).toBe(true);
  });
});

describe('the rich-text block', () => {
  const typeInto = async (text: string) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const dom = document.querySelector('.ProseMirror') as
      | (HTMLElement & { editor?: { commands: { insertContent: (t: string) => void } } })
      | null;
    await act(async () => {
      dom?.editor?.commands.insertContent(text);
    });
  };

  it('saves the field it edits shortly after typing stops, with the delay the cell asks for', async () => {
    const { update } = open(columnLayout);
    await screen.findByLabelText('Title');
    await typeInto('Meeting notes');
    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(update.mock.calls[0]?.[0]).toBe('company');
    expect(update.mock.calls[0]?.[2]).toHaveProperty('notes');
  });

  it('batches the title and the body into one save', async () => {
    const { update } = open(columnLayout);
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Acme Corp' } });
    await typeInto('Hello');
    await waitFor(() => expect(update).toHaveBeenCalled(), { timeout: 2000 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[2]).toMatchObject({ name: 'Acme Corp' });
    expect(update.mock.calls[0]?.[2]).toHaveProperty('notes');
  });

  it('is not editable on a read-only object', async () => {
    open(columnLayout, { readOnly: true });
    await screen.findByLabelText('Title');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  });
});

describe('the page’s edit session and delete flow', () => {
  it('shows the save status in the toolbar while an edit is saved', async () => {
    open(columnLayout);
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Acme Corp' } });
    fireEvent.blur(title);
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(/Saving…|Edited/));
  });

  it('asks before deleting, once, and deletes the record', async () => {
    const { remove } = open(columnLayout);
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    expect(await screen.findByText('Delete this company?')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith('company', ['c1']);
  });

  it('offers no menu on a read-only object', async () => {
    open(columnLayout, { readOnly: true });
    await screen.findByLabelText('Title');
    expect(screen.queryByRole('button', { name: 'Record actions' })).toBeNull();
  });

  it('is available to blocks only on a record page', () => {
    const Outside = () => {
      useRecordPage();

      return null;
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Outside />)).toThrow('useRecordPage must be used inside a record page');
    quiet.mockRestore();
  });
});

describe('the toolbar’s status text', () => {
  it('says what is happening, then when the record was last edited', () => {
    expect(saveStatusText('saving', undefined)).toBe('Saving…');
    expect(saveStatusText('error', undefined)).toBe('Could not save');
    expect(saveStatusText('idle', undefined)).toBe('');
    expect(saveStatusText('saved', new Date(Date.now() - 3 * 60_000).toISOString())).toBe('Edited 3 minutes ago');
  });
});

describe('module actions in a shell', () => {
  const body = [{ name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } }];
  const listed = [{ actionId: 'books.sync', label: 'Sync' }];

  it.each([
    ['column', { shell: 'column' as const, blocks: body, actions: listed }],
    ['split', { shell: 'split' as const, main: body, actions: listed }],
    ['tabs', { shell: 'tabs' as const, tabs: [{ name: 'main', label: 'Main', blocks: body }], actions: listed }],
  ])('draws the layout’s actions in the top bar of the %s shape', async (_name, layout) => {
    open(layout);
    const button = await screen.findByRole('button', { name: 'Sync' });
    expect(button.getAttribute('data-action')).toBe('record-action');
    cleanup();
    // Not listed, not shown.
    open({ ...layout, actions: [] });
    await screen.findByRole('button', { name: 'Record actions' });
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
  });

  it('lets a block put an action wherever it likes', async () => {
    const header: BlockDefinition = {
      id: 'test.own-header',
      label: 'Own header',
      icon: 'building-2',
      surfaces: { record: { frame: false } },
      component: () => (
        <div data-slot="own-header">
          <RecordActionButton actionId="books.sync" label="Sync here" />
          <RecordActionButton actionId="books.nope" label="Never" />
        </div>
      ),
    };
    open(
      {
        shell: 'tabs',
        tabs: [
          { name: 'main', label: 'Main', blocks: [{ name: 'h', blockId: 'test.own-header', label: '', config: {} }] },
        ],
      },
      { blocks: [header] },
    );
    const own = await screen.findByRole('button', { name: 'Sync here' });
    expect(own.closest('[data-slot="own-header"]')).toBeTruthy();
    // An action that is not installed draws nothing, and the page lists none of its own.
    expect(screen.queryByRole('button', { name: 'Never' })).toBeNull();
    expect(document.querySelectorAll('[data-action="record-action"]')).toHaveLength(1);
  });
});

describe('an optional cell', () => {
  it('is left out, with no gap and no placeholder, when its block is not available; a plain one shows a placeholder', async () => {
    const cell = (key: string, extra: Record<string, unknown> = {}) => ({
      key,
      blockId: 'other.missing',
      label: 'Elsewhere',
      config: {},
      ...extra,
    });
    open({
      shell: 'split',
      main: [
        { name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } },
        cell('later', { optional: true }),
      ],
      aside: [],
    });
    await screen.findByLabelText('Title');
    expect(document.querySelector('[data-cell="later"]')).toBeNull();
    expect(screen.queryByText(/Unknown block/)).toBeNull();
    cleanup();
    open({
      shell: 'split',
      main: [{ name: 'title', blockId: 'core.title', label: '', config: { fieldId: 'name' } }, cell('later')],
      aside: [],
    });
    expect(await screen.findByText(/Unknown block/)).toBeTruthy();
  });
});
