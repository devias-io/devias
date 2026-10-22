import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, type Session, signUp } from './helpers';

interface Nav {
  id: string;
  label: string;
  parentId: string | null;
  position: number;
  moduleId: string | null;
  overrides: Record<string, unknown> | null;
}

describe('arranging the sidebar over HTTP', () => {
  let server: Server;
  let alice: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;

  const items = async () => (await api(`${base}/metadata/nav-items`)).json as Nav[];
  const named = async (label: string) => {
    const found = (await items()).find((n) => n.label === label);

    if (!found) {
      throw new Error(`no nav item "${label}"`);
    }

    return found;
  };

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}`;
  });
  afterAll(() => server.close());

  it("renames and hides a module's item without touching what the module defined", async () => {
    const people = await named('People');
    const patched = await api(`${base}/metadata/nav-items/${people.id}`, {
      method: 'PATCH',
      body: { label: 'Everyone', hidden: true },
    });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ label: 'People', overrides: { label: 'Everyone', hidden: true } });
    const refused = await api(`${base}/metadata/nav-items/${people.id}`, {
      method: 'PATCH',
      body: { target: { kind: 'url', url: '/x' } },
    });
    expect(refused.status).toBe(400);
  });

  it('arranges several items in one request, and resets one of them', async () => {
    const [people, companies, sales] = await Promise.all([named('People'), named('Companies'), named('Sales')]);
    const arranged = await api(`${base}/metadata/nav-items/arrange`, {
      body: {
        items: [
          { id: companies.id, parentId: sales.id, position: 0 },
          { id: people.id, parentId: sales.id, position: 1 },
        ],
      },
    });
    expect(arranged.status).toBe(200);
    const after = arranged.json as Nav[];
    expect(after.find((n) => n.id === companies.id)?.overrides).toEqual({ parentId: sales.id, position: 0 });
    // The module's own parent and position are still there.
    expect(after.find((n) => n.id === companies.id)).toMatchObject({ parentId: companies.parentId, position: 1 });

    const reset = await api(`${base}/metadata/nav-items/${people.id}/reset`, { body: {} });
    expect(reset.status).toBe(200);
    expect((reset.json as Nav).overrides).toBeNull();
  });

  it('puts the whole sidebar back to its defaults in one request', async () => {
    const people = await named('People');
    await api(`${base}/metadata/nav-items/${people.id}`, { method: 'PATCH', body: { label: 'Folks', hidden: true } });
    const placed = await api(`${base}/metadata/nav-items`, {
      body: { label: 'Automations', target: { kind: 'page', pageId: 'studio.workflows' } },
    });
    expect(placed.status).toBe(201);
    const reset = await api(`${base}/metadata/nav-items/reset`, { body: {} });
    expect(reset.status).toBe(200);
    const left = reset.json as Nav[];
    expect(left.every((n) => n.overrides === null)).toBe(true);
    // What the workspace made stays: reset only clears overrides.
    expect(left.some((n) => n.label === 'Automations')).toBe(true);
    expect(left.find((n) => n.id === people.id)?.label).toBe('People');
  });

  it('is for people who may write metadata: a member is refused', async () => {
    const bob = await signUp(server, 'bob@example.com', 'Bob');
    const invitation = await server.app.request('/api/auth/organization/invite-member', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ email: 'bob@example.com', role: 'member', organizationId: ws.id }),
    });
    const { id } = (await invitation.json()) as { id: string };
    await server.app.request('/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bob.cookie },
      body: JSON.stringify({ invitationId: id }),
    });
    const member = client(server, { cookie: bob.cookie });
    const people = await named('People');
    const refused = await member(`${base}/metadata/nav-items/arrange`, {
      body: { items: [{ id: people.id, parentId: null, position: 0 }] },
    });
    expect(refused.status).toBe(403);
  });
});
