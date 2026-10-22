import type { WorkspaceRole } from '@devias/data-engine';

/** Better Auth stores roles as a string, possibly comma-separated; the highest one wins. */
export const highestRole = (raw: string | null | undefined): WorkspaceRole | null => {
  const roles = (raw ?? '').split(',').map((r) => r.trim());

  if (roles.includes('owner')) {
    return 'owner';
  }

  if (roles.includes('admin')) {
    return 'admin';
  }

  if (roles.includes('member')) {
    return 'member';
  }

  return null;
};
