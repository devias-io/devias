import { type Filter, mapFilterFields } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { manifest as expenses } from '@devias/mod-expenses/manifest';
import { defineModuleServer } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, signUp } from './helpers';

/** Expenses, a manifest only, installed on top of the CRM like any other module. */
describe('expenses', () => {
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
      { modules: [crm, defineModuleServer(expenses)], builtin: [crmManifest], pgliteDataDir: 'memory://' },
    );
    api = client(server, { cookie: (await signUp(server, 'owner@spend.test')).cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme Installers', 'acme-spend')).id}`;
  });
  afterAll(() => server.close());

  it('installs from the catalog and tracks spending by category, supplier and deal', async () => {
    const manifest = ((await api(`${base}/modules/catalog`)).json as { id: string }[]).find(
      (entry) => entry.id === 'expenses',
    );
    expect(manifest).toMatchObject({ policies: [{ id: 'expenses.large_expenses' }] });
    expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);

    const supplier = (await api(`${base}/records/company`, { body: { name: 'Dedeman' } })).json as { id: string };
    const deal = (await api(`${base}/records/deal`, { body: { name: 'Kitchen for the Popescus' } })).json as {
      id: string;
    };
    const log = async (values: Record<string, unknown>) => {
      const created = await api(`${base}/records/expense`, {
        body: { spent_on: '2026-10-09', supplier: supplier.id, deal: deal.id, ...values },
      });
      expect(created.status).toBe(201);

      return created.json as Record<string, unknown>;
    };
    // A new expense is a draft, paid by the company, in the default currency.
    expect(await log({ description: 'Tiles and grout', amount: 420, category: 'materials' })).toMatchObject({
      status: 'draft',
      paid_with: 'company',
      currency: 'EUR',
    });
    await log({ description: 'Fuel', amount: 80, category: 'vehicle', paid_with: 'personal', status: 'approved' });
    await log({ description: 'Tile cutter', amount: 650, category: 'tools', status: 'submitted' });

    // What the deal cost, by category: what the agent reaches with records.aggregate.
    const spent = (
      await api(`${base}/records/expense/aggregate`, {
        body: {
          filter: { field: 'deal', op: 'eq', value: deal.id },
          groupBy: 'category',
          measures: [{ fn: 'sum', field: 'amount' }],
        },
      })
    ).json as { groups: { key: string; values: Record<string, number> }[]; total: { values: Record<string, number> } };
    expect(spent.total.values['sum.amount']).toBe(1150);
    // Every category is a group, in option order; the ones with nothing spent add up to 0.
    const byCategory = spent.groups.filter((group) => group.values['sum.amount']);
    expect(Object.fromEntries(byCategory.map((group) => [group.key, group.values['sum.amount']]))).toEqual({
      materials: 420,
      tools: 650,
      vehicle: 80,
    });

    // The lists people act on, and the sidebar section.
    const schema = (await api(`${base}/metadata`)).json as {
      views: { label: string; config: { filter?: Filter } }[];
      fields: { id: string; name: string }[];
      navItems: { label: string }[];
    };
    /** What a view lists: its saved filter, as the studio applies it. */
    const listed = async (name: string) => {
      const view = schema.views.find((candidate) => candidate.label === name);
      // A saved view names its fields by id; a query names them by API name.
      const filter = view?.config.filter
        ? mapFilterFields(view.config.filter, (ref) => schema.fields.find((f) => f.id === ref)?.name ?? ref)
        : undefined;
      const rows = (await api(`${base}/records/expense/list`, { body: { filter } })).json as {
        items: { description: string }[];
      };

      return rows.items.map((item) => item.description);
    };
    expect(schema.navItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Expenses', 'All expenses', 'To approve', 'To reimburse']),
    );
    expect(schema.views.map((view) => view.label)).toEqual(
      expect.arrayContaining(['All expenses', 'By status', 'To approve', 'To reimburse']),
    );
    expect(await listed('To approve')).toEqual(['Tile cutter']);
    expect(await listed('To reimburse')).toEqual(['Fuel']);
  });
});
