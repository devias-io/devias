import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { studioManifest } from '../src';
import { EntityLink } from '../src/components/entity-link';
import { RichMarkdown } from '../src/components/markdown';
import { AssetsPage } from '../src/pages/assets/assets-page';
import { createStaticNavigation } from '../src/router/navigation';
import { installLayoutStubs, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);

afterEach(cleanup);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const setup = () => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const page = () =>
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/assets')}>
        <AssetsPage />
      </TestProviders>,
    );

  return { client, page };
};

const cards = () => [...document.querySelectorAll('[data-slot="asset-card"]')] as HTMLElement[];
const rows = () => [...document.querySelectorAll('[data-slot="asset-row"]')] as HTMLElement[];
const nameOf = (element: HTMLElement) => element.querySelector('[title]')?.getAttribute('title');
const fileInput = () => screen.getByLabelText('Choose files to upload') as HTMLInputElement;

describe('the assets row of the sidebar', () => {
  it('is pinned between Documents and Workflows and opens the Assets page', () => {
    const pinned = studioManifest.navItems?.filter((item) => item.pinned) ?? [];
    const labels = pinned.map((item) => item.label);

    expect(labels).toContain('Assets');
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('Documents') + 1);
    expect(labels.indexOf('Workflows')).toBe(labels.indexOf('Assets') + 1);
    const nav = pinned.find((item) => item.label === 'Assets');
    const pageId = (nav?.target as { pageId?: string } | undefined)?.pageId;
    expect(studioManifest.pages?.find((page) => page.id === pageId)).toMatchObject({ label: 'Assets' });
  });
});

