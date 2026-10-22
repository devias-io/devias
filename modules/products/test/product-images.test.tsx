import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { productDescriptionBlock } from '../src/studio/blocks/product-description';
import { productImagesBlock } from '../src/studio/blocks/product-images';

afterEach(cleanup);

const setup = async (images: string[] = []) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'product');

  if (!object) {
    throw new Error('Products is installed');
  }

  const product = await client.records.create('product', { name: 'Cable', images: images.length ? images : undefined });
  const show = () =>
    render(
      <TestProviders
        client={client}
        schema={schema}
        config={resolvedFixture({ blocks: [productImagesBlock, productDescriptionBlock] })}
      >
        <RecordPage object={object} recordId={product.id} />
      </TestProviders>,
    );
  const saved = async () => client.records.get('product', product.id);

  return { show, saved };
};

describe('the images block', () => {
  it('adds a picture from a link pasted into the add tile, and the first one is the cover', async () => {
    const { show, saved } = await setup();
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an image' }));
    const box = await screen.findByLabelText('Link to a picture');
    fireEvent.change(box, { target: { value: 'https://example.com/a.png' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(async () => expect((await saved()).images).toEqual(['https://example.com/a.png']));
    fireEvent.click(await screen.findByRole('button', { name: 'Add an image' }));
    fireEvent.change(await screen.findByLabelText('Link to a picture'), {
      target: { value: 'https://example.com/b.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
    await waitFor(async () =>
      expect((await saved()).images).toEqual(['https://example.com/a.png', 'https://example.com/b.png']),
    );
    expect(document.querySelector('[data-cover]')?.getAttribute('data-image')).toBe('https://example.com/a.png');
  });

  it('opens a picture larger, where it can be made the cover or removed', async () => {
    const { show, saved } = await setup(['https://example.com/a.png', 'https://example.com/b.png']);
    show();
    const second = await screen.findByText(
      (_, node) => node?.getAttribute('data-image') === 'https://example.com/b.png',
    );
    fireEvent.click(within(second).getByRole('button', { name: 'View image' }));
    fireEvent.click(await screen.findByRole('button', { name: /Make cover/ }));
    await waitFor(async () =>
      expect((await saved()).images).toEqual(['https://example.com/b.png', 'https://example.com/a.png']),
    );
    const cover = await screen.findByText((_, node) => node?.getAttribute('data-cover') === '');
    fireEvent.click(within(cover).getByRole('button', { name: 'View cover image' }));
    expect(screen.queryByRole('button', { name: /Make cover/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Remove/ }));
    await waitFor(async () => expect((await saved()).images).toEqual(['https://example.com/a.png']));
  });
});

describe('the description block', () => {
  it('shows the description as plain text and saves a change in place', async () => {
    const { show, saved } = await setup();
    show();
    const block = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'product-description');
    fireEvent.click(within(block).getByRole('button'));
    const editor = await within(block).findByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Three-core cable, sold by the meter.' } });
    fireEvent.blur(editor);
    await waitFor(async () => expect((await saved()).description).toBe('Three-core cable, sold by the meter.'));
  });
});
