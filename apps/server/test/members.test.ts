import type { EngineContext } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, type Session, signUp } from './helpers';

describe('members and invitations as actions', () => {
  let server: Server;
  let alice: Session;
  let ws: { id: string; slug: string };
  let owner: EngineContext;

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
    owner = { workspaceId: ws.id, actor: { kind: 'user', id: alice.userId }, role: 'owner' };
  });
  afterAll(() => server.close());

  const invoke = (ctx: EngineContext, id: string, input: unknown = {}) => server.actions.invoke(ctx, id, input);

  it('lists members over HTTP and as an action', async () => {
    const response = await client(server, { cookie: alice.cookie })(`/api/workspaces/${ws.id}/members`);
    expect(response.status).toBe(200);
    expect(response.json).toEqual([
      expect.objectContaining({
        userId: alice.userId,
        role: 'owner',
        user: expect.objectContaining({ name: 'Alice' }),
      }),
    ]);
    expect(await invoke(owner, 'core.list_members')).toEqual(response.json);
  });

  it('invites once per email, and the invitation is accepted through Better Auth', async () => {
    const invitation = (await invoke(owner, 'core.invite_member', {
      email: 'Dave@Example.com',
      role: 'admin',
    })) as {
      id: string;
      email: string;
    };
    expect(invitation).toMatchObject({ email: 'dave@example.com', role: 'admin', status: 'pending' });
    await expect(invoke(owner, 'core.invite_member', { email: 'dave@example.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await invoke(owner, 'core.list_invitations')).toEqual([expect.objectContaining({ id: invitation.id })]);

    const dave = await signUp(server, 'dave@example.com', 'Dave');
    const accepted = await server.app.request('/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: dave.cookie },
      body: JSON.stringify({ invitationId: invitation.id }),
    });
    expect(accepted.status).toBe(200);
    const members = (await invoke(owner, 'core.list_members')) as { userId: string; role: string }[];
    expect(members).toContainEqual(expect.objectContaining({ userId: dave.userId, role: 'admin' }));
    expect(await invoke(owner, 'core.list_invitations')).toEqual([]);
    await expect(invoke(owner, 'core.invite_member', { email: 'dave@example.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('cancels a pending invitation', async () => {
    const invitation = (await invoke(owner, 'core.invite_member', { email: 'erin@example.com' })) as {
      id: string;
    };
    await invoke(owner, 'core.cancel_invitation', { invitationId: invitation.id });
    expect(await invoke(owner, 'core.list_invitations')).toEqual([]);
    await expect(invoke(owner, 'core.cancel_invitation', { invitationId: invitation.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps the owner role to owners and always keeps one owner', async () => {
    const carol = await signUp(server, 'carol@example.com', 'Carol');
    await server.auth.api.addMember({ body: { userId: carol.userId, organizationId: ws.id, role: 'member' } });
    const members = (await invoke(owner, 'core.list_members')) as { id: string; userId: string }[];
    const carolMember = members.find((member) => member.userId === carol.userId);
    const aliceMember = members.find((member) => member.userId === alice.userId);

    if (!carolMember || !aliceMember) {
      throw new Error('members missing');
    }

    expect(await invoke(owner, 'core.change_member_role', { memberId: carolMember.id, role: 'admin' })).toMatchObject({
      role: 'admin',
    });
    const admin: EngineContext = { workspaceId: ws.id, actor: { kind: 'user', id: carol.userId }, role: 'admin' };
    await expect(
      invoke(admin, 'core.change_member_role', { memberId: aliceMember.id, role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      invoke(admin, 'core.change_member_role', { memberId: carolMember.id, role: 'owner' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(invoke(admin, 'core.invite_member', { email: 'x@example.com', role: 'owner' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      invoke(owner, 'core.change_member_role', { memberId: aliceMember.id, role: 'admin' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(invoke(owner, 'core.remove_member', { memberId: aliceMember.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const member: EngineContext = { ...admin, role: 'member' };
    await expect(invoke(member, 'core.remove_member', { memberId: carolMember.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await invoke(owner, 'core.remove_member', { memberId: carolMember.id });
    const after = (await invoke(owner, 'core.list_members')) as { userId: string }[];
    expect(after.map((m) => m.userId)).not.toContain(carol.userId);
    expect((await client(server, { cookie: carol.cookie })(`/api/workspaces/${ws.id}/metadata`)).status).toBe(403);
  });
});
