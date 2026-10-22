import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, type Session, signUp } from './helpers';

describe('a new workspace starts without the CRM', () => {
  let server: Server;
  let alice: Session;
  let ws: { id: string; slug: string };

  beforeAll(async () => {
    server = await createTestServer({ bare: true });
    alice = await signUp(server, 'alice@example.com', 'Alice');
    ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
  });
  afterAll(() => server.close());

  it('has no objects and no installed modules besides the core ones', async () => {
    const api = client(server, { cookie: alice.cookie });
    const schema = (await api(`/api/workspaces/${ws.id}/metadata`)).json as {
      objects: { nameSingular: string }[];
      navItems: unknown[];
      modules: { moduleId: string; core?: boolean }[];
    };
    expect(schema.objects).toEqual([]);
    expect(schema.navItems).toEqual([]);
    expect(schema.modules.filter((entry) => !entry.core)).toEqual([]);
  });

  it('offers the CRM in the catalog, and installing it from there brings the objects and sections', async () => {
    const api = client(server, { cookie: alice.cookie });
    const catalog = (await api(`/api/workspaces/${ws.id}/modules/catalog`)).json as { id: string; version: string }[];
    expect(catalog.map((entry) => entry.id)).toContain('crm');
    const manifest = catalog.find((entry) => entry.id === 'crm');
    const plan = await api(`/api/workspaces/${ws.id}/modules/plan`, { body: { manifest } });
    expect(plan.status).toBe(200);
    const applied = await api(`/api/workspaces/${ws.id}/modules/apply`, {
      body: { manifest, expectedPlanHash: (plan.json as { planHash: string }).planHash },
    });
    expect(applied.status).toBe(200);
    const schema = (await api(`/api/workspaces/${ws.id}/metadata`)).json as {
      objects: { nameSingular: string }[];
      navItems: { label: string; parentId: string | null }[];
    };
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual(['company', 'deal', 'person']);
    // Two sections, nested rows under them.
    expect(schema.navItems.filter((n) => n.parentId === null).map((n) => n.label)).toEqual(['Prospects', 'Sales']);
    // And it can be taken out again without anything left behind.
    const removed = await api(`/api/workspaces/${ws.id}/modules/crm?allowDestructive=true`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(
      ((await api(`/api/workspaces/${ws.id}/metadata`)).json as { objects: unknown[]; navItems: unknown[] }).navItems,
    ).toEqual([]);
  });
});
