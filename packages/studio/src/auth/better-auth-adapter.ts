import type {
  ApiKeySummary,
  AuthAdapter,
  AuthResult,
  AuthSession,
  AuthUser,
  Invitation,
  Member,
  MemberRole,
  Organization,
  SessionState,
} from '@devias/core';

/**
 * Structural view of a Better Auth React client created with `organizationClient()`. Declared with method
 * signatures (bivariant parameters) so the real, deeply generic client is assignable without the studio
 * depending on Better Auth's types.
 */
export interface BetterAuthError {
  message?: string;
  code?: string;
  status?: number;
  statusText?: string;
}

export interface BetterAuthResult<T> {
  data: T | null;
  error: BetterAuthError | null;
}

export interface BetterAuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface BetterAuthSessionData {
  user: BetterAuthUser;
  session: { activeOrganizationId?: string | null };
}

export interface BetterAuthOrganization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt?: Date | string;
}

export interface BetterAuthMember {
  id: string;
  userId: string;
  role: string;
  createdAt?: Date | string;
  user?: { id?: string; name: string; email: string; image?: string | null };
}

export interface BetterAuthInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  organizationId: string;
  expiresAt?: Date | string;
  organizationName?: string;
  organizationSlug?: string;
}

export interface BetterAuthClientLike {
  useSession(): { data: BetterAuthSessionData | null; isPending: boolean };
  getSession(options?: unknown): Promise<BetterAuthResult<BetterAuthSessionData>>;
  signIn: {
    email(input: { email: string; password: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
    /** Present on a client with social providers; the browser is sent to the provider. */
    social?(input: { provider: string; callbackURL?: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
  };
  signUp: {
    email(
      input: { name: string; email: string; password: string },
      options?: unknown,
    ): Promise<BetterAuthResult<unknown>>;
  };
  signOut(options?: unknown): Promise<BetterAuthResult<unknown>>;
  updateUser(input: { name?: string; image?: string | null }, options?: unknown): Promise<BetterAuthResult<unknown>>;
  changeEmail(input: { newEmail: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
  organization: {
    list(input?: unknown, options?: unknown): Promise<BetterAuthResult<BetterAuthOrganization[]>>;
    create(input: { name: string; slug: string }, options?: unknown): Promise<BetterAuthResult<BetterAuthOrganization>>;
    setActive(input: { organizationId: string | null }, options?: unknown): Promise<BetterAuthResult<unknown>>;
    delete(input: { organizationId: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
    getFullOrganization(
      input?: { query?: { organizationSlug?: string; organizationId?: string } },
      options?: unknown,
    ): Promise<BetterAuthResult<(BetterAuthOrganization & { members?: BetterAuthMember[] }) | null>>;
    update(
      input: { organizationId?: string; data: { name?: string; slug?: string; logo?: string | null } },
      options?: unknown,
    ): Promise<BetterAuthResult<BetterAuthOrganization>>;
    listMembers(
      input?: { query?: { organizationId?: string; limit?: number } },
      options?: unknown,
    ): Promise<BetterAuthResult<{ members: BetterAuthMember[]; total?: number }>>;
    inviteMember(
      input: { email: string; role: unknown; organizationId?: string },
      options?: unknown,
    ): Promise<BetterAuthResult<BetterAuthInvitation>>;
    listInvitations(
      input?: { query?: { organizationId?: string } },
      options?: unknown,
    ): Promise<BetterAuthResult<BetterAuthInvitation[]>>;
    cancelInvitation(input: { invitationId: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
    removeMember(
      input: { memberIdOrEmail: string; organizationId?: string },
      options?: unknown,
    ): Promise<BetterAuthResult<unknown>>;
    updateMemberRole(
      input: { memberId: string; role: unknown; organizationId?: string },
      options?: unknown,
    ): Promise<BetterAuthResult<unknown>>;
    getInvitation(input: { query: { id: string } }, options?: unknown): Promise<BetterAuthResult<BetterAuthInvitation>>;
    acceptInvitation(
      input: { invitationId: string },
      options?: unknown,
    ): Promise<BetterAuthResult<{ invitation: BetterAuthInvitation; member?: BetterAuthMember }>>;
    rejectInvitation(input: { invitationId: string }, options?: unknown): Promise<BetterAuthResult<unknown>>;
  };
}

export interface BetterAuthAdapterOptions {
  /** API origin used for the `/api/workspaces/:workspaceId/api-keys` endpoints. Defaults to same-origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const toIso = (value: Date | string | undefined): string | undefined =>
  value === undefined ? undefined : value instanceof Date ? value.toISOString() : value;

const mapUser = (user: BetterAuthUser): AuthUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
});

const mapOrganization = (org: BetterAuthOrganization): Organization => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  logo: org.logo ?? null,
  createdAt: toIso(org.createdAt),
});

const mapMember = (member: BetterAuthMember): Member => ({
  id: member.id,
  userId: member.userId,
  role: member.role,
  createdAt: toIso(member.createdAt),
  user: {
    id: member.user?.id ?? member.userId,
    name: member.user?.name ?? '',
    email: member.user?.email ?? '',
    image: member.user?.image ?? null,
  },
});

const mapInvitation = (invitation: BetterAuthInvitation): Invitation => ({
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  status: (['pending', 'accepted', 'rejected', 'canceled'] as const).includes(invitation.status as 'pending')
    ? (invitation.status as Invitation['status'])
    : 'pending',
  organizationId: invitation.organizationId,
  organizationName: invitation.organizationName,
  expiresAt: toIso(invitation.expiresAt),
});

const unwrap = <T>(result: BetterAuthResult<T>, fallback: string): T => {
  if (result.error) {
    throw new Error(result.error.message ?? result.error.code ?? fallback);
  }

  if (result.data === null || result.data === undefined) {
    throw new Error(fallback);
  }

  return result.data;
};

const toResult = (result: BetterAuthResult<unknown>): AuthResult =>
  result.error ? { ok: false, error: result.error.message ?? result.error.code ?? 'Request failed' } : { ok: true };

const mapSession = (data: BetterAuthSessionData | null): AuthSession | null =>
  data ? { user: mapUser(data.user), activeOrganizationId: data.session.activeOrganizationId ?? null } : null;

/** `AuthAdapter` over a Better Auth React client with the organization plugin. */
export const betterAuthAdapter = (
  client: BetterAuthClientLike,
  options: BetterAuthAdapterOptions = {},
): AuthAdapter => {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  const apiKeysRequest = async <T>(organizationId: string, path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(
      `${baseUrl}/api/workspaces/${encodeURIComponent(organizationId)}/api-keys${path}`,
      {
        credentials: 'include',
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      },
    );

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;

      try {
        const body = (await response.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        // keep the status message
      }

      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  };

  /** A call to the server's own account routes (`/api/me/…`): what Better Auth's client has no call for. */
  const meRequest = async (path: string, init: RequestInit, failure: string): Promise<void> => {
    const response = await fetchImpl(`${baseUrl}/api/me${path}`, { credentials: 'include', ...init });

    if (!response.ok) {
      let message = failure;

      try {
        message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? failure;
      } catch {
        // keep the general message
      }

      throw new Error(message);
    }
  };

  return {
    useSession: (): SessionState => {
      const { data, isPending } = client.useSession();

      if (isPending) {
        return { status: 'loading' };
      }

      if (!data) {
        return { status: 'unauthenticated' };
      }

      return {
        status: 'authenticated',
        user: mapUser(data.user),
        activeOrganizationId: data.session.activeOrganizationId ?? null,
      };
    },
    getSession: async () => {
      const result = await client.getSession();

      return result.error ? null : mapSession(result.data);
    },
    signIn: async (input) => toResult(await client.signIn.email(input)),
    signInWithProvider: client.signIn.social
      ? async (provider, providerOptions) => {
          const result = await client.signIn.social?.({ provider, callbackURL: providerOptions?.callbackURL });

          // A server without the provider answers 404: say what is missing, not "Provider not found".
          if (result?.error && (result.error.status === 404 || /provider/i.test(result.error.code ?? ''))) {
            return { ok: false, error: 'Google sign-in is not set up on this server yet.' };
          }

          return result ? toResult(result) : { ok: true };
        }
      : undefined,
    signUp: async (input) => toResult(await client.signUp.email(input)),
    signOut: async () => {
      await client.signOut();
    },
    updateUser: async (patch) => {
      unwrap(await client.updateUser(patch), 'Could not update your profile');
    },
    setAvatar: (file) =>
      meRequest(
        `/avatar?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file },
        'Could not set your picture',
      ),
    removeAvatar: () => meRequest('/avatar', { method: 'DELETE' }, 'Could not remove your picture'),
    changeEmail: async (email) => {
      unwrap(await client.changeEmail({ newEmail: email }), 'Could not change your email');
      // Better Auth answers a taken address like a success, so as not to say who has an account: look at the
      // session to see whether the address really changed. (This server applies the change at once.)
      const session = await client.getSession();
      const current = session.data?.user.email?.toLowerCase();

      if (current !== email.trim().toLowerCase()) {
        throw new Error('That email address cannot be used. Try a different one.');
      }
    },
    organizations: {
      list: async () => unwrap(await client.organization.list(), 'Could not list workspaces').map(mapOrganization),
      create: async (input) =>
        mapOrganization(unwrap(await client.organization.create(input), 'Could not create the workspace')),
      setActive: async ({ organizationId }) => {
        unwrap(await client.organization.setActive({ organizationId }), 'Could not switch workspace');
      },
      getBySlug: async (slug) => {
        const result = await client.organization.getFullOrganization({ query: { organizationSlug: slug } });

        if (result.error || !result.data) {
          return null;
        }

        return mapOrganization(result.data);
      },
      delete: async (organizationId) => {
        unwrap(await client.organization.delete({ organizationId }), 'Could not delete the workspace');
      },
      update: async (organizationId, patch) =>
        mapOrganization(
          unwrap(await client.organization.update({ organizationId, data: patch }), 'Could not update the workspace'),
        ),
      members: {
        list: async (organizationId) =>
          unwrap(
            await client.organization.listMembers({ query: { organizationId, limit: 200 } }),
            'Could not list members',
          ).members.map(mapMember),
        invite: async (organizationId, input) =>
          mapInvitation(
            unwrap(
              await client.organization.inviteMember({ ...input, organizationId }),
              'Could not send the invitation',
            ),
          ),
        listInvitations: async (organizationId) =>
          unwrap(
            await client.organization.listInvitations({ query: { organizationId } }),
            'Could not list invitations',
          ).map(mapInvitation),
        cancelInvitation: async (invitationId) => {
          unwrap(await client.organization.cancelInvitation({ invitationId }), 'Could not cancel the invitation');
        },
        remove: async (organizationId, memberId) => {
          unwrap(
            await client.organization.removeMember({ memberIdOrEmail: memberId, organizationId }),
            'Could not remove the member',
          );
        },
        updateRole: async (organizationId, memberId, role: MemberRole) => {
          unwrap(
            await client.organization.updateMemberRole({ memberId, role, organizationId }),
            'Could not change the role',
          );
        },
      },
      invitations: {
        get: async (id) =>
          mapInvitation(unwrap(await client.organization.getInvitation({ query: { id } }), 'Invitation not found')),
        accept: async (id) => {
          const data = unwrap(
            await client.organization.acceptInvitation({ invitationId: id }),
            'Could not accept the invitation',
          );

          return { organizationId: data.invitation.organizationId };
        },
        reject: async (id) => {
          unwrap(await client.organization.rejectInvitation({ invitationId: id }), 'Could not reject the invitation');
        },
      },
    },
    apiKeys: {
      list: async (organizationId) => {
        const body = await apiKeysRequest<ApiKeySummary[] | { items?: ApiKeySummary[]; apiKeys?: ApiKeySummary[] }>(
          organizationId,
          '',
        );

        return Array.isArray(body) ? body : (body.items ?? body.apiKeys ?? []);
      },
      create: (organizationId, input) =>
        apiKeysRequest<ApiKeySummary & { key: string }>(organizationId, '', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      delete: async (organizationId, id) => {
        await apiKeysRequest<void>(organizationId, `/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    },
  };
};
