import type { DeviasClient, ImportBody, ImportReport, Workflow } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ImportDialog } from '../src/import/import-dialog';
import { chunksOf, problemRowsCsv } from '../src/import/problems';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const report = (patch: Partial<ImportReport> = {}): ImportReport => ({
  created: 0,
  updated: 0,
  skipped: 0,
  errorCount: 0,
  errors: [],
  dryRun: false,
  ...patch,
});

/** An import that creates every row it is given, and says so as the server does. */
const creating = () =>
  vi.fn(async (_object: string, body: ImportBody) =>
    report({ created: body.rows.length, dryRun: body.dryRun === true, ...(body.dryRun ? {} : { importId: 'imp-1' }) }),
  );

const open = (
  api: DeviasClient['records']['import'],
  options: { workflows?: Workflow[] } = {},
): { onOpenChange: ReturnType<typeof vi.fn> } => {
  const schema = schemaFixture();
  const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
  const onOpenChange = vi.fn();
  const workflows = options.workflows ?? [];
  const client = createFakeClient(schema, recordsFixture(), {
    import: api,
    workflows: {
      list: async () => workflows,
    } as unknown as DeviasClient['workflows'],
  });
  render(
    <TestProviders client={client} schema={schema}>
      <ImportDialog object={object} open onOpenChange={onOpenChange} />
    </TestProviders>,
  );

  return { onOpenChange };
};

