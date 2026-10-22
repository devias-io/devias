import { manifest as productsManifest } from '@devias/mod-products/manifest';
import { defineModuleServer } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, signUp } from './helpers';

/** Products alone: products and their prices, with no other module installed. */
describe('products', () => {
  let server: Server;
  let api: Api;
  let base: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [defineModuleServer(productsManifest)], pgliteDataDir: 'memory://' },
    );
    api = client(server, { cookie: (await signUp(server, 'owner@products.test')).cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme Products', 'acme-products')).id}`;
    const manifest = ((await api(`${base}/modules/catalog`)).json as { id: string }[]).find(
      (entry) => entry.id === 'products',
    );
    expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
  });
  afterAll(() => server.close());

  const create = async (object: string, values: Record<string, unknown>) => {
    const created = await api(`${base}/records/${object}`, { body: values });
    expect(created.status).toBe(201);

    return created.json as { id: string } & Record<string, unknown>;
  };
  const prices = (product: string) =>
    api(`${base}/records/price/list`, { body: { filter: { field: 'product', op: 'eq', value: product } } }).then(
      (response) => (response.json as { items: Record<string, unknown>[] }).items,
    );

  it('has a Products row of its own in the sidebar', async () => {
    const { navItems } = (await api(`${base}/metadata`)).json as {
      navItems: { label: string; parentId: string | null }[];
    };
    expect(navItems.find((item) => item.label === 'Products')?.parentId).toBeNull();
  });

  it('gives a product several prices, one time or recurring, with a default among them', async () => {
    const product = await create('product', { name: 'Support plan', kind: 'service', unit: 'piece' });
    expect(product).toMatchObject({ active: true });
    const monthly = await create('price', {
      product: product.id,
      nickname: 'Monthly',
      amount: 49,
      type: 'recurring',
      interval: 'month',
      lookup_key: 'support-monthly',
    });
    const setup = await create('price', { product: product.id, nickname: 'Setup fee', amount: 200 });
    expect(setup).toMatchObject({ type: 'one_time', interval_count: 1, tax_behavior: 'exclusive', active: true });
    const updated = await api(`${base}/records/product/${product.id}`, {
      method: 'PATCH',
      body: { default_price: monthly.id },
    });
    expect(updated.json).toMatchObject({ default_price: monthly.id });
    expect((await prices(product.id)).map((price) => price.nickname).sort()).toEqual(['Monthly', 'Setup fee']);
  });

  it('refuses a second price with the same lookup key', async () => {
    const product = await create('product', { name: 'Key product' });
    await create('price', { product: product.id, amount: 1, lookup_key: 'same-key' });
    const again = await api(`${base}/records/price`, {
      body: { product: product.id, amount: 2, lookup_key: 'same-key' },
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it('deletes a product’s prices with it, even the one it uses as its default', async () => {
    const product = await create('product', { name: 'Short lived' });
    const price = await create('price', { product: product.id, amount: 10 });
    await api(`${base}/records/product/${product.id}`, { method: 'PATCH', body: { default_price: price.id } });
    expect((await api(`${base}/records/product/${product.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await prices(product.id)).toEqual([]);
  });
});
