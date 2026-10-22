import type { DataEngine, EngineContext, WorkspaceRole } from '@devias/data-engine';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { highestRole } from '../../auth/roles';
import type { DbHandle } from '../../db/client';
import { member } from '../../db/schema';
import type { AppEnv } from '../env';
import { HttpError } from '../errors';

export const membershipRole = async (
  db: DbHandle['db'],
  userId: string,
  organizationId: string,
): Promise<WorkspaceRole | null> => {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  return rows[0] ? highestRole(rows[0].role) : null;
};

/**
 * Resolves `:workspaceId` (an organization id) into an EngineContext: members get their role, api keys must
 * belong to the workspace. Also guarantees the workspace is initialized (seeded) before use.
 */
export const createWorkspaceMiddleware =
  (db: DbHandle, engine: DataEngine): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const workspaceId = c.req.param('workspaceId');

    if (!workspaceId) {
      throw new HttpError('NOT_FOUND', 'Workspace not found');
    }

    const principal = c.get('principal');
    let ctx: EngineContext;

    if (principal.kind === 'api_key') {
      if (principal.workspaceId !== workspaceId) {
        throw new HttpError('FORBIDDEN', 'This api key belongs to another workspace');
      }

      ctx = {
        workspaceId,
        actor: { kind: 'api_key', id: principal.keyId },
        role: null,
        apiKeyPermissions: principal.permissions,
      };
    } else {
      const role = await membershipRole(db.db, principal.userId, workspaceId);

      if (!role) {
        throw new HttpError('FORBIDDEN', 'You are not a member of this workspace');
      }

      ctx = { workspaceId, actor: { kind: 'user', id: principal.userId }, role };
    }

    await engine.workspaces.ensureInitialized(workspaceId);
    c.set('ctx', ctx);

    return next();
  };
