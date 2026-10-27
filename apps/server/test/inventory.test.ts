import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as inventoryIds } from '@devias/mod-inventory/manifest';
import inventory from '@devias/mod-inventory/server';
import { ids as productIds, manifest as productsManifest } from '@devias/mod-products/manifest';
import { defineModuleServer } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, signUp } from './helpers';

/** Inventory on top of the CRM: moves in and out, stock on hand added up from them, transfers and counts. */
describe('inventory', () => {
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
      {
        modules: [crm, defineModuleServer(productsManifest), inventory],
        builtin: [crmManifest],
        pgliteDataDir: 'memory://',
      },
    );
    api = client(server, { cookie: (await signUp(server, 'owner@stock.test')).cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme Electric', 'acme-stock')).id}`;
    const catalog = (await api(`${base}/modules/catalog`)).json as { id: string }[];

    // Inventory adds stock fields to the product, so Products goes first.
    for (const id of [productIds.module, inventoryIds.module]) {
      const manifest = catalog.find((entry) => entry.id === id);
      expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
    }
  });
  afterAll(() => server.close());

  const create = async (object: string, values: Record<string, unknown>) => {
    const created = await api(`${base}/records/${object}`, { body: values });
    expect(created.status).toBe(201);

    return created.json as { id: string } & Record<string, unknown>;
  };
  const run = (action: string, input: Record<string, unknown>) =>
    api(`${base}/modules/${inventoryIds.module}/actions/${action}`, { body: input });

  it('lists the locations and moves under Inventory in the sidebar, and the products as a row of their own', async () => {
    const { navItems } = (await api(`${base}/metadata`)).json as {
      navItems: { id: string; label: string; parentId: string | null; position: number }[];
    };
    const under = (label: string) => {
      const section = navItems.find((item) => item.label === label && item.parentId === null);

      return navItems
        .filter((item) => item.parentId === section?.id)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.label);
    };
    expect(under('Inventory')).toEqual(['Locations', 'Stock moves']);
    expect(navItems.some((item) => item.label === 'Products' && item.parentId === null)).toBe(true);
    expect(under('Sales')).toEqual(['Deals', 'Forecast']);
  });

  it('adds stock up from the moves, moves it between locations, and corrects it after a count', async () => {
    const warehouse = await create('location', { name: 'Warehouse' });
    const van = await create('location', { name: 'Van 1', kind: 'van' });
    // The product of the Products module, which this module gives a stock to track and a reorder point.
    const cable = await create('product', { name: 'Cable 3x2.5', unit: 'meter', tracked: true, reorder_point: 100 });
    expect(cable).toMatchObject({ unit: 'meter', reorder_point: 100 });
    const job = await create('deal', { name: 'Rewire the Ionescu flat' });

    // Moves are records: a purchase in, and what a job used, out.
    await create('stock_move', {
      product: cable.id,
      location: warehouse.id,
      direction: 'in',
      quantity: 200,
      reason: 'purchase',
      moved_on: '2026-10-01',
      reference: 'Delivery note 4411',
    });
    const transferred = await run('transfer_stock', {
      product: cable.id,
      from: warehouse.id,
      to: van.id,
      quantity: 60,
    });
    expect(transferred.status).toBe(200);
    await create('stock_move', {
      product: cable.id,
      location: van.id,
      direction: 'out',
      quantity: 42.5,
      reason: 'use',
      deal: job.id,
      moved_on: '2026-10-03',
    });

    const stock = async (input: Record<string, unknown> = {}) =>
      ((await run('stock_on_hand', input)).json as { products: Record<string, unknown>[] }).products;
    expect(await stock()).toEqual([
      {
        id: cable.id,
        name: 'Cable 3x2.5',
        unit: 'meter',
        on_hand: 157.5,
        reorder_point: 100,
        low: false,
        locations: [
          { id: van.id, name: 'Van 1', on_hand: 17.5 },
          { id: warehouse.id, name: 'Warehouse', on_hand: 140 },
        ],
      },
    ]);
    expect((await stock({ location: van.id }))[0]).toMatchObject({ on_hand: 17.5, locations: [{ name: 'Van 1' }] });

    // A count finds 80 in the warehouse: the 60 missing are recorded as a count move out.
    const counted = await run('count_stock', { product: cable.id, location: warehouse.id, counted: 80 });
    expect(counted.json).toMatchObject({ before: 140, counted: 80, difference: -60 });
    expect((await stock())[0]).toMatchObject({ on_hand: 97.5, low: true });
    expect((await run('count_stock', { product: cable.id, location: warehouse.id, counted: 80 })).json).toMatchObject({
      difference: 0,
      move_id: null,
    });

    // Moving stock to where it already is says why it cannot.
    const same = await run('transfer_stock', { product: cable.id, from: van.id, to: van.id, quantity: 1 });
    expect(JSON.stringify(same.json)).toContain('Pick two different locations');

    // What the job used, from the ledger.
    const used = (
      await api(`${base}/records/stock_move/list`, {
        body: { filter: { field: 'deal', op: 'eq', value: job.id } },
      })
    ).json as { items: Record<string, unknown>[] };
    expect(used.items).toEqual([expect.objectContaining({ direction: 'out', quantity: 42.5, reason: 'use' })]);
  });
});
