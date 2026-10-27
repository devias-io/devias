import { apiKey } from '@better-auth/api-key';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Better Auth: email + password (and Google, when its client is set), organizations as workspaces, organization-owned api keys.
 * The engine is wired in through hooks so a new organization is seeded and a deleted one purged.
 */

export interface AuthConfig {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  /** Sign-in with Google; the sign-in page offers it, and an account is made on a first sign-in. */
  google?: { clientId: string; clientSecret: string };
}

export interface AuthDeps {
  // biome-ignore lint/suspicious/noExplicitAny: driver-independent drizzle handle
  db: PgDatabase<PgQueryResultHKT, any, any>;
  /** The Better Auth drizzle schema (user, session, ...). */
  schema: Record<string, unknown>;
  config: AuthConfig;
  onWorkspaceCreated?: (organizationId: string) => Promise<void>;
  /** After an organization's name or slug changed, with what it was and what it is, and who did it. */
  onWorkspaceUpdated?: (change: {
    workspaceId: string;
    userId: string;
    userName: string;
    role: string | null;
    name?: { from: string; to: string };
    slug?: { from: string; to: string };
  }) => Promise<void>;
  onWorkspaceDeleted?: (organizationId: string) => Promise<void>;
  /** Told when a notification hook failed; the change it followed is never undone for it. */
  onHookError?: (hook: string, error: unknown) => void;
  /** After someone was invited; `inviterName` is the person who sent it. */
  onInvitationSent?: (invite: {
    workspaceId: string;
    invitationId: string;
    email: string;
    role: string | null;
    inviterId: string;
    inviterName: string;
  }) => Promise<void>;
  /** After an invitation was accepted, with the new member and who invited them. */
  onInvitationAccepted?: (joined: {
    workspaceId: string;
    invitationId: string;
    userId: string;
    userName: string;
    role: string | null;
    inviterId: string | null;
  }) => Promise<void>;
}

const API_KEY_ACTIONS = ['create', 'read', 'update', 'delete'] as const;

/** Default organization roles plus an `api_key` resource so admins (not only owners) manage keys. */
const ac = createAccessControl({ ...defaultStatements, apiKey: [...API_KEY_ACTIONS] });
export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, apiKey: [...API_KEY_ACTIONS] }),
  admin: ac.newRole({ ...adminAc.statements, apiKey: [...API_KEY_ACTIONS] }),
  member: ac.newRole({ ...memberAc.statements }),
};

export const createAuth = ({
  db,
  schema,
  config,
  onWorkspaceCreated,
  onWorkspaceDeleted,
  onWorkspaceUpdated,
  onInvitationSent,
  onInvitationAccepted,
  onHookError,
}: AuthDeps) => {
  const memberTable = schema.member as { userId: unknown; organizationId: unknown } | undefined;
  const organizationTable = schema.organization as { id: unknown } | undefined;
  /** What an organization was called before an update, kept from the "before" hook to the "after" one. */
  const previous = new Map<string, { name: string; slug: string }>();

  return betterAuth({
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    ...(config.google ? { socialProviders: { google: config.google } } : {}),
    user: {
      // People can change the email they sign in with (Settings → Profile). Sign-up does not verify emails and the
      // server sends none, so the change applies at once; with a mail sender, add `sendChangeEmailConfirmation`
      // and take `updateEmailWithoutVerification` out.
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (!memberTable) {
              return;
            }

            const table = schema.member as never;
            const rows = (await db
              .select()
              .from(table)
              .where(eq(memberTable.userId as never, session.userId))
              .limit(1)) as { organizationId: string }[];

            return { data: { ...session, activeOrganizationId: rows[0]?.organizationId ?? null } };
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            await onWorkspaceCreated?.(org.id);
          },
          afterDeleteOrganization: async ({ organization: org }) => {
            await onWorkspaceDeleted?.(org.id);
          },
          beforeUpdateOrganization: async ({ member }) => {
            if (!onWorkspaceUpdated || !organizationTable) {
              return;
            }

            const rows = (await db
              .select()
              .from(organizationTable as never)
              .where(eq(organizationTable.id as never, member.organizationId))
              .limit(1)) as { name: string; slug: string }[];
            const row = rows[0];

            if (row) {
              previous.set(member.organizationId, { name: row.name, slug: row.slug });
            }
          },
          afterUpdateOrganization: async ({ organization: org, user, member }) => {
            const before = previous.get(member.organizationId);
            previous.delete(member.organizationId);

            if (!onWorkspaceUpdated || !before || !org) {
              return;
            }

            const name = org.name !== before.name ? { from: before.name, to: org.name } : undefined;
            const slug = org.slug !== before.slug ? { from: before.slug, to: org.slug } : undefined;

            if (!name && !slug) {
              return;
            }

            try {
              await onWorkspaceUpdated({
                workspaceId: member.organizationId,
                userId: user.id,
                userName: user.name || user.email,
                role: typeof member.role === 'string' ? member.role : null,
                ...(name ? { name } : {}),
                ...(slug ? { slug } : {}),
              });
            } catch (error) {
              // A notification that could not be sent must not undo or fail the rename.
              onHookError?.('workspace updated', error);
            }
          },
          afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
            if (!onInvitationSent) {
              return;
            }

            try {
              await onInvitationSent({
                workspaceId: org.id,
                invitationId: invitation.id,
                email: invitation.email,
                role: typeof invitation.role === 'string' ? invitation.role : null,
                inviterId: inviter.id,
                inviterName: inviter.name || inviter.email,
              });
            } catch (error) {
              // Telling the others must not fail the invitation.
              onHookError?.('invitation sent', error);
            }
          },
          afterAcceptInvitation: async ({ invitation, member, user, organization: org }) => {
            if (!onInvitationAccepted) {
              return;
            }

            try {
              await onInvitationAccepted({
                workspaceId: org.id,
                invitationId: invitation.id,
                userId: user.id,
                userName: user.name || user.email,
                role: typeof member.role === 'string' ? member.role : null,
                inviterId: typeof invitation.inviterId === 'string' ? invitation.inviterId : null,
              });
            } catch (error) {
              // Telling the others must not fail joining.
              onHookError?.('invitation accepted', error);
            }
          },
        },
      }),
      apiKey({
        references: 'organization',
        enableMetadata: true,
        defaultPrefix: 'devias_',
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
        permissions: { defaultPermissions: { record: ['read'] } },
      }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
