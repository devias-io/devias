import {
  type ActionDefinitionInput,
  ActionDefinitionSchema,
  type BlockDefinition,
  type LayoutAction,
} from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RecordPage } from '../src/record/record-page';
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

/** A module installed in the workspace with these actions, as the schema carries it. */
const moduleWith = (...actions: ActionDefinitionInput[]) => ({
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
  actions: actions.map((action) => ActionDefinitionSchema.parse(action)),
  events: [],
});

const renderCompany = (actions: ActionDefinitionInput[] = [], layoutActions?: LayoutAction[]) => {
  const base = schemaFixture();
  const found = base.objects.find((object) => object.nameSingular === 'company');

  if (!found) {
    throw new Error('fixture');
  }

  // A layout of the company's own, when the test gives it a list of actions.
  const layouts =
    layoutActions === undefined
      ? base.layouts
      : [
          {
            workspaceId: found.workspaceId,
            objectId: found.id,
            id: 'fixture.company',
            label: 'Company',
            kind: 'record' as const,
            shell: 'tabs' as const,
            isDefault: true,
            tabs: [],
            actions: layoutActions,
            moduleId: null,
          },
        ];
  const schema = { ...base, layouts, modules: actions.length > 0 ? [moduleWith(...actions)] : [] };
  const company = schema.objects.find((object) => object.nameSingular === 'company');

  if (!company) {
    throw new Error('fixture');
  }

  const client = createFakeClient(schema, recordsFixture());
  render(
    <TestProviders
      client={client}
      schema={schema}
      navigation={createStaticNavigation('/workspaces/acme/records/company/c1')}
    >
      <RecordPage object={company} recordId="c1" />
    </TestProviders>,
  );

  return client;
};

