import type { AuthUser, Member, MemberRole, Organization } from '@devias/core';
import { createContext, useContext } from 'react';

export interface WorkspaceContextValue {
  workspaceId: string;
  slug: string;
  organization: Organization;
  user: AuthUser;
  role: MemberRole | string;
  /** `owner` or `admin`. */
  isAdmin: boolean;
  roleStatus: 'loading' | 'ready';
  /** Everyone in the workspace (empty until loaded), e.g. to name who did something. */
  members: Member[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export const useWorkspace = (): WorkspaceContextValue => {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error('useWorkspace must be used inside a workspace route');
  }

  return value;
};

const RANK: Record<string, number> = { member: 1, admin: 2, owner: 3 };

/** Does `role` satisfy `required`? Owners satisfy everything, admins satisfy admin/member. */
export const roleSatisfies = (role: string | undefined, required: MemberRole | undefined): boolean => {
  if (!required) {
    return true;
  }

  return (RANK[role ?? ''] ?? 0) >= (RANK[required] ?? 0);
};
