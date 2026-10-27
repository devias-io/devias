import { coreIds } from '@devias/core';
import type { EngineContext } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { workspaceChangeNotification } from '../src/notifications/workspace-updates';
import { client, createTestServer, createWorkspace, type Session, signUp } from './helpers';

describe('workspace change notification content', () => {
  const base = { workspaceId: 'ws', userId: 'u1', userName: 'Alice', role: 'owner' };

  it('says what changed, and a new URL is a warning', () => {
    expect(workspaceChangeNotification({ ...base, name: { from: 'Acme', to: 'Acme Inc' } })).toMatchObject({
      title: 'Workspace renamed',
      level: 'info',
      kind: 'workspace.updated',
      target: { kind: 'settings', section: 'general' },
    });
    const moved = workspaceChangeNotification({ ...base, slug: { from: 'acme', to: 'acme-inc' } });
    expect(moved).toMatchObject({ title: 'Workspace URL changed', level: 'warning' });
    expect(moved.body).toContain('/workspaces/acme-inc');
    expect(
      workspaceChangeNotification({
        ...base,
        name: { from: 'A', to: 'B' },
        slug: { from: 'a', to: 'b' },
      }).title,
    ).toBe('Workspace name and URL changed');
  });
});

describe('notifying members when the workspace name or slug changes', () => {
  let server: Server;
  let alice: Session;
  let bob: Session;
  let ws: { id: string; slug: string };
  let aliceCtx: EngineContext;
  let bobCtx: EngineContext;

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
    aliceCtx = { workspaceId: ws.id, actor: { kind: 'user', id: alice.userId }, role: 'owner' };
    const invitation = (await server.actions.invoke(aliceCtx, coreIds.actions.invite_member, {
      email: 'bob@example.com',
      role: 'member',
    })) as { id: string };
    bob = await signUp(server, 'bob@example.com', 'Bob');
    const accepted = await server.app.request('/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bob.cookie },
      body: JSON.stringify({ invitationId: invitation.id }),
    });
    expect(accepted.status).toBe(200);
    bobCtx = { workspaceId: ws.id, actor: { kind: 'user', id: bob.userId }, role: 'member' };
  });
  afterAll(() => server.close());

  const update = (data: Record<string, unknown>) =>
    server.app.request('/api/auth/organization/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ organizationId: ws.id, data }),
    });
  const inbox = async (ctx: EngineContext) =>
    (await server.actions.invoke(ctx, coreIds.actions.list_notifications, {})) as {
      items: { title: string; body: string | null; level: string; kind: string }[];
    };

  it('tells every member, the person who did it included', async () => {
    const response = await update({ name: 'Acme Inc' });
    expect(response.status).toBe(200);
    const bobs = await inbox(bobCtx);
    expect(bobs.items).toHaveLength(1);
    expect(bobs.items[0]).toMatchObject({ title: 'Workspace renamed', level: 'info', kind: 'workspace.updated' });
    expect(bobs.items[0]?.body).toContain('Alice renamed the workspace from “Acme” to “Acme Inc”');
    // Alice made the change and sees it too: in a workspace of one, this is how the change shows up.
    const alices = (await inbox(aliceCtx)).items.filter((item) => item.kind === 'workspace.updated');
    expect(alices).toHaveLength(1);
    expect(alices[0]?.title).toBe('Workspace renamed');
  });

  it('replaces the unread notification on a further change, and warns about a new URL', async () => {
    const response = await update({ slug: 'acme-inc' });
    expect(response.status).toBe(200);
    const bobs = await inbox(bobCtx);
    expect(bobs.items).toHaveLength(1);
    expect(bobs.items[0]).toMatchObject({ title: 'Workspace URL changed', level: 'warning' });
  });

  it('sends nothing when neither name nor slug changed', async () => {
    const before = (await inbox(bobCtx)).items[0];
    const response = await update({ logo: 'https://example.com/logo.png' });
    expect(response.status).toBe(200);
    const after = await inbox(bobCtx);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toEqual(before);
  });
});

