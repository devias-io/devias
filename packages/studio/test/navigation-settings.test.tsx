import { definePageComponent, type NavItem } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { navigationSection } from '../src/pages/settings/sections';
import {
  createFakeClient,
  installLayoutStubs,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

/** A tool a module would bring, nobody has placed. (Home and Workflows are pinned and Settings has its own spot.) */
const forecastPage = definePageComponent({
  id: '01a1751f-5f09-7114-9d75-b0d3ae08a7cd',
  path: 'forecast',
  label: 'Forecast',
  icon: 'trending-up',
  component: () => null,
});

const stamp = { workspaceId: '2a4c7c80-5d8e-4dac-bde2-9552c91da6e1', createdAt: '', updatedAt: '' };
const nav = (item: Partial<NavItem> & Pick<NavItem, 'id' | 'label' | 'target'>): NavItem => ({
  ...stamp,
  position: 0,
  parentId: null,
  pinned: false,
  overrides: null,
  moduleId: null,
  ...item,
});

const setup = (extra: NavItem[] = []) => {
  const base = schemaFixture();
  const schema = {
    ...base,
    navItems: [
      nav({
        id: '01a1751f-5f09-7114-9d75-b7755caf4904',
        label: 'Contacts',
        icon: 'users',
        target: { kind: 'group' },
        moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
      }),
      nav({
        id: '01a1751f-5f09-7114-9d75-bae48e0719e6',
        label: 'People',
        target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
        parentId: '01a1751f-5f09-7114-9d75-b7755caf4904',
        moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
        overrides: { label: 'Everyone' },
      }),
      nav({
        id: '01a1751f-5f09-7114-9d75-c382766ba2a2',
        label: 'Companies',
        target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' },
        parentId: '01a1751f-5f09-7114-9d75-b7755caf4904',
        position: 1,
        moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
        overrides: { hidden: true },
      }),
      nav({
        id: '01a1751f-5f09-7114-9d75-c884fcc3298e',
        label: 'Sales',
        target: { kind: 'group' },
        position: 1,
        moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
      }),
      ...extra,
    ],
  };
  const client = createFakeClient(schema, recordsFixture());
  const update = vi.spyOn(client.metadata.navItems, 'update').mockResolvedValue({} as never);
  const arrange = vi.spyOn(client.metadata.navItems, 'arrange').mockResolvedValue([]);
  const reset = vi.spyOn(client.metadata.navItems, 'reset').mockResolvedValue({} as never);
  const create = vi.spyOn(client.metadata.navItems, 'create').mockResolvedValue({} as never);
  const remove = vi.spyOn(client.metadata.navItems, 'delete').mockResolvedValue();
  const resetAll = vi.spyOn(client.metadata.navItems, 'resetAll').mockResolvedValue([]);
  const Section = navigationSection.component;
  render(
    <TestProviders client={client} schema={schema} config={resolvedFixture({ pages: [forecastPage] })}>
      <Section />
    </TestProviders>,
  );

  return { update, arrange, reset, create, remove, resetAll };
};

describe('Settings → Navigation', () => {
  it('shows the sidebar as a tree with the workspace’s own names, hidden items dimmed', async () => {
    setup();
    // The module calls it People; the workspace calls it Everyone.
    expect(await screen.findByText('Everyone')).toBeTruthy();
    expect(screen.queryByText('People')).toBeNull();
    const companies = document.querySelector('[data-nav-item="01a1751f-5f09-7114-9d75-c382766ba2a2"]') as HTMLElement;
    expect(companies.textContent).toContain('hidden');
    expect(screen.getByRole('button', { name: 'Show Companies' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Everyone' })).toBeTruthy();
  });

  it('renames, hides and shows an item as the workspace’s choice', async () => {
    const { update } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Sales' }));
    const input = screen.getByLabelText('Name of Sales');
    fireEvent.change(input, { target: { value: 'Revenue' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('01a1751f-5f09-7114-9d75-c884fcc3298e', { label: 'Revenue' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide Everyone' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('01a1751f-5f09-7114-9d75-bae48e0719e6', { hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Companies' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('01a1751f-5f09-7114-9d75-c382766ba2a2', { hidden: false }));
  });

  it('moves an item into another section, putting it last, and resets what was edited', async () => {
    const { arrange, reset } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Move Everyone to…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sales' }));
    await waitFor(() =>
      expect(arrange).toHaveBeenCalledWith([
        { id: '01a1751f-5f09-7114-9d75-bae48e0719e6', parentId: '01a1751f-5f09-7114-9d75-c884fcc3298e', position: 0 },
      ]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Everyone to…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Reset to the module/ }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('01a1751f-5f09-7114-9d75-bae48e0719e6'));
  });

  it("removes an item the workspace made, and offers no removal for a module's", async () => {
    const { remove } = setup([
      nav({
        id: '3de4d1f6-6b7d-4450-a639-a1d11ff63e86',
        label: 'Outlook',
        target: { kind: 'page', pageId: '01a1751f-5f09-7114-9d75-b0d3ae08a7cd' },
      }),
    ]);
    expect(await screen.findByText('Outlook')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move Outlook to…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Remove from the sidebar/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('3de4d1f6-6b7d-4450-a639-a1d11ff63e86'));
    cleanup();
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Move Everyone to…' }));
    expect(screen.queryByRole('menuitem', { name: /Remove from the sidebar/ })).toBeNull();
  });

  it('does not arrange pinned items: they are not rows of the tree', async () => {
    setup([
      nav({
        id: '17a7d64e-6598-44e6-a0ea-6f74ec783a5b',
        label: 'Start here',
        target: { kind: 'page', pageId: '01a1751f-5f09-7114-9d75-b0d3ae08a7cd' },
        pinned: true,
        moduleId: '697e7c95-b982-4b2f-bd61-34aac291c133',
      }),
    ]);
    expect(await screen.findByText('Contacts')).toBeTruthy();
    expect(screen.queryByText('Start here')).toBeNull();
  });

  it('resets the whole navigation after asking', async () => {
    const { resetAll } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Reset navigation/ }));
    await screen.findByText('Reset the navigation?');
    expect(resetAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(resetAll).toHaveBeenCalledTimes(1));
  });
});
