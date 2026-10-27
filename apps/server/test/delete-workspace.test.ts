import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, type Session, signUp } from './helpers';

describe('deleting a workspace', () => {
  let server: Server;
  let alice: Session;
  let bob: Session;
  let ws: { id: string; slug: string };

  const post = (cookie: string, path: string, body: unknown) =>
    server.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    bob = await signUp(server, 'bob@example.com', 'Bob');
    ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
    // Bob is an admin there: he can manage it, but not delete it.
    const invitation = await post(alice.cookie, '/api/auth/organization/invite-member', {
      email: 'bob@example.com',
      role: 'admin',
      organizationId: ws.id,
    });
    const { id } = (await invitation.json()) as { id: string };
    await post(bob.cookie, '/api/auth/organization/accept-invitation', { invitationId: id });
  });
  afterAll(() => server.close());

  it('is for owners: an admin is refused and the workspace stays', async () => {
    const refused = await post(bob.cookie, '/api/auth/organization/delete', { organizationId: ws.id });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const still = await client(server, { cookie: alice.cookie })(`/api/workspaces/${ws.id}/metadata`);
    expect(still.status).toBe(200);
  });

  it('removes the workspace and everything the engine kept for it, and frees the address', async () => {
    await client(server, { cookie: alice.cookie })(`/api/workspaces/${ws.id}/records/note`, { body: {} }).catch(
      () => null,
    );
    expect(await server.engine.workspaces.list()).toContain(ws.id);

    const deleted = await post(alice.cookie, '/api/auth/organization/delete', { organizationId: ws.id });
    expect(deleted.status).toBe(200);

    expect(await server.engine.workspaces.list()).not.toContain(ws.id);
    const gone = await client(server, { cookie: alice.cookie })(`/api/workspaces/${ws.id}/metadata`);
    expect([403, 404]).toContain(gone.status);
    // The address can be used again, by anyone.
    const again = await createWorkspace(client(server, { cookie: bob.cookie }), 'Acme again', 'acme');
    expect(again.slug).toBe('acme');
  });
});
