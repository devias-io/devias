/**
 * The one auth seam the studio depends on. `@devias/studio` ships `betterAuthAdapter(authClient)` and
 * `@devias/sdk/mock` ships an in-memory implementation. The studio never imports Better Auth types directly.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  activeOrganizationId?: string | null;
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  status: SessionStatus;
  user?: AuthUser;
  activeOrganizationId?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt?: string;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface Member {
  id: string;
  userId: string;
  role: MemberRole | string;
  user: AuthUser;
  createdAt?: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: MemberRole | string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  organizationId: string;
  organizationName?: string;
  expiresAt?: string;
}

export interface ApiKeySummary {
  id: string;
  name: string | null;
  start?: string | null;
  prefix?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  lastRequest?: string | null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/** An outside account people can sign in with. */
export type AuthProvider = 'google';

export interface AuthAdapter {
  /** React hook returning the reactive session state. */
  useSession: () => SessionState;
  getSession: () => Promise<AuthSession | null>;
  signIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<AuthResult>;
  /**
   * Signs in (or up) with an outside account. The browser leaves for the provider and comes back to `callbackURL`
   * signed in, so a result only ever comes back for a failure, such as a provider the server has not switched on.
   * Absent when the adapter has none, and the sign-in page then shows no button.
   */
  signInWithProvider?: (provider: AuthProvider, options?: { callbackURL?: string }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Updates the signed-in user's own profile. */
  updateUser: (patch: { name?: string }) => Promise<void>;
  /**
   * Sets the signed-in user's picture from a file (a PNG, JPEG, WebP, GIF or AVIF of at most `AVATAR_MAX_BYTES`), replacing
   * the one they had. Absent when the adapter cannot store one, and the Profile page then offers none.
   */
  setAvatar?: (file: File) => Promise<void>;
  /** Removes the signed-in user's picture. Absent together with `setAvatar`. */
  removeAvatar?: () => Promise<void>;
  /** Changes the signed-in user's sign-in email. */
  changeEmail: (email: string) => Promise<void>;
  organizations: {
    list: () => Promise<Organization[]>;
    create: (input: { name: string; slug: string }) => Promise<Organization>;
    setActive: (input: { organizationId: string }) => Promise<void>;
    getBySlug: (slug: string) => Promise<Organization | null>;
    update: (
      organizationId: string,
      patch: { name?: string; slug?: string; logo?: string | null },
    ) => Promise<Organization>;
    /** Deletes a workspace with everything in it. Owners only; there is no undo. */
    delete: (organizationId: string) => Promise<void>;
    members: {
      list: (organizationId: string) => Promise<Member[]>;
      invite: (organizationId: string, input: { email: string; role: MemberRole }) => Promise<Invitation>;
      listInvitations: (organizationId: string) => Promise<Invitation[]>;
      cancelInvitation: (invitationId: string) => Promise<void>;
      remove: (organizationId: string, memberId: string) => Promise<void>;
      updateRole: (organizationId: string, memberId: string, role: MemberRole) => Promise<void>;
    };
    invitations: {
      get: (id: string) => Promise<Invitation>;
      accept: (id: string) => Promise<{ organizationId: string }>;
      reject: (id: string) => Promise<void>;
    };
  };
  apiKeys?: {
    list: (organizationId: string) => Promise<ApiKeySummary[]>;
    create: (
      organizationId: string,
      input: { name: string; expiresInDays?: number; permissions?: Record<string, string[]> },
    ) => Promise<ApiKeySummary & { key: string }>;
    delete: (organizationId: string, id: string) => Promise<void>;
  };
}
