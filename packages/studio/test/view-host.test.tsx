import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { format } from 'date-fns';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';
import { ViewHost } from '../src/views/view-host';
import { useViewStateStore } from '../src/views/view-state';

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

    const names = (view.config.fields ?? []).map((f: { fieldId: string }) => f.fieldId.split('.').pop() as string);
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
        v.id === 'fixture.person.all' ? { ...v, config: { ...v.config, settings: { quickCreate: true } } } : v,
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
      id: 'fixture.person.follow_up',
      name: 'follow_up',
      label: 'Follow up',
      type: 'date',
      isRequired: false,
      position: 9,
    });
    schema.views.push({
      ...table,
      id: 'fixture.person.follow_ups',
      label: 'Follow-ups',
      type: 'calendar',
      isDefault: false,
      position: 1,
      config: {
        fields: [{ fieldId: 'fixture.person.first_name', visible: true }],
        sorts: [],
        settings: { dateFieldId: 'fixture.person.follow_up' },
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
          <ViewHost object={object} viewId="fixture.person.follow_ups" />
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
