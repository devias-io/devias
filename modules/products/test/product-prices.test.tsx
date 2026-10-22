import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { productPricesBlock } from '../src/studio/blocks/product-prices';

afterEach(cleanup);

/** A product's page, as the studio draws it from the module's layout and block. */
const setup = async () => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'product');

  if (!object) {
    throw new Error('Products is installed');
  }

  const product = await client.records.create('product', { name: 'Support plan', kind: 'service' });
  const price = (values: Record<string, unknown>) => client.records.create('price', { product: product.id, ...values });
  const show = () =>
    render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [productPricesBlock] })}>
        <RecordPage object={object} recordId={product.id} />
      </TestProviders>,
    );
  const prices = async () =>
    (
      await client.records.list({
        object: 'price',
        filter: { field: 'product', op: 'eq', value: product.id },
        sort: [{ field: 'created_at', direction: 'asc' }],
      })
    ).items;

  return { client, product, price, show, prices };
};

describe('the product page', () => {
  it('is one flow: its name, description, prices, pictures and conversation, with what it is beside', async () => {
    const { show } = await setup();
    show();
    await screen.findByText('Prices');
    expect(document.querySelector('[data-slot="split-shell"]')).toBeTruthy();
    const main = document.querySelector('[data-slot="split-main"]');
    expect([...(main?.querySelectorAll('[data-cell]') ?? [])].map((cell) => cell.getAttribute('data-cell'))).toEqual([
      'title',
      'product_description',
      'product_prices',
      'product_images',
      'notes',
      'activity',
    ]);
    expect(screen.getByRole('complementary', { name: 'Product' })).toBeTruthy();
  });
});

describe('the prices block', () => {
  it('adds a price from the row at the end, and the first one becomes the default', async () => {
    const { show, client, product, prices } = await setup();
    show();
    const name = await screen.findByLabelText('New price name');
    fireEvent.change(name, { target: { value: 'Monthly' } });
    fireEvent.change(screen.getByLabelText('New price billing'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('New price amount'), { target: { value: '49' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(async () => expect(await prices()).toHaveLength(1));
    const [added] = await prices();
    expect(added).toMatchObject({ nickname: 'Monthly', amount: 49, type: 'recurring', interval: 'month' });
    await waitFor(async () =>
      expect(await client.records.get('product', product.id)).toMatchObject({ default_price: added?.id }),
    );
    // The row is ready for the next one.
    expect((screen.getByLabelText('New price name') as HTMLInputElement).value).toBe('');
  });

  it('changes how a price is billed from its row, and moves the default with the star', async () => {
    const { show, client, product, price, prices } = await setup();
    const monthly = await price({ nickname: 'Monthly', amount: 49, type: 'recurring', interval: 'month' });
    const yearly = await price({ nickname: 'Yearly', amount: 490, type: 'recurring', interval: 'year' });
    await client.records.update('product', product.id, { default_price: monthly.id });
    show();
    const row = await screen.findByText((_, node) => node?.getAttribute('data-price') === yearly.id);
    fireEvent.change(within(row).getByLabelText('Billing'), { target: { value: 'quarter' } });
    await waitFor(async () =>
      expect((await prices()).find((candidate) => candidate.id === yearly.id)).toMatchObject({
        type: 'recurring',
        interval: 'month',
        interval_count: 3,
      }),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Make default' }));
    await waitFor(async () =>
      expect(await client.records.get('product', product.id)).toMatchObject({ default_price: yearly.id }),
    );
    await waitFor(() => expect(row.getAttribute('data-default')).toBe(''));
  });

  it('removes a price, and the product has no default when it was the default one', async () => {
    const { show, client, product, price, prices } = await setup();
    const monthly = await price({ nickname: 'Monthly', amount: 49 });
    await client.records.update('product', product.id, { default_price: monthly.id });
    show();
    const row = await screen.findByText((_, node) => node?.getAttribute('data-price') === monthly.id);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove price' }));
    await waitFor(async () => expect(await prices()).toHaveLength(0));
    expect((await client.records.get('product', product.id)).default_price ?? null).toBeNull();
  });
});