describe('the assets page', () => {
  it('shows an empty state with a way to upload the first asset', async () => {
    const { page } = setup();
    page();

    expect(await screen.findByText('No assets yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Upload/ }).length).toBeGreaterThan(0);
  });

  it('lists assets newest first as tiles, says what the workspace stores, and narrows by search and by type', async () => {
    const { client, page } = setup();
    await client.assets.upload({ name: 'Q3 report.txt', description: 'Revenue numbers', body: 'figures' });
    await client.assets.upload({ name: 'Team photo.png', body: PNG });
    await client.assets.upload({ name: 'invoice.pdf', body: '%PDF-1.4 x' });
    page();

    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(cards().map(nameOf)).toEqual(['invoice.pdf', 'Team photo.png', 'Q3 report.txt']);
    expect(await screen.findByText(/3 assets · /)).toBeTruthy();
    // A picture is drawn as a picture, the rest as the kind of file.
    expect(within(cards()[1] as HTMLElement).getByRole('presentation', { hidden: true })).toBeTruthy();
    expect(within(cards()[0] as HTMLElement).getByText('PDF')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    await waitFor(() => expect(cards().map(nameOf)).toEqual(['Team photo.png']));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search assets' }), { target: { value: 'revenue' } });
    await waitFor(() => expect(cards().map(nameOf)).toEqual(['Q3 report.txt']));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search assets' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('No assets match')).toBeTruthy();
  });

  it('can be a list of rows instead of tiles', async () => {
    const { client, page } = setup();
    await client.assets.upload({ name: 'notes.txt', body: 'hello' });
    page();
    await waitFor(() => expect(cards()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(cards()).toHaveLength(0);
    expect(within(rows()[0] as HTMLElement).getByText('Text')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('uploads what is chosen, with a row of progress that goes away, and the asset appears', async () => {
    const { client, page } = setup();
    page();
    await screen.findByText('No assets yet');

    fireEvent.change(fileInput(), { target: { files: [new File([PNG], 'logo.png', { type: 'image/png' })] } });

    await waitFor(async () => expect((await client.assets.list()).total).toBe(1));
    expect(await screen.findByRole('list', { name: 'Uploads' })).toBeTruthy();
    await waitFor(() => expect(cards().map(nameOf)).toEqual(['logo.png']));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Uploads' })).toBeNull(), { timeout: 4000 });
  });

  it('uploads files dropped on the page', async () => {
    const { client, page } = setup();
    const { container } = page();
    await screen.findByText('No assets yet');
    const target = container.querySelector('[data-slot="assets-page"]') as HTMLElement;
    const file = new File(['dropped text'], 'dropped.txt', { type: 'text/plain' });
    const transfer = { types: ['Files'], files: [file] };

    fireEvent.dragEnter(target, { dataTransfer: transfer });
    expect(await screen.findByText('Drop to upload')).toBeTruthy();
    fireEvent.drop(target, { dataTransfer: transfer });

    await waitFor(async () =>
      expect((await client.assets.list()).items.map((item) => item.name)).toEqual(['dropped.txt']),
    );
    expect(screen.queryByText('Drop to upload')).toBeNull();
  });

  it('says why a file was refused, and lets it be tried again or put away', async () => {
    const { client, page } = setup();
    page();
    await screen.findByText('No assets yet');
    const big = new File([new Uint8Array(26 * 1024 * 1024)], 'huge.bin');

    fireEvent.change(fileInput(), { target: { files: [big] } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/at most 25 MB/);
    expect((await client.assets.list()).total).toBe(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('opens an asset to look at it, rename it and describe it', async () => {
    const { client, page } = setup();
    const asset = await client.assets.upload({ name: 'draft.txt', body: 'the whole text of the file' });
    page();
    await waitFor(() => expect(cards()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Open draft.txt' }));

    const sheet = await waitFor(() => {
      const found = document.querySelector('[data-slot="asset-sheet"]') as HTMLElement | null;
      expect(found).toBeTruthy();

      return found as HTMLElement;
    });
    expect(await within(sheet).findByText('the whole text of the file')).toBeTruthy();
    expect(within(sheet).getByText(/text\/plain/)).toBeTruthy();

    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'final.txt' } });
    fireEvent.blur(name);
    await waitFor(async () => expect((await client.assets.get(asset.id)).name).toBe('final.txt'));

    const description = within(sheet).getByRole('textbox', { name: 'Description' });
    fireEvent.change(description, { target: { value: 'The final one' } });
    fireEvent.blur(description);
    await waitFor(async () => expect((await client.assets.get(asset.id)).description).toBe('The final one'));
    await waitFor(() => expect(cards().map(nameOf)).toEqual(['final.txt']));

    // An empty name is not a name: the old one comes back.
    const again = within(sheet).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.blur(again);
    await waitFor(() =>
      expect((within(sheet).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('final.txt'),
    );
  });

  it('deletes an asset after asking, from the menu of its tile', async () => {
    const { client, page } = setup();
    await client.assets.upload({ name: 'keep.txt', body: 'keep' });
    await client.assets.upload({ name: 'doomed.txt', body: 'doomed' });
    page();
    await waitFor(() => expect(cards()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for doomed.txt' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    expect(await screen.findByText('Delete this asset?')).toBeTruthy();
    expect((await client.assets.list()).total).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () =>
      expect((await client.assets.list()).items.map((item) => item.name)).toEqual(['keep.txt']),
    );
    await waitFor(() => expect(cards().map(nameOf)).toEqual(['keep.txt']));
  });

  it('says where an asset is used, with links, and opens from a link to it', async () => {
    const { client, page } = setup();
    const asset = await client.assets.upload({ name: 'logo.png', body: PNG });
    await client.assets.upload({ name: 'other.txt', body: 'other' });
    const doc = await client.documents.create({ title: 'Brand', markdown: `Our [logo](asset:${asset.id}) is here.` });
    const task = await client.tasks.create({ title: 'Update the logo', about: [`asset:${asset.id}`] });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/assets', { asset: asset.id })}
      >
        <AssetsPage />
      </TestProviders>,
    );

    // The link opened it.
    const sheet = await waitFor(() => {
      const found = document.querySelector('[data-slot="asset-sheet"]') as HTMLElement | null;
      expect(found).toBeTruthy();

      return found as HTMLElement;
    });
    const used = await waitFor(() => {
      const found = sheet.querySelector('[data-slot="asset-usage"]') as HTMLElement;
      expect(within(found).getByText('Brand')).toBeTruthy();

      return found;
    });
    expect(within(used).getByText('Update the logo')).toBeTruthy();
    expect(within(used).getByText('is about it')).toBeTruthy();
    expect(within(used).getByRole('link', { name: /Brand/ }).getAttribute('href')).toBe(
      `/workspaces/acme/documents/${doc.id}`,
    );
    expect(
      within(used)
        .getByRole('link', { name: /Update the logo/ })
        .getAttribute('href'),
    ).toBe(`/workspaces/acme/tasks/${task.id}`);
    void page;
  });

  it('says nothing links to an asset that is not used', async () => {
    const { client, page } = setup();
    await client.assets.upload({ name: 'alone.txt', body: 'alone' });
    page();
    await waitFor(() => expect(cards()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Open alone.txt' }));

    expect(await screen.findByText('Nothing links to this asset yet.')).toBeTruthy();
  });

  it('asks again before deleting an asset that is in use, and then deletes it', async () => {
    const { client, page } = setup();
    const asset = await client.assets.upload({ name: 'used.png', body: PNG });
    await client.documents.create({ title: 'Brand', markdown: `Our [logo](asset:${asset.id}).` });
    await client.tasks.create({ title: 'Update it', about: [`asset:${asset.id}`] });
    page();
    await waitFor(() => expect(cards()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for used.png' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Refused: it says where, and the asset is still there.
    expect(await screen.findByText(/is used in 2 places/)).toBeTruthy();
    expect((await client.assets.list()).total).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect((await client.assets.list()).total).toBe(0));
    await waitFor(() => expect(cards()).toHaveLength(0));
  });
});

describe('links to assets in text', () => {
  const draw = async (client: ReturnType<typeof setup>['client'], node: React.ReactNode) =>
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/home')}>
        {node}
      </TestProviders>,
    );

  it('shows an asset by its name, links to it, and says so when the file was removed', async () => {
    const { client } = setup();
    const asset = await client.assets.upload({ name: 'Brand logo.png', body: PNG });
    await draw(client, <EntityLink link={`asset:${asset.id}`} />);

    const link = await screen.findByRole('link', { name: /Brand logo\.png/ });
    expect(link.getAttribute('href')).toBe(`/workspaces/acme/assets?asset=${asset.id}`);
    cleanup();

    await client.assets.delete(asset.id);
    await draw(client, <EntityLink link={`asset:${asset.id}`} />);
    expect(await screen.findByText('File removed')).toBeTruthy();
  });

  it('opens an asset from a link in Markdown, as the agent writes them', async () => {
    const { client } = setup();
    const asset = await client.assets.upload({ name: 'logo.png', body: PNG });
    await draw(client, <RichMarkdown text={`See [the logo](asset:${asset.id}).`} />);

    expect((await screen.findByRole('link', { name: 'the logo' })).getAttribute('href')).toBe(
      `/workspaces/acme/assets?asset=${asset.id}`,
    );
  });
});
