import { EngineError } from '@devias/data-engine';
import type { Auth } from './auth';
import { highestRole } from './roles';

/**
 * Workspace people and keys, read and written for actions. Better Auth's list and delete endpoints need a
 * session, and an action can run without one (an agent turn), so this goes through Better Auth's adapter on
 * the same tables; callers check permissions with the engine policy first. Creating a key uses the server-side
 * endpoint, which takes the acting user and still checks their role.
 */

export interface ApiKeySummary {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
  permissions: Record<string, string[]> | null;
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  lastRequest: Date | string | null;
  permissions?: Record<string, string[]> | string | null;
}

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;

/** Stored as JSON text; the endpoints parse it, the adapter does not. */
const permissionsOf = (value: ApiKeyRow['permissions']): Record<string, string[]> | null => {
  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as Record<string, string[]>;
  } catch {
    return null;
  }
};

const summarize = (key: ApiKeyRow): ApiKeySummary => ({
  id: key.id,
  name: key.name,
  start: key.start,
  prefix: key.prefix,
  createdAt: iso(key.createdAt) ?? new Date(0).toISOString(),
  expiresAt: iso(key.expiresAt),
  lastRequest: iso(key.lastRequest),
  permissions: permissionsOf(key.permissions),
});

export type Role = 'owner' | 'admin' | 'member';

/** Who is acting: their user id and their role in the workspace. */
export interface Acting {
  userId: string;
  role: Role | null;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  expiresAt: string;
  createdAt: string;
  inviterId: string;
}

interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date | string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: WorkspaceInvitation['status'];
  expiresAt: Date | string;
  createdAt: Date | string;
  inviterId: string;
}

/** Better Auth's default `invitationExpiresIn`. */
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Roles are stored comma-separated; the creator role is `owner`. */
const isOwner = (role: string | null | undefined) => highestRole(role) === 'owner';

const invitationOf = (row: InvitationRow): WorkspaceInvitation => ({
  id: row.id,
  email: row.email,
  role: row.role ?? 'member',
  status: row.status,
  expiresAt: iso(row.expiresAt) ?? new Date(0).toISOString(),
  createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  inviterId: row.inviterId,
});

export interface DirectoryOptions {
  /**
   * After an invitation made through the directory (an action, not Better Auth's endpoint, which has its own
   * hook): so both ways of inviting tell the others the same way.
   */
  onInvitationCreated?: (invite: {
    workspaceId: string;
    invitationId: string;
    email: string;
    role: string;
    inviterId: string;
    inviterName: string;
  }) => Promise<void>;
}

