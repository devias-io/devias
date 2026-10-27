import type { NotificationInput } from '@devias/core';
import type { Directory } from '../auth/directory';
import { highestRole } from '../auth/roles';
import type { Notifier } from './notifier';

/** What changed about a workspace's name or URL, with the person who changed it. */
export interface WorkspaceChange {
  workspaceId: string;
  userId: string;
  userName: string;
  /** The changer's membership role, as Better Auth stores it. */
  role: string | null;
  name?: { from: string; to: string };
  slug?: { from: string; to: string };
}

const quote = (value: string): string => `“${value}”`;

/** The notification for a change: the title says what, the body who and from what to what. */
export const workspaceChangeNotification = (change: WorkspaceChange): Omit<NotificationInput, 'to'> => {
  const lines: string[] = [];

  if (change.name) {
    lines.push(`${change.userName} renamed the workspace from ${quote(change.name.from)} to ${quote(change.name.to)}.`);
  }

  if (change.slug) {
    lines.push(
      `${change.userName} changed the workspace URL from \`/workspaces/${change.slug.from}\` to \`/workspaces/${change.slug.to}\`. Bookmarks to the old address redirect no more.`,
    );
  }

  const both = change.name && change.slug;

  return {
    title: both ? 'Workspace name and URL changed' : change.name ? 'Workspace renamed' : 'Workspace URL changed',
    body: lines.join('\n\n'),
    // A new URL breaks bookmarks, so it asks for a little more attention than a rename.
    level: change.slug ? 'warning' : 'info',
    kind: 'workspace.updated',
    key: 'workspace.updated',
    target: { kind: 'settings', section: 'general' },
    data: { name: change.name ?? null, slug: change.slug ?? null },
  };
};

/**
 * Tells every member when a workspace is renamed or moved, the person who did it included: it is how a solo
 * workspace sees the change land, and it leaves a trace. A repeated change replaces the unread notification rather
 * than stacking up.
 */
export const createWorkspaceUpdateNotifier =
  ({ notifier, directory }: { notifier: Notifier; directory: Directory }) =>
  async (change: WorkspaceChange): Promise<number> => {
    if (!change.name && !change.slug) {
      return 0;
    }

    const members = await directory.members.list(change.workspaceId);
    const users = members.map((member) => member.userId);

    if (users.length === 0) {
      return 0;
    }

    const result = await notifier.send(
      {
        workspaceId: change.workspaceId,
        actor: { kind: 'user', id: change.userId },
        role: highestRole(change.role),
      },
      { ...workspaceChangeNotification(change), to: { users } },
    );

    return result.recipients;
  };

// ---------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------

/** An invitation that was just sent. `role` is how Better Auth stores it (one or more, comma separated). */
export interface InvitationSent {
  workspaceId: string;
  invitationId: string;
  email: string;
  role: string | null;
  inviterId: string;
  inviterName: string;
}

/** A person who accepted an invitation and is now a member. */
export interface InvitationAccepted {
  workspaceId: string;
  invitationId: string;
  userId: string;
  userName: string;
  role: string | null;
  inviterId: string | null;
}

const roleLabel = (role: string | null): string => highestRole(role) ?? 'member';

export const invitationSentNotification = (invite: InvitationSent): Omit<NotificationInput, 'to'> => ({
  title: 'Invitation sent',
  body: `${invite.inviterName} invited **${invite.email}** to the workspace as ${roleLabel(invite.role)}.`,
  level: 'info',
  kind: 'workspace.invited',
  key: `workspace.invited:${invite.invitationId}`,
  target: { kind: 'settings', section: 'members' },
  data: { invitationId: invite.invitationId, email: invite.email, role: roleLabel(invite.role) },
});

export const invitationAcceptedNotification = (joined: InvitationAccepted): Omit<NotificationInput, 'to'> => ({
  title: `${joined.userName} joined the workspace`,
  body: `${joined.userName} accepted the invitation and is now ${roleLabel(joined.role) === 'admin' ? 'an' : 'a'} ${roleLabel(joined.role)}.`,
  level: 'success',
  kind: 'workspace.joined',
  key: `workspace.joined:${joined.userId}`,
  target: { kind: 'settings', section: 'members' },
  data: { invitationId: joined.invitationId, userId: joined.userId, role: roleLabel(joined.role) },
});

/** The owners and admins of a workspace: who hears about people coming and going. */
const stewards = async (directory: Directory, workspaceId: string): Promise<Set<string>> => {
  const members = await directory.members.list(workspaceId);
  const ids = new Set<string>();

  for (const member of members) {
    const role = highestRole(member.role);

    if (role === 'owner' || role === 'admin') {
      ids.add(member.userId);
    }
  }

  return ids;
};

/** Tells the owners and admins, the person who invited included, that someone was invited. */
export const createInvitationSentNotifier =
  ({ notifier, directory }: { notifier: Notifier; directory: Directory }) =>
  async (invite: InvitationSent): Promise<number> => {
    const members = await directory.members.list(invite.workspaceId);
    const inviter = members.find((member) => member.userId === invite.inviterId);
    const users = new Set(await stewards(directory, invite.workspaceId));
    users.add(invite.inviterId);
    const result = await notifier.send(
      {
        workspaceId: invite.workspaceId,
        actor: { kind: 'user', id: invite.inviterId },
        role: highestRole(inviter?.role),
      },
      { ...invitationSentNotification(invite), to: { users: [...users] } },
    );

    return result.recipients;
  };

/**
 * Tells whoever invited the person, and the owners and admins, that they joined. The newcomer cannot send
 * notifications themselves (a member has no such right), so it goes out from the system.
 */
export const createInvitationAcceptedNotifier =
  ({ notifier, directory }: { notifier: Notifier; directory: Directory }) =>
  async (joined: InvitationAccepted): Promise<number> => {
    const ids = await stewards(directory, joined.workspaceId);

    if (joined.inviterId) {
      const members = await directory.members.list(joined.workspaceId);

      if (members.some((member) => member.userId === joined.inviterId)) {
        ids.add(joined.inviterId);
      }
    }

    const users = [...ids].filter((id) => id !== joined.userId);

    if (users.length === 0) {
      return 0;
    }

    const result = await notifier.send(
      { workspaceId: joined.workspaceId, actor: { kind: 'system', id: 'invitations' }, role: null },
      { ...invitationAcceptedNotification(joined), to: { users } },
    );

    return result.recipients;
  };