describe('record page', () => {
  it('shows the fields in a Details tab, then the notes, the activity and related records as tabs after it', async () => {
    renderCompany();
    const details = await screen.findByRole('tab', { name: 'Details' });
    // Details first, then Notes and Activity, then a tab per relation pointing at the record, by its title alone (no count).
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Details',
      'Notes',
      'Activity',
      'People',
    ]);
    expect(details.getAttribute('aria-selected')).toBe('true');
    const fields = document.querySelector('[data-block="core.fields"]');
    expect(fields?.textContent).toContain('Acme');
    // The tabs sit in the header, under the title; nothing is beside the page.
    expect(document.querySelector('[data-slot="record-header"] [role="tablist"]')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('lets a block draw the header the layout names, and leaves the tabs to the layout', async () => {
    const base = schemaFixture();
    const company = base.objects.find((object) => object.nameSingular === 'company');

    if (!company) {
      throw new Error('fixture');
    }

    const header: BlockDefinition = {
      id: 'test.identity',
      label: 'Identity',
      icon: 'building-2',
      surfaces: { record: { frame: false } },
      component: ({ record }) => <div data-slot="identity">Account of {String(record?.name)}</div>,
    };
    const layout = {
      workspaceId: company.workspaceId,
      objectId: company.id,
      id: 'fixture.company',
      label: 'Company',
      kind: 'record' as const,
      shell: 'tabs' as const,
      isDefault: true,
      header: { name: 'identity', blockId: 'test.identity', label: '', config: {} },
      tabs: [
        {
          name: 'facts',
          label: 'Facts',
          blocks: [{ name: 'fields', blockId: 'core.fields', label: 'Facts', config: { fieldIds: ['name'] } }],
        },
      ],
      actions: [],
      moduleId: null,
    };
    const schema = { ...base, layouts: [layout] };
    render(
      <TestProviders
        client={createFakeClient(schema, recordsFixture())}
        schema={schema}
        config={resolvedFixture({ blocks: [header] })}
        navigation={createStaticNavigation('/workspaces/acme/records/company/c1')}
      >
        <RecordPage object={company} recordId="c1" />
      </TestProviders>,
    );
    const identity = await screen.findByText('Account of Acme');
    // In the header, where the icon, name and object label would be, not in a tab.
    expect(identity.closest('[data-slot="record-header"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="record-icon"]')).toBeNull();
    // The layout's tab comes first, ahead of the tabs that blocks place themselves.
    expect(screen.getAllByRole('tab')[0]?.textContent).toBe('Facts');
    expect(document.querySelector('[data-block="core.fields"]')).toBeTruthy();
  });

  describe('module actions', () => {
    const company = 'fixture.company';
    const sync: ActionDefinitionInput = {
      id: 'books.sync',
      label: 'Sync with Books',
      icon: 'refresh-cw',
      input: [{ name: 'company_id', label: 'Company', type: 'record', objectId: company, required: true }],
    };
    // The page lists what it offers: an action does not place itself.
    const listed: LayoutAction[] = [{ actionId: 'books.sync' }];

    const headerActions = () =>
      [...document.querySelectorAll('[data-action="record-action"]')].map((button) => button.textContent?.trim());

    it('shows an action the layout lists as a button of its own, and runs it with the record id', async () => {
      const client = renderCompany([sync], listed);
      const run = vi.spyOn(client.modules, 'runAction');
      fireEvent.click(await screen.findByRole('button', { name: /Sync with Books/ }));
      await waitFor(() => expect(run).toHaveBeenCalledWith('books', 'sync', { company_id: 'c1' }));
      // Not in the menu: that keeps Delete.
      fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
      expect(await screen.findByRole('menuitem', { name: /Delete/ })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: /Sync with Books/ })).toBeNull();
    });

    it('offers nothing the layout does not list, whatever actions are installed', async () => {
      renderCompany([sync], []);
      await screen.findByRole('button', { name: 'Record actions' });
      expect(headerActions()).toEqual([]);
    });

    it('fills the primary action and greys the others', async () => {
      renderCompany(
        [sync, { ...sync, id: 'books.archive', label: 'Archive' }],
        [{ actionId: 'books.sync' }, { actionId: 'books.archive', primary: true }],
      );
      const primary = await screen.findByRole('button', { name: /Archive/ });
      const other = screen.getByRole('button', { name: /Sync with Books/ });
      expect(primary.className).toContain('bg-primary');
      expect(other.className).not.toContain('bg-primary');
    });

    it('offers nothing for an action that takes another object, or for a record the filter excludes', async () => {
      renderCompany(
        [
          {
            ...sync,
            id: 'books.elsewhere',
            input: [{ name: 'company_id', label: 'Person', type: 'record', objectId: 'fixture.person' }],
          },
          { ...sync, id: 'books.only_big', label: 'Only big ones' },
        ],
        [
          { actionId: 'books.elsewhere' },
          { actionId: 'books.only_big', when: { field: 'name', op: 'eq', value: 'Globex' } },
        ],
      );
      await screen.findByRole('button', { name: 'Record actions' });
      expect(headerActions()).toEqual([]);
    });

    it('follows the layout’s list: its order and its labels', async () => {
      const client = renderCompany(
        [sync, { ...sync, id: 'books.archive', label: 'Archive' }, { ...sync, id: 'books.purge', label: 'Purge' }],
        // `purge` is installed, but this page does not list it.
        [
          { actionId: 'books.archive', label: 'Archive it' },
          { actionId: 'books.sync', primary: true, label: 'Sync now' },
        ],
      );
      const run = vi.spyOn(client.modules, 'runAction');
      fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
      await waitFor(() => expect(run).toHaveBeenCalledWith('books', 'sync', { company_id: 'c1' }));
      expect(headerActions()).toEqual(['Archive it', 'Sync now']);
    });

    it('asks for the other fields first, and runs once they are filled in', async () => {
      const client = renderCompany(
        [
          {
            ...sync,
            id: 'books.invoice',
            label: 'Send invoice',
            input: [
              { name: 'company_id', label: 'Company', type: 'record', objectId: company, required: true },
              { name: 'amount', label: 'Amount', type: 'number', required: true },
              { name: 'note', label: 'Note' },
            ],
          },
        ],
        [{ actionId: 'books.invoice' }],
      );
      const run = vi.spyOn(client.modules, 'runAction');
      fireEvent.click(await screen.findByRole('button', { name: /Send invoice/ }));
      const dialog = await screen.findByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: 'Send invoice' });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(run).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120.5' } });
      await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(submit);
      await waitFor(() => expect(run).toHaveBeenCalledWith('books', 'invoice', { amount: 120.5, company_id: 'c1' }));
    });
  });
});