export const createDirectory = (auth: Auth, options: DirectoryOptions = {}) => {
  const adapter = async () => (await auth.$context).adapter;
  const inWorkspace = (workspaceId: string) => ({ field: 'referenceId', value: workspaceId });

  const userOf = async (userId: string): Promise<UserRow> => {
    const user = await (await adapter()).findOne<UserRow>({ model: 'user', where: [{ field: 'id', value: userId }] });

    if (!user) {
      throw new EngineError('NOT_FOUND', `No user "${userId}"`);
    }

    return user;
  };
  const memberOf = (row: MemberRow, user: UserRow): WorkspaceMember => ({
    id: row.id,
    userId: row.userId,
    role: row.role,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
  });
  const memberIn = async (workspaceId: string, memberId: string): Promise<MemberRow> => {
    const member = await (await adapter()).findOne<MemberRow>({
      model: 'member',
      where: [
        { field: 'id', value: memberId },
        { field: 'organizationId', value: workspaceId },
      ],
    });

    if (!member) {
      throw new EngineError('NOT_FOUND', `No member "${memberId}" in this workspace`);
    }

    return member;
  };
  /** Refuses when the workspace would be left without an owner. */
  const keepAnOwner = async (workspaceId: string) => {
    const members = await (await adapter()).findMany<MemberRow>({
      model: 'member',
      where: [{ field: 'organizationId', value: workspaceId }],
    });

    if (members.filter((member) => isOwner(member.role)).length <= 1) {
      throw new EngineError('CONFLICT', 'A workspace needs at least one owner');
    }
  };

  return {
    apiKeys: {
      list: async (workspaceId: string): Promise<ApiKeySummary[]> => {
        const rows = await (await adapter()).findMany<ApiKeyRow>({
          model: 'apikey',
          where: [inWorkspace(workspaceId)],
          sortBy: { field: 'createdAt', direction: 'asc' },
        });

        return rows.map(summarize);
      },
      create: async (
        workspaceId: string,
        userId: string,
        input: { name: string; expiresInDays?: number | undefined; permissions?: Record<string, string[]> | undefined },
      ): Promise<ApiKeySummary & { key: string }> => {
        // `permissions` and `userId` are server-only properties in Better Auth, and the membership and role check
        // still runs against the given user for organization-owned keys.
        const created = await auth.api.createApiKey({
          body: {
            name: input.name,
            organizationId: workspaceId,
            userId,
            expiresIn: input.expiresInDays ? input.expiresInDays * 24 * 60 * 60 : null,
            permissions: input.permissions,
            metadata: { workspaceId },
          },
        });

        return { ...summarize(created), key: created.key };
      },
      delete: async (workspaceId: string, id: string): Promise<void> => {
        const removed = await (await adapter()).consumeOne({
          model: 'apikey',
          where: [{ field: 'id', value: id }, inWorkspace(workspaceId)],
        });

        if (!removed) {
          throw new EngineError('NOT_FOUND', `No API key "${id}" in this workspace`);
        }
      },
    },

    members: {
      list: async (workspaceId: string): Promise<WorkspaceMember[]> => {
        const db = await adapter();
        const rows = await db.findMany<MemberRow>({
          model: 'member',
          where: [{ field: 'organizationId', value: workspaceId }],
          sortBy: { field: 'createdAt', direction: 'asc' },
        });

        if (rows.length === 0) {
          return [];
        }

        const users = await db.findMany<UserRow>({
          model: 'user',
          where: [{ field: 'id', operator: 'in', value: rows.map((row) => row.userId) }],
        });
        const byId = new Map(users.map((user) => [user.id, user]));

        return rows.flatMap((row) => {
          const user = byId.get(row.userId);

          return user ? [memberOf(row, user)] : [];
        });
      },
      updateRole: async (workspaceId: string, acting: Acting, memberId: string, role: Role) => {
        const db = await adapter();
        const target = await memberIn(workspaceId, memberId);

        if ((isOwner(target.role) || role === 'owner') && !isOwner(acting.role)) {
          throw new EngineError('FORBIDDEN', 'Only owners grant, change or remove the owner role');
        }

        if (isOwner(target.role) && role !== 'owner') {
          await keepAnOwner(workspaceId);
        }

        const updated = await db.update<MemberRow>({
          model: 'member',
          where: [
            { field: 'id', value: memberId },
            { field: 'organizationId', value: workspaceId },
          ],
          update: { role },
        });

        if (!updated) {
          throw new EngineError('NOT_FOUND', `No member "${memberId}" in this workspace`);
        }

        return memberOf(updated, await userOf(updated.userId));
      },
      remove: async (workspaceId: string, acting: Acting, memberId: string): Promise<void> => {
        const target = await memberIn(workspaceId, memberId);

        if (isOwner(target.role)) {
          if (!isOwner(acting.role)) {
            throw new EngineError('FORBIDDEN', 'Only owners remove an owner');
          }

          await keepAnOwner(workspaceId);
        }

        await (await adapter()).delete({
          model: 'member',
          where: [
            { field: 'id', value: memberId },
            { field: 'organizationId', value: workspaceId },
          ],
        });
      },
    },
    invitations: {
      list: async (workspaceId: string): Promise<WorkspaceInvitation[]> => {
        const rows = await (await adapter()).findMany<InvitationRow>({
          model: 'invitation',
          where: [
            { field: 'organizationId', value: workspaceId },
            { field: 'status', value: 'pending' },
          ],
          sortBy: { field: 'createdAt', direction: 'asc' },
        });
        const now = Date.now();

        return rows.map(invitationOf).filter((invitation) => Date.parse(invitation.expiresAt) > now);
      },
      create: async (
        workspaceId: string,
        acting: Acting,
        input: { email: string; role: Role },
      ): Promise<WorkspaceInvitation> => {
        if (input.role === 'owner' && !isOwner(acting.role)) {
          throw new EngineError('FORBIDDEN', 'Only owners invite owners');
        }

        const db = await adapter();
        const email = input.email.trim().toLowerCase();
        const user = await db.findOne<UserRow>({ model: 'user', where: [{ field: 'email', value: email }] });

        if (user) {
          const existing = await db.findOne<MemberRow>({
            model: 'member',
            where: [
              { field: 'organizationId', value: workspaceId },
              { field: 'userId', value: user.id },
            ],
          });

          if (existing) {
            throw new EngineError('CONFLICT', `${email} is already a member`);
          }
        }

        const pending = await db.findMany<InvitationRow>({
          model: 'invitation',
          where: [
            { field: 'organizationId', value: workspaceId },
            { field: 'email', value: email },
            { field: 'status', value: 'pending' },
          ],
        });

        if (pending.some((row) => new Date(row.expiresAt).getTime() > Date.now())) {
          throw new EngineError('CONFLICT', `${email} already has a pending invitation`);
        }

        const now = new Date();
        const created = await db.create<Omit<InvitationRow, 'id'>, InvitationRow>({
          model: 'invitation',
          data: {
            organizationId: workspaceId,
            email,
            role: input.role,
            status: 'pending',
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
            createdAt: now,
            inviterId: acting.userId,
          },
        });

        try {
          const inviter = await db.findOne<UserRow>({ model: 'user', where: [{ field: 'id', value: acting.userId }] });
          await options.onInvitationCreated?.({
            workspaceId,
            invitationId: created.id,
            email,
            role: input.role,
            inviterId: acting.userId,
            inviterName: inviter?.name || inviter?.email || 'Someone',
          });
        } catch {
          // Telling the others must not fail the invitation.
        }

        return invitationOf(created);
      },
      cancel: async (workspaceId: string, invitationId: string): Promise<void> => {
        const updated = await (await adapter()).update<InvitationRow>({
          model: 'invitation',
          where: [
            { field: 'id', value: invitationId },
            { field: 'organizationId', value: workspaceId },
            { field: 'status', value: 'pending' },
          ],
          update: { status: 'canceled' },
        });

        if (!updated) {
          throw new EngineError('NOT_FOUND', `No pending invitation "${invitationId}" in this workspace`);
        }
      },
    },
  };
};

export type Directory = ReturnType<typeof createDirectory>;
