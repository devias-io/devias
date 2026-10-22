import type { AuthAdapter, AuthSession, Organization } from '@devias/core';

/**
 * `beforeLoad` runs on every navigation; caching the session and slug lookups for a short while keeps
 * in-workspace navigation free of auth round-trips. Cleared on sign-in/out and workspace changes.
 */
const TTL_MS = 30_000;

let session: { value: AuthSession | null; at: number } | null = null;
const organizations = new Map<string, { value: Organization | null; at: number }>();

const fresh = (at: number) => Date.now() - at < TTL_MS;

export const getSessionCached = async (auth: AuthAdapter): Promise<AuthSession | null> => {
  if (session && fresh(session.at)) {
    return session.value;
  }

  const value = await auth.getSession();
  session = { value, at: Date.now() };

  return value;
};

export const getOrganizationBySlugCached = async (auth: AuthAdapter, slug: string): Promise<Organization | null> => {
  const hit = organizations.get(slug);

  if (hit && fresh(hit.at)) {
    return hit.value;
  }

  const value = await auth.organizations.getBySlug(slug);
  organizations.set(slug, { value, at: Date.now() });

  return value;
};

export const rememberActiveOrganization = (organizationId: string | null): void => {
  if (session?.value) {
    session = { value: { ...session.value, activeOrganizationId: organizationId }, at: session.at };
  }
};

export const clearAuthCache = (): void => {
  session = null;
  organizations.clear();
};