const paste = (text: string) => fireEvent.change(screen.getByLabelText('Or paste it'), { target: { value: text } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('import dialog', () => {
  it('previews the rows, matches the columns by their header, checks without writing, then imports', async () => {
    const api = creating();
    open(api);
    paste('First name,Email,Nonsense\nAda,ada@example.com,x\nLinus,linus@example.com,y');

    const preview = await screen.findByText('2 rows, 3 columns');
    expect(preview).toBeTruthy();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    click('Next');

    // First name and E-mail find their fields; the third column has none.
    expect(screen.getByLabelText('Field for First name').textContent).toContain('First name');
    expect(screen.getByLabelText('Field for Email').textContent).toContain('Email');
    expect(screen.getByLabelText('Field for Nonsense').textContent).toContain("Don't import");

    click('Check');
    await screen.findByText('will be created', { exact: false });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]?.[1]).toMatchObject({
      columns: ['first_name', 'email', null],
      firstRow: 2,
      dryRun: true,
      rows: [
        ['Ada', 'ada@example.com', 'x'],
        ['Linus', 'linus@example.com', 'y'],
      ],
    });

    click('Import 2 people');
    await screen.findByText('created', { exact: false });
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1]?.[1]).toMatchObject({ dryRun: false });
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('treats a first row of data as data, and numbers its rows from 1', async () => {
    const api = creating();
    open(api);
    paste('Ada,ada@example.com\nLinus,linus@example.com');
    await screen.findByText('2 rows, 2 columns');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    click('Next');
    // Without a header there is nothing to match on: the person chooses.
    expect(screen.getByLabelText('Field for column 1').textContent).toContain("Don't import");
    expect(screen.getByRole('alert').textContent).toContain('First name is required');
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets the person choose the field of a column', async () => {
    const api = creating();
    open(api);
    paste('who,mail\nAda,ada@example.com');
    await screen.findByText('1 row, 2 columns');
    click('Next');
    const choose = async (column: string, field: string) => {
      fireEvent.click(screen.getByLabelText(`Field for ${column}`));
      const options = await screen.findAllByRole('option', { name: field });
      const option = options[options.length - 1] as HTMLElement;
      // Base UI selects on the pointer sequence, not on a bare click.
      fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
      fireEvent.mouseDown(option, { button: 0 });
      fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
      fireEvent.mouseUp(option, { button: 0 });
      fireEvent.click(option, { button: 0 });
      await waitFor(() => expect(screen.getByLabelText(`Field for ${column}`).textContent).toContain(field));
    };
    await choose('who', 'First name');
    await choose('mail', 'Email');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false),
    );
    click('Check');
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls[0]?.[1]).toMatchObject({ columns: ['first_name', 'email'], firstRow: 2 });
  });

  it('sends a big file in chunks of 500, numbering each from where it starts', async () => {
    const api = creating();
    open(api);
    const lines = Array.from({ length: 1203 }, (_, i) => `Person ${i}`);
    paste(['First name', ...lines].join('\n'));
    await screen.findByText('1,203 rows, 1 column');
    click('Next');
    click('Check');
    await screen.findByText('will be created', { exact: false });
    expect(api.mock.calls.map(([, body]) => [body.rows.length, body.firstRow])).toEqual([
      [500, 2],
      [500, 502],
      [203, 1002],
    ]);
    expect(screen.getByText('1,203', { selector: 'strong' })).toBeTruthy();
  });

  it('lists the problems with their row and column, and offers them as a file', async () => {
    const api = vi.fn(async (_object: string, body: ImportBody) =>
      report({
        created: 1,
        skipped: 1,
        errorCount: 1,
        errors: [{ row: 3, field: 'Email', message: '"nope" is not an email address' }],
        dryRun: body.dryRun === true,
      }),
    );
    open(api);
    paste('First name,Email\nAda,ada@example.com\nBad,nope');
    await screen.findByText('2 rows, 2 columns');
    click('Next');
    click('Check');
    const problems = await screen.findByText('Row 3');
    expect(problems.closest('li')?.textContent).toContain('Email: "nope" is not an email address');
    expect(screen.getByText('have problems and will be skipped', { exact: false })).toBeTruthy();

    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      saved.push(blob as Blob);

      return 'blob:problems';
    });
    URL.revokeObjectURL = vi.fn();
    click('Download the rows with problems');
    expect(saved).toHaveLength(1);
    expect(await saved[0]?.text()).toBe(
      'First name,Email,Problem\r\nBad,nope,"Email: ""nope"" is not an email address"',
    );
  });

  it('stops between chunks when asked, and reports what was done', async () => {
    let release: (() => void) | undefined;
    const api = vi.fn(async (_object: string, body: ImportBody) => {
      if (!body.dryRun) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }

      return report({ created: body.rows.length, dryRun: body.dryRun === true });
    });
    open(api);
    paste(['First name', ...Array.from({ length: 700 }, (_, i) => `P${i}`)].join('\n'));
    await screen.findByText('700 rows, 1 column');
    click('Next');
    click('Check');
    await screen.findByText('will be created', { exact: false });
    click('Import 700 people');
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    click('Stop');
    release?.();
    await screen.findByText('created', { exact: false });
    // The first chunk was written; the second never started.
    expect(api).toHaveBeenCalledTimes(3);
    expect(screen.getByText('500', { selector: 'strong' })).toBeTruthy();
  });

  it('says which workflows will not run for imported records', async () => {
    const workflow = (patch: Partial<Workflow>): Workflow =>
      ({
        id: 'wf',
        workspaceId: 'ws1',
        title: 'Welcome task',
        enabled: true,
        trigger: { kind: 'record_event', objectId: 'fixture.person', types: ['record.created'] },
        steps: [],
        lastRunAt: null,
        nextRunAt: null,
        ...patch,
      }) as Workflow;
    open(creating(), {
      workflows: [
        workflow({}),
        workflow({
          id: 'wf-2',
          title: 'Opted in',
          trigger: { kind: 'record_event', objectId: 'fixture.person', types: ['record.created'], onImport: true },
        }),
        workflow({ id: 'wf-3', title: 'Off', enabled: false }),
      ],
    });
    paste('First name\nAda');
    await screen.findByText('1 row, 1 column');
    click('Next');
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-slot="import-workflows"]');

      if (!found) {
        throw new Error('no notice yet');
      }

      return found as HTMLElement;
    });
    expect(notice.textContent).toContain('Welcome task runs when people are created, but not for imported ones');
    expect(within(notice).queryByText('Opted in', { exact: false })).toBeNull();
  });

  it('refuses a file with nothing in it', async () => {
    open(creating());
    paste(',\n,');
    expect((await screen.findByRole('alert')).textContent).toBe('There is nothing in it');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('import dialog box', () => {
  it('can be emptied and written again', async () => {
    open(creating());
    paste('First name\nAda');
    await screen.findByText('1 row, 1 column');
    paste('');
    expect((screen.getByLabelText('Or paste it') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    paste('First name\nGrace');
    await screen.findByText('1 row, 1 column');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('problem rows', () => {
  it('splits rows into chunks', () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunksOf([], 2)).toEqual([]);
  });

  it('writes the rows with problems, with the reason last, numbered as the spreadsheet is', () => {
    const rows = [['a', 'b'], ['c'], ['d', 'e']];
    const errors = [
      { row: 2, message: 'one' },
      { row: 2, field: 'B', message: 'two' },
      { row: 4, message: 'three, with a comma' },
    ];
    expect(problemRowsCsv(['X', 'Y'], rows, errors, 2)).toBe(
      'X,Y,Problem\r\na,b,one; B: two\r\nd,e,"three, with a comma"',
    );
  });
});
