import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as quotesIds } from '@devias/mod-quotes/manifest';
import quotes from '@devias/mod-quotes/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, type Session, signUp } from './helpers';

/** Quotes on top of the CRM: the document made from a deal's offer. */
describe('quotes', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let owner: Session;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [crm, quotes], builtin: [crmManifest], pgliteDataDir: 'memory://' },
    );
    owner = await signUp(server, 'owner@quotes.test');
    api = client(server, { cookie: owner.cookie });
    base = `/api/workspaces/${(await createWorkspace(api, 'Acme Quotes', 'acme-quotes')).id}`;
    const manifest = ((await api(`${base}/modules/catalog`)).json as { id: string }[]).find(
      (entry) => entry.id === quotesIds.module,
    );
    expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
  });
  afterAll(() => server.close());

  const create = async (object: string, values: Record<string, unknown>) => {
    const created = await api(`${base}/records/${object}`, { body: values });
    expect(created.status).toBe(201);

    return created.json as { id: string } & Record<string, unknown>;
  };
  const run = (action: string, input: Record<string, unknown>) =>
    api(`${base}/modules/${quotesIds.module}/actions/${action}`, { body: input });

  it('has a row of its own in the sidebar, and leaves the CRM’s Sales section as it is', async () => {
    const { navItems } = (await api(`${base}/metadata`)).json as {
      navItems: { id: string; label: string; parentId: string | null; position: number }[];
    };
    const sales = navItems.find((item) => item.label === 'Sales' && item.parentId === null);
    expect(
      navItems
        .filter((item) => item.parentId === sales?.id)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.label),
    ).toEqual(['Deals', 'Forecast']);
    expect(navItems.find((item) => item.label === 'Quotes')?.parentId).toBeNull();
  });

  it('adds a quote up from its items with the action, as the module acting for the person', async () => {
    const quote = await create('quote', { title: 'Annual plan', status: 'draft' });

    for (const item of [
      { description: 'Seats', quantity: 10, unit_price: 12.5 },
      { description: 'Onboarding', quantity: 1, unit_price: 300 },
    ]) {
      await create('quote_item', { ...item, quote: quote.id });
    }

    const ran = await run('recalculate_quote', { quote_id: quote.id });
    expect(ran.status).toBe(200);
    expect(ran.json).toEqual({ id: quote.id, total: 425, items: 2 });
    const stored = (await api(`${base}/records/quote/${quote.id}`)).json as { total: number; updated_by: string };
    expect(stored).toMatchObject({ total: 425, updated_by: `module:${quotesIds.module}@user:${owner.userId}` });
  });

  it('links a quote to a deal and its company, and deletes the quote’s items with it', async () => {
    const company = await create('company', { name: 'Offer Co' });
    const deal = await create('deal', { name: 'Big offer', company: company.id });
    const quote = await create('quote', { title: 'Big offer', deal: deal.id, company: company.id });
    await create('quote_item', { quote: quote.id, description: 'Seats', quantity: 1, unit_price: 100 });
    const items = () =>
      api(`${base}/records/quote_item/list`, {
        body: { filter: { field: 'quote', op: 'eq', value: quote.id } },
      }).then((response) => (response.json as { items: unknown[] }).items);
    expect(await items()).toHaveLength(1);

    // The quote survives its deal; its own items go with it.
    expect((await api(`${base}/records/deal/${deal.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`${base}/records/quote/${quote.id}`)).status).toBe(200);
    expect((await api(`${base}/records/quote/${quote.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await items()).toEqual([]);
  });
});
