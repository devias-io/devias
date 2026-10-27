import { coreIds, type DeviasClient, type Workflow, type WorkflowRun } from '@devias/core';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { format } from 'date-fns';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';
import { ViewHost } from '../src/views/view-host';
import { useViewStateStore } from '../src/views/view-state';

const toasts = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

beforeAll(installLayoutStubs);
afterEach(() => {
  cleanup();
  useViewStateStore.setState({ overrides: {} });
});

/** The filter chip for a field, once it rendered. */
const findChip = (label: string) =>
  waitFor(() => {
    const chip = [...document.querySelectorAll<HTMLElement>('[data-filter-chip]')].find((c) =>
      c.textContent?.includes(label),
    );

    if (!chip) {
      throw new Error(`no filter chip for ${label} yet`);
    }

    return chip;
  });

describe('ViewHost + table view', () => {
  it('renders the saved view: filter chip, count, rows with links and cells', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    // The saved filter (stage = new) shows as a chip and only matching rows are listed.
    const chip = await findChip('Stage');
    expect(chip.textContent).toMatch(/Stage\s*is\s*New/);
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByText('Linus')).toBeTruthy();
    expect(screen.queryByText('Grace')).toBeNull();
    expect(screen.getByText('2 records')).toBeTruthy();
    // Label column links to the record page, email cells render mailto links, select cells render badges.
    expect(screen.getByRole('link', { name: 'Ada' }).getAttribute('href')).toBe('/workspaces/acme/records/person/p1');
    expect(screen.getByRole('link', { name: 'ada@example.com' }).getAttribute('href')).toBe('mailto:ada@example.com');
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
    // The view name shows in the toolbar (single view → no switcher) and the search box exists.
    expect(screen.getByText('New people')).toBeTruthy();
    expect(screen.getByLabelText('Search records')).toBeTruthy();
    await waitFor(() => expect(client.calls.list).toBeGreaterThan(0));
  });

  it('adds a filter in two steps: pick the field, then the condition and value', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    await findChip('Stage');
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    // Step one: the fields, narrowed by typing.
    fireEvent.change(await screen.findByLabelText('Search fields'), { target: { value: 'ema' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    // Step two: the condition and the value.
    const form = await waitFor(() => {
      const found = document.querySelector('[data-slot="filter-condition"]');

      if (!found) {
        throw new Error('no condition editor yet');
      }

      return found as HTMLElement;
    });
    expect(screen.getByRole('button', { name: 'Change field' })).toBeTruthy();
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'ada@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const chip = await findChip('Email');
    expect(chip.textContent).toContain('ada@');
    expect(document.querySelectorAll('[data-filter-chip]')).toHaveLength(2);
  });

  it('keeps the title column first and locked, whatever order the view has', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    const view = schema.views.find((v) => v.objectId === object.id && v.isDefault) ?? schema.views[0];

    if (!view) {
      throw new Error('the fixture has no view');
    }

    const names = (view.config.fields ?? []).map(
      (f: { fieldId: string }) => schema.fields.find((field) => field.id === f.fieldId)?.name as string,
    );
    // A view that puts the title column last and hides it: the table still leads with it.
    const others = names.slice(1);
    useViewStateStore.getState().update(view.id, {
      fields: [
        ...others.map((name: string) => ({ name, visible: true })),
        { name: names[0] as string, visible: false },
      ],
    });
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} viewId={view.id} />
        </div>
      </TestProviders>,
    );
    await screen.findByText('Ada');
    const header = document.querySelector('[data-slot="table-scroll"]')?.firstElementChild?.firstElementChild;
    const labels = [...(header?.children ?? [])].slice(1).map((cell) => cell.textContent?.trim());
    const labelOf = (name: string) => schema.fields.find((f) => f.name === name && f.objectId === object.id)?.label;
    expect(labels[0]).toBe(labelOf(names[0] as string));

    // In the columns menu it is listed, locked, with nothing to drag or hide.
    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[data-slot="columns-menu"]');

      if (!found) {
        throw new Error('menu not open');
      }

      return found as HTMLElement;
    });
    const locked = menu.querySelector('[data-locked="true"]') as HTMLElement;
    expect(locked.textContent).toContain(labelOf(names[0] as string));
    expect(locked.textContent).toContain('Locked');
    expect(within(menu).queryByRole('button', { name: `Hide ${labelOf(names[0] as string)}` })).toBeNull();
    expect(within(menu).queryByRole('button', { name: `Show ${labelOf(names[0] as string)}` })).toBeNull();
    expect(within(menu).queryByRole('button', { name: new RegExp(`Drag ${labelOf(names[0] as string)}`) })).toBeNull();
  });

  it('shows and hides columns from the columns menu, with the hidden ones listed apart', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    await screen.findByText('Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[data-slot="columns-menu"]');

      if (!found) {
        throw new Error('menu not open');
      }

      return found as HTMLElement;
    });
    const count = () =>
      /(\d+) of (\d+)/
        .exec(menu.textContent ?? '')
        ?.slice(1, 3)
        .map(Number) ?? [];
    const [shownBefore, total] = count();
    expect(shownBefore).toBeGreaterThan(1);
    // A column the saved view leaves out starts in the hidden list.
    expect(within(menu).getByRole('button', { name: 'Show Company' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('button', { name: 'Hide Email' }));
    await waitFor(() => expect(count()).toEqual([(shownBefore ?? 0) - 1, total]));
    expect(menu.textContent).toContain('Hidden');
    expect(within(menu).getByRole('button', { name: 'Show Email' })).toBeTruthy();

    fireEvent.change(within(menu).getByLabelText('Search columns'), { target: { value: 'zzz' } });
    expect(menu.textContent).toContain('No columns match.');
    fireEvent.change(within(menu).getByLabelText('Search columns'), { target: { value: '' } });

    fireEvent.click(within(menu).getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(count()).toEqual([total, total]));
  });

  it('commits a value picked in an inline select cell', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const update = vi.spyOn(client.records, 'update');
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    const row = (await screen.findByRole('link', { name: 'Ada' })).closest('[style*="translateY"]');
    const cell = row?.querySelector('[data-field="stage"]');

    if (!cell) {
      throw new Error('stage cell not found');
    }

    fireEvent.doubleClick(cell);
    // The select opens straight away; picking an option commits it without a separate confirm. Base UI selects on
    // the pointer sequence, not on a bare click.
    const option = await screen.findByRole('option', { name: 'Won' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.mouseDown(option, { button: 0 });
    fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    fireEvent.mouseUp(option, { button: 0 });
    fireEvent.click(option, { button: 0 });
    await waitFor(() => expect(update).toHaveBeenCalledWith('person', 'p1', { stage: 'won' }));
  });

  it('keeps a cleared filter across reloads and clears it when the view is saved', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const save = vi.spyOn(client.metadata.views, 'update').mockResolvedValue(schema.views[0] as never);
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    await findChip('Stage');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Grace')).toBeTruthy();
    // Overrides live in session storage as JSON, which drops `undefined`; the cleared filter must survive it.
    const viewId = schema.views[0]?.id ?? '';
    const persisted = JSON.parse(JSON.stringify(useViewStateStore.getState().overrides[viewId]));
    expect(persisted).toEqual({ filter: null });
    fireEvent.click(screen.getByRole('button', { name: /save view/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(viewId, { config: expect.objectContaining({ filter: null, groupById: null }) }),
    );
  });

  it('creates an untitled record straight away from "New" when the view quick-creates', async () => {
    const base = schemaFixture();
    const schema = {
      ...base,
      views: base.views.map((v) =>
        v.id === '01a17522-948a-774f-9272-cf1d32843a07'
          ? { ...v, config: { ...v.config, settings: { quickCreate: true } } }
          : v,
      ),
    };
    const client = createFakeClient(schema, recordsFixture());
    const create = vi.spyOn(client.records, 'create');
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /New person/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('person', { first_name: 'Untitled' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('floats the bulk actions over the table when rows are selected; Escape clears the selection', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    await screen.findByText('Ada');
    expect(screen.queryByRole('toolbar', { name: 'Selected records' })).toBeNull();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0] as HTMLElement);
    const toolbar = await screen.findByRole('toolbar', { name: 'Selected records' });
    expect(toolbar.textContent).toContain('1 selected');
    // It overlays the view (absolutely positioned) rather than taking space above the rows.
    expect(toolbar.className).toContain('absolute');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected records' })).toBeNull());
  });

  describe('the ⋯ menu at the end of each row', () => {
    const personId = '01a1751f-5f09-7114-9d75-bebf2c7785e8';
    const manual: Workflow = {
      id: 'wf-enrich',
      workspaceId: 'ws1',
      title: 'Enrich this person',
      enabled: true,
      trigger: { kind: 'manual', objectId: personId },
      steps: [{ id: 's1', kind: 'action', actionId: coreIds.actions.update_record, input: {} }],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const show = () => {
      const schema = schemaFixture();
      const workflows = {
        list: vi.fn(async () => [manual]),
        recordRuns: vi.fn(async () => ({ items: [] })),
        run: vi.fn(async () => ({
          id: 'run-1',
          workflowId: manual.id,
          status: 'pending' as const,
          trigger: { kind: 'manual' as const, objectId: personId, recordId: 'p1' },
          steps: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
        })),
      } as unknown as DeviasClient['workflows'];
      const client = createFakeClient(schema, recordsFixture(), { workflows });
      const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
      render(
        <TestProviders client={client} schema={schema}>
          <div style={{ height: 600 }}>
            <ViewHost object={object} />
          </div>
        </TestProviders>,
      );

      return { client, workflows };
    };

    it('puts one on every row, named for its record, with the object manual workflows and Delete', async () => {
      show();
      await screen.findByText('Ada');
      expect(screen.getAllByRole('button', { name: /^Actions for / }).map((b) => b.getAttribute('aria-label'))).toEqual(
        ['Actions for Ada', 'Actions for Linus'],
      );
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Ada' }));
      expect(await screen.findByRole('menuitem', { name: /Copy link/ })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: /Enrich this person/ })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy();
    });

    it('runs a workflow on that row, and copies the link of that record, not of the table', async () => {
      const { workflows } = show();
      await screen.findByText('Linus');
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Linus' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Copy link/ }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/workspaces/acme/records/person/p3`),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Actions for Linus' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Enrich this person/ }));
      await waitFor(() => expect(workflows.run).toHaveBeenCalledWith('wf-enrich', { recordId: 'p3', wait: false }));
    });

    it('asks before deleting one row, then deletes only that record', async () => {
      const { client } = show();
      await screen.findByText('Ada');
      const remove = vi.spyOn(client.records, 'delete');
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Ada' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
      expect(await screen.findByText('Delete this person?')).toBeTruthy();
      expect(remove).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(remove).toHaveBeenCalledWith('person', ['p1']));
    });

    it('asks for the runs about a record only when its menu is opened, not for every row', async () => {
      const { workflows } = show();
      await screen.findByText('Ada');
      await waitFor(() => expect(workflows.list).toHaveBeenCalled());
      // The table asks once for the whole object; no row asks for itself.
      await waitFor(() => expect(workflows.recordRuns).toHaveBeenCalledTimes(1));
      expect(workflows.recordRuns).toHaveBeenCalledWith({ objectId: personId, limit: 100 });
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Ada' }));
      await screen.findByRole('menuitem', { name: /Enrich this person/ });
      await waitFor(() => expect(workflows.recordRuns).toHaveBeenCalledTimes(2));
      expect(workflows.recordRuns).toHaveBeenLastCalledWith({ recordId: 'p1' });
    });
  });

  describe('rows with a workflow run open on them', () => {
    const personId = '01a1751f-5f09-7114-9d75-bebf2c7785e8';
    const now = '2026-01-01T00:00:00.000Z';
    const enrich: Workflow = {
      id: 'wf-enrich',
      workspaceId: 'ws1',
      title: 'Enrich this person',
      enabled: true,
      trigger: { kind: 'manual', objectId: personId },
      steps: [{ id: 's1', kind: 'action', actionId: coreIds.actions.update_record, input: {} }],
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const runOn = (recordId: string, patch: Partial<WorkflowRun> = {}): WorkflowRun => ({
      id: `run-${recordId}`,
      workflowId: enrich.id,
      status: 'pending',
      trigger: { kind: 'manual', objectId: personId, recordId },
      steps: [],
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      ...patch,
    });
    const show = (runs: () => WorkflowRun[]) => {
      const schema = schemaFixture();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const workflows = {
        list: vi.fn(async () => [enrich]),
        recordRuns: vi.fn(async () => ({ items: runs() })),
        run: vi.fn(async () => runOn('p3')),
      } as unknown as DeviasClient['workflows'];
      const client = createFakeClient(schema, recordsFixture(), { workflows });
      const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
      render(
        <TestProviders client={client} schema={schema} queryClient={queryClient}>
          <div style={{ height: 600 }}>
            <ViewHost object={object} />
          </div>
        </TestProviders>,
      );

      return {
        workflows,
        /** What live updates do when the server says a run changed. */
        runChanged: () => queryClient.invalidateQueries({ queryKey: ['workspace', 'ws1', 'workflows'] }),
      };
    };

    /** The table row that has the ⋯ menu of this person. */
    const rowOf = (name: string) =>
      screen.getByRole('button', { name: `Actions for ${name}` }).closest('[class~="group/row"]') as HTMLElement;

    it('shows a spinner on the row being worked on, named for the workflow, and on no other', async () => {
      show(() => [runOn('p1', { status: 'running', startedAt: now })]);
      expect((await screen.findAllByRole('status')).map((s) => s.getAttribute('aria-label'))).toEqual([
        'Running Enrich this person',
      ]);
      expect(within(rowOf('Ada')).getByRole('status')).toBeTruthy();
      expect(within(rowOf('Linus')).queryByRole('status')).toBeNull();
    });

    it('lists every workflow working on one row, and counts a run waiting to try again as open', async () => {
      const waiting = runOn('p1', {
        steps: [{ id: 's1', kind: 'action', status: 'retrying', attempt: 1, retryAt: now }],
      });
      show(() => [runOn('p1', { status: 'running', startedAt: now }), { ...waiting, id: 'run-2' }]);
      expect((await screen.findByRole('status')).getAttribute('aria-label')).toBe(
        'Running Enrich this person, Enrich this person',
      );
    });

    it('draws nothing for runs that are done, or about no record', async () => {
      const { workflows } = show(() => [
        runOn('p1', { status: 'succeeded', finishedAt: now }),
        runOn('p3', { status: 'failed', finishedAt: now }),
        { ...runOn('p1'), id: 'run-x', trigger: { kind: 'manual', objectId: personId } },
      ]);
      await screen.findByText('Ada');
      await waitFor(() => expect(workflows.recordRuns).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('takes the spinner off when the run ends, and tells how it ended, once', async () => {
      toasts.mockClear();
      toasts.success.mockClear();
      let ended = false;
      const { runChanged } = show(() => [
        ended
          ? runOn('p3', {
              status: 'succeeded',
              finishedAt: now,
              steps: [{ id: 's1', kind: 'action', status: 'succeeded', output: { reason: 'Nothing new to add' } }],
            })
          : runOn('p3'),
      ]);
      // Started from this row's menu, so the person is waiting to hear about it.
      await screen.findByText('Linus');
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Linus' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Enrich this person/ }));
      await waitFor(() => expect(toasts).toHaveBeenCalledWith('Enrich this person started'));
      expect(await screen.findByRole('status')).toBeTruthy();

      ended = true;
      await runChanged();
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      await waitFor(() => expect(toasts).toHaveBeenCalledWith('Enrich this person: Nothing new to add'));
      toasts.mockClear();
      await runChanged();
      expect(toasts).not.toHaveBeenCalled();
    });
  });

  it('falls back to a synthetic table view when the object has no views', async () => {
    const schema = { ...schemaFixture(), views: [] };
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={client} schema={schema}>
        <ViewHost object={object} />
      </TestProviders>,
    );
    expect(await screen.findByText('All people')).toBeTruthy();
    expect(await screen.findByText('Grace')).toBeTruthy();
    expect(screen.getByText('3 records')).toBeTruthy();
    expect(screen.queryByText('Stage is New')).toBeNull();
  });
});

describe('ViewHost + calendar view', () => {
  it('puts each record on the day its date field names, and moves between months', async () => {
    const schema = schemaFixture();
    const [firstName] = schema.fields;
    const [table] = schema.views;

    if (!firstName || !table) {
      throw new Error('the fixture has fields and a view');
    }

    schema.fields.push({
      ...firstName,
      id: '01a17522-1eb8-7612-9ae6-7c446beaec5e',
      name: 'follow_up',
      label: 'Follow up',
      type: 'date',
      isRequired: false,
      position: 9,
    });
    schema.views.push({
      ...table,
      id: '01a17522-1eb8-7612-9ae6-83bdf1700394',
      label: 'Follow-ups',
      type: 'calendar',
      isDefault: false,
      position: 1,
      config: {
        fields: [{ fieldId: '01a17522-1eb8-7612-9ae6-873de332d467', visible: true }],
        sorts: [],
        settings: { dateFieldId: '01a17522-1eb8-7612-9ae6-7c446beaec5e' },
      },
    });
    const now = new Date();
    const day = (date: number) => format(new Date(now.getFullYear(), now.getMonth(), date), 'yyyy-MM-dd');
    const records = recordsFixture();
    const ada = records.person?.find((person) => person.first_name === 'Ada');
    const linus = records.person?.find((person) => person.first_name === 'Linus');

    if (!ada || !linus) {
      throw new Error('the fixture has Ada and Linus');
    }

    ada.follow_up = day(10);
    linus.follow_up = day(20);
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    render(
      <TestProviders client={createFakeClient(schema, records)} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} viewId="01a17522-1eb8-7612-9ae6-83bdf1700394" />
        </div>
      </TestProviders>,
    );
    expect(await screen.findByText(format(now, 'MMMM yyyy'))).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Linus' })).toBeTruthy();
    // Grace has no follow-up date, so she is on no day.
    expect(screen.queryByRole('button', { name: 'Grace' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ada' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('button', { name: 'Ada' })).toBeTruthy();
  });
});
