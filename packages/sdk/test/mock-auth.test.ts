import { describe, expect, it } from 'vitest';
import { createMockAuthAdapter } from '../src/mock';

describe('createMockAuthAdapter', () => {
  it('starts signed in as the dev user with two organizations', async () => {
    const auth = createMockAuthAdapter();
    expect(auth.useSession()).toEqual({
      status: 'authenticated',
      user: { id: 'user_dev', name: 'Dev User', email: 'dev@example.com', image: null },
      activeOrganizationId: 'org_acme',
    });
    expect(auth.getSnapshot()).toBe(auth.useSession());
    expect((await auth.organizations.list()).map((o) => o.slug)).toEqual(['acme', 'globex']);
    expect((await auth.getSession())?.user.email).toBe('dev@example.com');
    expect((await auth.organizations.getBySlug('globex'))?.id).toBe('org_globex');
    expect(await auth.organizations.getBySlug('nope')).toBeNull();
  });

  it('notifies subscribers on session changes', async () => {
    const auth = createMockAuthAdapter({ signedIn: false, user: { name: 'Custom' } });
    const seen: string[] = [];
    const stop = auth.subscribe(() => seen.push(auth.getSnapshot().status));
    expect(auth.getSnapshot().status).toBe('unauthenticated');
    expect(await auth.getSession()).toBeNull();
    expect(await auth.signIn({ email: 'someone@example.com', password: 'x' })).toEqual({ ok: true });
    expect(auth.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: { name: 'Custom', email: 'someone@example.com' },
      activeOrganizationId: 'org_acme',
    });
    await auth.organizations.setActive({ organizationId: 'org_globex' });
    expect(auth.getSnapshot().activeOrganizationId).toBe('org_globex');
    await auth.signOut();
    expect(seen).toEqual(['authenticated', 'authenticated', 'unauthenticated']);
    stop();
    await auth.signUp({ name: 'New', email: 'new@example.com', password: 'x' });
    expect(seen).toHaveLength(3);
    expect(auth.getSnapshot().user?.name).toBe('New');
  });

  it('handles organizations, members, invitations and api keys', async () => {
    const auth = createMockAuthAdapter();
    const org = await auth.organizations.create({ name: 'Initech', slug: 'initech' });
    expect((await auth.organizations.members.list(org.id)).map((m) => m.role)).toEqual(['owner']);
    const invitation = await auth.organizations.members.invite(org.id, { email: 'peter@initech.com', role: 'member' });
    expect(invitation.status).toBe('pending');
    expect(await auth.organizations.members.listInvitations(org.id)).toEqual([invitation]);
    expect(await auth.organizations.invitations.accept(invitation.id)).toEqual({ organizationId: org.id });
    expect((await auth.organizations.invitations.get(invitation.id)).status).toBe('accepted');
    const members = await auth.organizations.members.list(org.id);
    expect(members).toHaveLength(2);
    const peter = members.find((m) => m.user.email === 'peter@initech.com');
    await auth.organizations.members.updateRole(org.id, peter?.id ?? '', 'admin');
    expect((await auth.organizations.members.list(org.id)).find((m) => m.id === peter?.id)?.role).toBe('admin');
    await auth.organizations.members.remove(org.id, peter?.id ?? '');
    expect(await auth.organizations.members.list(org.id)).toHaveLength(1);
    const second = await auth.organizations.members.invite(org.id, { email: 'x@initech.com', role: 'admin' });
    await auth.organizations.members.cancelInvitation(second.id);
    expect((await auth.organizations.invitations.get(second.id)).status).toBe('canceled');
    expect((await auth.organizations.update(org.id, { name: 'Initrode' })).name).toBe('Initrode');

    const key = await auth.apiKeys.create(org.id, { name: 'CI', expiresInDays: 30 });
    expect(key.key).toMatch(/^devias_mock_/);
    expect(key.expiresAt).toBeTruthy();
    const listed = await auth.apiKeys.list(org.id);
    expect(listed).toHaveLength(1);
    expect('key' in (listed[0] as object)).toBe(false);
    expect(listed[0]?.id).toBe(key.id);
    await auth.apiKeys.delete(org.id, key.id);
    expect(await auth.apiKeys.list(org.id)).toEqual([]);
    await expect(auth.organizations.create({ name: 'Dup', slug: 'acme' })).rejects.toThrow(/taken/);
  });
});
