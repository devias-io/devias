import type { BlockDefinition, HomeSurface, Workflow, WorkspaceSchema } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/home';
import { useHomeLayoutStore } from '../src/pages/home/layout';
import { createFakeClient, recordsFixture, resolvedFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(() => {
  cleanup();
  useHomeLayoutStore.setState({ saved: {} });
});

const block = (id: string, home: HomeSurface, component: BlockDefinition['component']): BlockDefinition => ({
  id: `test.${id}`,
  label: id.toUpperCase(),
  icon: 'circle',
  surfaces: { home },
  component,
});

describe('HomePage', () => {
  it('greets by first name and shows the Home blocks in order, isolating a failing one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = resolvedFixture({
      blocks: [
        block('b', { order: 20 }, () => <div>Card B</div>),
        block('a', { order: 10 }, () => <div>Card A</div>),
        block('broken', { order: 30 }, () => {
          throw new Error('boom');
        }),
      ],
    });
    const { container } = render(
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} config={config}>
        <HomePage />
      </TestProviders>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^(Morning|Afternoon|Evening) Test$/);
    const order = [...container.querySelectorAll('[data-block]')].map((el) => el.getAttribute('data-block'));
    // The studio's own Home blocks come first (getting started) and last (your data, recently updated, ask).
    expect(order).toEqual([
      'core.getting_started',
      'test.a',
      'test.b',
      'core.open_tasks',
      'core.recent_documents',
      'test.broken',
      'core.record_counts',
      'core.recent_records',
      // Placed below the grid, last.
      'core.ask_agent',
    ]);
    expect(screen.getByText('Card A')).toBeTruthy();
    expect(screen.getByText('BROKEN failed to load')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('puts the quick actions and the blocks placed below the grid in the centered column', async () => {
    const schema = {
      ...schemaFixture(),
      commandItems: [
        {
          workspaceId: 'ws1',
          id: 'fixture.new_person',
          label: 'New person',
          icon: 'user',
          group: 'Create',
          action: { kind: 'create_record' as const, objectId: 'fixture.person' },
          moduleId: 'fixture',
        },
      ],
    };
    const config = resolvedFixture({
      blocks: [
        block('grid', {}, () => <div>Grid card</div>),
        block('ask', { placement: 'below' }, () => <div>Composer</div>),
      ],
    });
    const { container } = render(
      <TestProviders client={createFakeClient(schema, recordsFixture())} schema={schema} config={config}>
        <HomePage />
      </TestProviders>,
    );
    const below = container.querySelector('[data-slot="home-below"]');
    expect(below?.textContent).toContain('New person');
    expect(below?.textContent).toContain('Composer');
    expect(below?.textContent).not.toContain('Grid card');
    // A quick action runs the command item: this one opens the "New person" dialog.
    fireEvent.click(screen.getByRole('button', { name: 'New person' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('lets each person choose and arrange their blocks while customizing', async () => {
    const config = resolvedFixture({
      blocks: [block('a', { order: 10 }, () => <div>Card A</div>), block('b', { order: 20 }, () => <div>Card B</div>)],
    });
    render(
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} config={config}>
        <HomePage />
      </TestProviders>,
    );
    expect(await screen.findByText('Card A')).toBeTruthy();
    // The grips only show while customizing.
    expect(screen.queryByRole('button', { name: 'Remove A' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove A' }));
    await waitFor(() => expect(screen.queryByText('Card A')).toBeNull());
    // Remembered for this person in this workspace.
    expect(useHomeLayoutStore.getState().saved['ws1:u1']?.hidden).toEqual(['test.a']);
    // Added back from the Blocks menu, where every block is listed and the shown ones are checked.
    fireEvent.click(screen.getByRole('button', { name: /Blocks/ }));
    const a = await screen.findByRole('menuitemcheckbox', { name: 'A' });
    expect(a.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'B' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(a);
    expect(await screen.findByText('Card A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove B' }));
    await waitFor(() => expect(screen.queryByText('Card B')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(await screen.findByText('Card B')).toBeTruthy();
    expect(useHomeLayoutStore.getState().saved['ws1:u1']).toBeUndefined();
  });
});

describe('default Home blocks', () => {
  const renderHome = (schema = schemaFixture(), records = recordsFixture(), workflows: Workflow[] = []) => {
    const client = createFakeClient(schema, records);
    client.workflows.list = async () => workflows;

    return render(
      <TestProviders client={client} schema={schema}>
        <HomePage />
      </TestProviders>,
    );
  };

  it('counts the records per object and lists the latest changes', async () => {
    const { container } = renderHome();
    const counts = container.querySelector('[data-block="core.record_counts"]') as HTMLElement;
    await waitFor(() => expect(counts.textContent).toContain('You have 4 records across 2 objects.'));
    expect([...counts.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['People3', 'Companies1']);
    const recent = container.querySelector('[data-block="core.recent_records"]') as HTMLElement;
    await waitFor(() => expect(recent.querySelectorAll('li')).toHaveLength(4));
    expect(recent.textContent).toContain('Acme');
  });

  it('ticks off the first steps from the workspace itself', async () => {
    const installed = {
      moduleId: 'crm',
      name: 'CRM',
      version: '0.1.0',
      core: false,
    } as WorkspaceSchema['modules'][number];
    // Everything done: a module is installed, records exist, a workflow automates something, the objects are the workspace's own.
    const { container, unmount } = renderHome({ ...schemaFixture(), modules: [installed] }, recordsFixture(), [
      { id: 'w1' } as Workflow,
    ]);
    const card = () => container.querySelector('[data-block="core.getting_started"]') as HTMLElement;
    await waitFor(() => expect(card().textContent).toContain("You're all set."));
    unmount();

    // A fresh workspace on a module's objects: nothing done yet.
    const fixture = schemaFixture();
    const moduleOwned = { ...fixture, objects: fixture.objects.map((o) => ({ ...o, moduleId: 'fixture' })) };
    const fresh = renderHome(
      { ...moduleOwned, fields: moduleOwned.fields.map((f) => ({ ...f, moduleId: 'fixture' })) },
      {},
    );
    const steps = () => fresh.container.querySelector('[data-block="core.getting_started"]') as HTMLElement;
    await waitFor(() => expect(steps().textContent).toContain('0 of 4 done'));
    expect(steps().textContent).toContain('Add a module');
    expect(steps().textContent).toContain('Add your first record');
    expect(steps().textContent).toContain('Automate a routine');
    expect(steps().textContent).toContain('Make the data model yours');
  });

  it('sends each step somewhere of its own, and leaves out the record step until there is an object', async () => {
    const hrefs = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-block="core.getting_started"] a')].map((link) => ({
        text: link.textContent ?? '',
        href: link.getAttribute('href') ?? '',
      }));
    const withObjects = renderHome(schemaFixture(), {});
    await waitFor(() => expect(hrefs(withObjects.container)).toHaveLength(4));
    const all = hrefs(withObjects.container);
    expect(new Set(all.map((link) => link.href)).size).toBe(4);
    expect(all.find((link) => link.text.includes('Add a module'))?.href).toMatch(/\/settings\/modules$/);
    expect(all.find((link) => link.text.includes('Add your first record'))?.href).toMatch(/\/records\/\w+$/);
    expect(all.find((link) => link.text.includes('data model'))?.href).toMatch(/\/settings\/data-model$/);
    withObjects.unmount();

    const fixture = schemaFixture();
    const bare = renderHome({ ...fixture, objects: [], fields: [], views: [], layouts: [], navItems: [] }, {});
    await waitFor(() => expect(hrefs(bare.container)).toHaveLength(3));
    expect(hrefs(bare.container).some((link) => link.text.includes('Add your first record'))).toBe(false);
  });
});
