import type { RecordData } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { manifest as products } from '@devias/mod-products/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { lowStockBlock } from '../src/studio/blocks/low-stock';
import { productStockBlock } from '../src/studio/blocks/product-stock';

afterEach(cleanup);

/** A workspace with the CRM, Products and inventory, two locations, two tracked products and a few moves. */
const setup = async () => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, products, manifest] });
  const schema = await client.metadata.getSchema();
  const warehouse = await client.records.create('location', { name: 'Warehouse' });
  const van = await client.records.create('location', { name: 'Van 1', kind: 'van' });
  const cable = await client.records.create('product', {
    name: 'Cable 3x2.5',
    unit: 'meter',
    tracked: true,
    reorder_point: 100,
  });
  const sockets = await client.records.create('product', { name: 'Socket', tracked: true, reorder_point: 5 });
  const move = (product: RecordData, location: RecordData, direction: 'in' | 'out', quantity: number) =>
    client.records.create('stock_move', {
      product: product.id,
      location: location.id,
      direction,
      quantity,
      moved_on: '2026-10-01',
    });
  await move(cable, warehouse, 'in', 200);
  await move(cable, warehouse, 'out', 60);
  await move(cable, van, 'in', 60);
  await move(cable, van, 'out', 125.5);
  await move(sockets, warehouse, 'in', 40);

  return { client, schema, cable };
};

describe('inventory blocks', () => {
  it("places itself on a product's page after its prices, and shows its stock by location, and says it is low", async () => {
    const { client, schema, cable } = await setup();
    const product = schema.objects.find((object) => object.nameSingular === 'product');

    if (!product) {
      throw new Error('Products is installed');
    }

    const { container } = render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [productStockBlock] })}>
        <RecordPage object={product} recordId={cable.id} />
      </TestProviders>,
    );
    const block = within(await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'product-stock'));
    const main = document.querySelector('[data-slot="split-main"]');
    expect([...(main?.querySelectorAll('[data-cell]') ?? [])].map((cell) => cell.getAttribute('data-block'))).toEqual([
      'core.title',
      'products.product_description',
      'products.product_prices',
      'inventory.product_stock',
      'products.product_images',
      'core.comments',
      'core.activity',
    ]);
    expect(block.getByText(/74[.,]5 m/)).toBeTruthy();
    expect(block.getByText('Warehouse').nextSibling?.textContent).toBe('140 m');
    expect(block.getByText('Van 1').nextSibling?.textContent).toMatch(/-65[.,]5 m/);
    expect(container.querySelector('[data-slot="low-stock"]')).toBeTruthy();
  });

  it('says the stock of a product that is not tracked is not counted, and starts counting on a click', async () => {
    const { client, schema } = await setup();
    const product = schema.objects.find((object) => object.nameSingular === 'product');

    if (!product) {
      throw new Error('Products is installed');
    }

    const consulting = await client.records.create('product', { name: 'Consulting', kind: 'service' });
    render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [productStockBlock] })}>
        <RecordPage object={product} recordId={consulting.id} />
      </TestProviders>,
    );
    expect(await screen.findByText('Its stock is not counted.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Track stock' }));
    await waitFor(async () =>
      expect(await client.records.get('product', consulting.id)).toMatchObject({ tracked: true }),
    );
  });

  it('lists on Home the products at or below their reorder point', async () => {
    const { client, schema } = await setup();
    const LowStock = lowStockBlock.component;
    render(
      <TestProviders client={client} schema={schema}>
        <LowStock config={{}} surface="home" />
      </TestProviders>,
    );
    const list = within(await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'low-stock-list'));
    expect(list.getByText('Cable 3x2.5')).toBeTruthy();
    expect(list.queryByText('Socket')).toBeNull();
    expect(screen.getByText(/1 product is/)).toBeTruthy();
  });
});
