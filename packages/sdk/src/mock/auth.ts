import type {
  ApiKeySummary,
  AuthAdapter,
  AuthUser,
  Invitation,
  Member,
  MemberRole,
  Organization,
  SessionState,
} from '@devias/core';
import { AVATAR_MAX_BYTES } from '@devias/core';

/**
 * In-memory `AuthAdapter`. `useSession` is a plain function returning the current state; the studio
 * wraps it in a React hook with `useSyncExternalStore(adapter.subscribe, adapter.getSnapshot)`.
 * Sign-in/up always succeed, invitations resolve instantly and API keys are fake but shaped like real ones.
 */
export interface MockAuthOptions {
  user?: Partial<AuthUser>;
  organizations?: Organization[];
  /** Start signed out (default: signed in as the mock user). */
  signedIn?: boolean;
  /** Artificial delay for every call, in ms. */
  latency?: number;
  /** Other people in every workspace, as members (e.g. `MOCK_TEAMMATES`, who author the demo activity). */
  teammates?: AuthUser[];
}

/** The people behind a demo workspace's seeded activity. */
export const MOCK_TEAMMATES: AuthUser[] = [
  { id: 'user_ada', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
  { id: 'user_grace', name: 'Grace Hopper', email: 'grace@example.com', image: null },
  { id: 'user_linus', name: 'Linus Torvalds', email: 'linus@example.com', image: null },
];

export interface MockAuthAdapter extends AuthAdapter {
  apiKeys: NonNullable<AuthAdapter['apiKeys']>;
  /** External-store API for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionState;
  setSession(state: SessionState): void;
}

const DEFAULT_USER: AuthUser = { id: 'user_dev', name: 'Dev User', email: 'dev@example.com', image: null };

const defaultOrganizations = (createdAt: string): Organization[] => [
  { id: 'org_acme', name: 'Acme', slug: 'acme', logo: null, createdAt },
  { id: 'org_globex', name: 'Globex', slug: 'globex', logo: null, createdAt },
];

const randomKey = (): string => {
  let out = '';

  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 36).toString(36);
  }

  return out;
};

export const createMockAuthAdapter = (options: MockAuthOptions = {}): MockAuthAdapter => {
  const now = () => new Date().toISOString();
  const user: AuthUser = { ...DEFAULT_USER, ...options.user };
  const organizations: Organization[] = options.organizations ?? defaultOrganizations(now());
  const members = new Map<string, Member[]>();
  const invitations = new Map<string, Invitation>();
  const apiKeys = new Map<string, ApiKeySummary[]>();
  const listeners = new Set<() => void>();
  let counter = 0;
  const nextId = (prefix: string) => {
    counter += 1;

    return `${prefix}_${counter}`;
  };

  const ownerOf = (organizationId: string): Member => ({
    id: `member_${organizationId}_${user.id}`,
    userId: user.id,
    role: 'owner',
    user,
    createdAt: now(),
  });
  const teammate = (organizationId: string, member: AuthUser): Member => ({
    id: `member_${organizationId}_${member.id}`,
    userId: member.id,
    role: 'member',
    user: member,
    createdAt: now(),
  });

  for (const organization of organizations) {
    members.set(organization.id, [
      ownerOf(organization.id),
      ...(options.teammates ?? []).map((member) => teammate(organization.id, member)),
    ]);
  }

  let state: SessionState =
    options.signedIn === false
      ? { status: 'unauthenticated' }
      : { status: 'authenticated', user, activeOrganizationId: organizations[0]?.id ?? null };

  const setSession = (next: SessionState) => {
    state = next;

    for (const listener of listeners) {
      listener();
    }
  };

  const latency = options.latency ?? 0;
  const run = async <T>(fn: () => T): Promise<T> => {
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }

    return fn();
  };

  const requireOrganization = (organizationId: string): Organization => {
    const organization = organizations.find((candidate) => candidate.id === organizationId);

    if (!organization) {
      throw new Error(`Unknown organization "${organizationId}"`);
    }

    return organization;
  };

  const membersOf = (organizationId: string): Member[] => {
    requireOrganization(organizationId);
    let list = members.get(organizationId);

    if (!list) {
      list = [];
      members.set(organizationId, list);
    }

    return list;
  };

  const requireInvitation = (id: string): Invitation => {
    const invitation = invitations.get(id);

    if (!invitation) {
      throw new Error(`Unknown invitation "${id}"`);
    }

    return invitation;
  };

  const signInAs = (next: AuthUser) => {
    setSession({
      status: 'authenticated',
      user: next,
      activeOrganizationId: state.activeOrganizationId ?? organizations[0]?.id ?? null,
    });
  };

  return {
    useSession: () => state,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    setSession,
    getSession: () =>
      run(() =>
        state.status === 'authenticated' && state.user
          ? { user: state.user, activeOrganizationId: state.activeOrganizationId ?? null }
          : null,
      ),
    signIn: ({ email }) =>
      run(() => {
        signInAs(email.toLowerCase() === user.email.toLowerCase() ? user : { ...user, email });

        return { ok: true };
      }),
    signUp: ({ name, email }) =>
      run(() => {
        signInAs({ ...user, name, email });

        return { ok: true };
      }),
    signOut: () =>
      run(() => {
        setSession({ status: 'unauthenticated' });
      }),
    updateUser: (patch) =>
      run(() => {
        if (state.status !== 'authenticated' || !state.user) {
          throw new Error('Not signed in');
        }

        setSession({ ...state, user: { ...state.user, ...patch } });
      }),
    setAvatar: async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());

      await run(() => {
        if (state.status !== 'authenticated' || !state.user) {
          throw new Error('Not signed in');
        }

        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
          throw new Error('Use a PNG, JPEG, WebP, GIF or AVIF picture');
        }

        if (file.size > AVATAR_MAX_BYTES) {
          throw new Error(`A picture may be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`);
        }

        const image = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
        setSession({ ...state, user: { ...state.user, image } });
      });
    },
    removeAvatar: () =>
      run(() => {
        if (state.status !== 'authenticated' || !state.user) {
          throw new Error('Not signed in');
        }

        setSession({ ...state, user: { ...state.user, image: null } });
      }),
    changeEmail: (email) =>
      run(() => {
        if (state.status !== 'authenticated' || !state.user) {
          throw new Error('Not signed in');
        }

        setSession({ ...state, user: { ...state.user, email } });
      }),
    organizations: {
      list: () => run(() => [...organizations]),
      create: ({ name, slug }) =>
        run(() => {
          if (organizations.some((organization) => organization.slug === slug)) {
            throw new Error(`Slug "${slug}" is already taken`);
          }

          const organization: Organization = { id: nextId('org'), name, slug, logo: null, createdAt: now() };
          organizations.push(organization);
          members.set(organization.id, [ownerOf(organization.id)]);

          return organization;
        }),
      setActive: ({ organizationId }) =>
        run(() => {
          requireOrganization(organizationId);
          setSession({ ...state, activeOrganizationId: organizationId });
        }),
      getBySlug: (slug) => run(() => organizations.find((organization) => organization.slug === slug) ?? null),
      delete: (organizationId) =>
        run(() => {
          const organization = requireOrganization(organizationId);
          organizations.splice(organizations.indexOf(organization), 1);
          members.delete(organizationId);

          if (state.status === 'authenticated' && state.activeOrganizationId === organizationId) {
            setSession({ ...state, activeOrganizationId: organizations[0]?.id ?? null });
          }
        }),
      update: (organizationId, patch) =>
        run(() => {
          const organization = requireOrganization(organizationId);

          if (patch.name !== undefined) {
            organization.name = patch.name;
          }

          if (patch.slug !== undefined) {
            organization.slug = patch.slug;
          }

          if (patch.logo !== undefined) {
            organization.logo = patch.logo;
          }

          return organization;
        }),
      members: {
        list: (organizationId) => run(() => [...membersOf(organizationId)]),
        invite: (organizationId, { email, role }) =>
          run(() => {
            const organization = requireOrganization(organizationId);
            const invitation: Invitation = {
              id: nextId('inv'),
              email,
              role,
              status: 'pending',
              organizationId,
              organizationName: organization.name,
              expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            };
            invitations.set(invitation.id, invitation);

            return invitation;
          }),
        listInvitations: (organizationId) =>
          run(() => [...invitations.values()].filter((invitation) => invitation.organizationId === organizationId)),
        cancelInvitation: (invitationId) =>
          run(() => {
            requireInvitation(invitationId).status = 'canceled';
          }),
        remove: (organizationId, memberId) =>
          run(() => {
            const list = membersOf(organizationId);
            const index = list.findIndex((member) => member.id === memberId);

            if (index >= 0) {
              list.splice(index, 1);
            }
          }),
        updateRole: (organizationId, memberId, role: MemberRole) =>
          run(() => {
            const member = membersOf(organizationId).find((candidate) => candidate.id === memberId);

            if (member) {
              member.role = role;
            }
          }),
      },
      invitations: {
        get: (id) => run(() => requireInvitation(id)),
        accept: (id) =>
          run(() => {
            const invitation = requireInvitation(id);
            invitation.status = 'accepted';
            const list = membersOf(invitation.organizationId);
            const invitee: AuthUser = {
              id: `user_${invitation.email.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
              name: invitation.email.split('@')[0] ?? invitation.email,
              email: invitation.email,
              image: null,
            };

            if (!list.some((member) => member.user.email === invitation.email)) {
              list.push({
                id: nextId('member'),
                userId: invitee.id,
                role: invitation.role,
                user: invitee,
                createdAt: now(),
              });
            }

            return { organizationId: invitation.organizationId };
          }),
        reject: (id) =>
          run(() => {
            requireInvitation(id).status = 'rejected';
          }),
      },
    },
    apiKeys: {
      list: (organizationId) => run(() => [...(apiKeys.get(organizationId) ?? [])]),
      create: (organizationId, input) =>
        run(() => {
          requireOrganization(organizationId);
          const key = `devias_mock_${randomKey()}`;
          const summary: ApiKeySummary = {
            id: nextId('key'),
            name: input.name,
            start: key.slice(0, 12),
            prefix: 'devias_mock',
            createdAt: now(),
            expiresAt: input.expiresInDays
              ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
              : null,
            lastRequest: null,
          };
          apiKeys.set(organizationId, [...(apiKeys.get(organizationId) ?? []), summary]);

          // The raw key is returned exactly once, like the real thing.
          return { ...summary, key };
        }),
      delete: (organizationId, id) =>
        run(() => {
          apiKeys.set(
            organizationId,
            (apiKeys.get(organizationId) ?? []).filter((summary) => summary.id !== id),
          );
        }),
    },
  };
};