describe('a workspace of one', () => {
  it('still sees its own rename and invitation, since nobody else would', async () => {
    const server = await createTestServer();

    try {
      const solo = await signUp(server, 'solo@example.com', 'Solo');
      const workspace = await createWorkspace(client(server, { cookie: solo.cookie }), 'Solo Inc', 'solo');
      const ctx: EngineContext = { workspaceId: workspace.id, actor: { kind: 'user', id: solo.userId }, role: 'owner' };
      const renamed = await server.app.request('/api/auth/organization/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: solo.cookie },
        body: JSON.stringify({ organizationId: workspace.id, data: { name: 'Solo Ltd' } }),
      });
      expect(renamed.status).toBe(200);
      await server.actions.invoke(ctx, coreIds.actions.invite_member, { email: 'new@example.com', role: 'member' });
      const items = (
        (await server.actions.invoke(ctx, coreIds.actions.list_notifications, {})) as { items: { kind: string }[] }
      ).items;
      expect(items.map((item) => item.kind).sort()).toEqual(['workspace.invited', 'workspace.updated']);
    } finally {
      await server.close();
    }
  });
});

describe('notifying owners and admins about invitations', () => {
  let server: Server;
  let alice: Session;
  let carol: Session;
  let ws: { id: string; slug: string };
  let aliceCtx: EngineContext;
  let carolCtx: EngineContext;

  const accept = async (session: Session, invitationId: string) => {
    const response = await server.app.request('/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ invitationId }),
    });
    expect(response.status).toBe(200);
  };
  const inbox = async (ctx: EngineContext) =>
    (
      (await server.actions.invoke(ctx, coreIds.actions.list_notifications, {})) as {
        items: { title: string; body: string | null; level: string; kind: string; target: unknown }[];
      }
    ).items;

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
    aliceCtx = { workspaceId: ws.id, actor: { kind: 'user', id: alice.userId }, role: 'owner' };
    // A second steward, so there is someone besides the inviter to tell.
    const invitation = (await server.actions.invoke(aliceCtx, coreIds.actions.invite_member, {
      email: 'carol@example.com',
      role: 'admin',
    })) as { id: string };
    carol = await signUp(server, 'carol@example.com', 'Carol');
    await accept(carol, invitation.id);
    carolCtx = { workspaceId: ws.id, actor: { kind: 'user', id: carol.userId }, role: 'admin' };
  });
  afterAll(() => server.close());

  it('tells the owner who invited Carol when she accepts', async () => {
    // Carol joined: the owner who invited her heard about it.
    const first = (await inbox(aliceCtx)).filter((n) => n.kind === 'workspace.joined');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      title: 'Carol joined the workspace',
      level: 'success',
      kind: 'workspace.joined',
      target: { kind: 'settings', section: 'members' },
    });
    expect(first[0]?.body).toContain('accepted the invitation');
    // She was told nothing about her own arrival, and was not there for the first invitation.
    expect(await inbox(carolCtx)).toHaveLength(0);
    // The invitation itself is in the inviter's inbox too.
    expect((await inbox(aliceCtx)).map((n) => n.kind)).toContain('workspace.invited');
  });

  it('notifies admins of a new invitation, then of the person joining', async () => {
    const invitation = (await server.actions.invoke(aliceCtx, coreIds.actions.invite_member, {
      email: 'dave@example.com',
      role: 'member',
    })) as { id: string };
    const sent = await inbox(carolCtx);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Invitation sent', kind: 'workspace.invited', level: 'info' });
    expect(sent[0]?.body).toContain('Alice invited **dave@example.com** to the workspace as member');
    // The inviter sees it in her own inbox as well.
    expect((await inbox(aliceCtx)).some((n) => n.title === 'Invitation sent')).toBe(true);

    const dave = await signUp(server, 'dave@example.com', 'Dave');
    await accept(dave, invitation.id);
    const daveCtx: EngineContext = { workspaceId: ws.id, actor: { kind: 'user', id: dave.userId }, role: 'member' };
    expect((await inbox(aliceCtx)).map((n) => n.title)).toContain('Dave joined the workspace');
    expect((await inbox(carolCtx)).map((n) => n.title)).toContain('Dave joined the workspace');
    expect(await inbox(daveCtx)).toHaveLength(0);
  });

  it('does the same when the studio invites through Better Auth directly', async () => {
    const response = await server.app.request('/api/auth/organization/invite-member', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ email: 'erin@example.com', role: 'admin', organizationId: ws.id }),
    });
    expect(response.status).toBe(200);
    const mine = (await inbox(carolCtx)).filter((n) => n.body?.includes('erin@example.com'));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.body).toContain('as admin');
  });
});
