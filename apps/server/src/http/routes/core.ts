import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import type { Auth } from '../../auth/auth';
import { highestRole } from '../../auth/roles';
import type { DbHandle } from '../../db/client';
import { member, organization } from '../../db/schema';
import type { AppEnv } from '../env';
import { HttpError } from '../errors';
import { errorResponses, jsonBody, jsonResponse, MeSchema, security, WorkspaceSummarySchema } from './schemas';

export interface CoreRouteDeps {
  auth: Auth;
  db: DbHandle;
  dbKind: 'pg' | 'pglite';
  ensureWorkspace: (workspaceId: string) => Promise<void>;
}

const HealthSchema = z.object({ ok: z.literal(true), db: z.enum(['pg', 'pglite']) }).meta({ id: 'Health' });

const listWorkspaces = async (db: DbHandle['db'], userId: string) => {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, role: highestRole(r.role) ?? r.role }));
};

/** /api/health, /api/me, /api/workspaces */
export const registerCoreRoutes = (app: OpenAPIHono<AppEnv>, deps: CoreRouteDeps) => {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/health',
      summary: 'Health check',
      tags: ['system'],
      responses: { 200: jsonResponse(HealthSchema, 'Server is up') },
    }),
    (c) => c.json({ ok: true as const, db: deps.dbKind }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me',
      summary: 'Get the current user',
      tags: ['auth'],
      security,
      responses: { 200: jsonResponse(MeSchema, 'The signed-in user and their workspaces'), 401: errorResponses[401] },
    }),
    async (c) => {
      const principal = c.get('principal');

      if (principal.kind !== 'user') {
        throw new HttpError('UNAUTHORIZED', 'A user session is required');
      }

      return c.json({ user: principal.user, workspaces: await listWorkspaces(deps.db.db, principal.userId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/workspaces',
      summary: 'List workspaces',
      tags: ['workspaces'],
      security,
      responses: {
        200: jsonResponse(z.array(WorkspaceSummarySchema), 'Workspaces the user belongs to'),
        401: errorResponses[401],
      },
    }),
    async (c) => {
      const principal = c.get('principal');

      if (principal.kind !== 'user') {
        throw new HttpError('UNAUTHORIZED', 'A user session is required');
      }

      return c.json(await listWorkspaces(deps.db.db, principal.userId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/workspaces',
      summary: 'Create a workspace',
      tags: ['workspaces'],
      security,
      request: {
        body: jsonBody(z.object({ name: z.string().min(1), slug: z.string().min(1) }).meta({ id: 'CreateWorkspace' })),
      },
      responses: {
        201: jsonResponse(WorkspaceSummarySchema, 'Created workspace (the caller is its owner)'),
        400: errorResponses[400],
        401: errorResponses[401],
        409: errorResponses[409],
      },
    }),
    async (c) => {
      const principal = c.get('principal');

      if (principal.kind !== 'user') {
        throw new HttpError('UNAUTHORIZED', 'A user session is required');
      }

      const { name, slug } = c.req.valid('json');
      const created = await deps.auth.api.createOrganization({ body: { name, slug }, headers: c.req.raw.headers });

      if (!created) {
        throw new HttpError('INTERNAL', 'Workspace creation returned nothing');
      }

      await deps.ensureWorkspace(created.id);
      const rows = await deps.db.db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.userId, principal.userId), eq(member.organizationId, created.id)));

      return c.json(
        { id: created.id, name: created.name, slug: created.slug, role: highestRole(rows[0]?.role) ?? 'owner' },
        201,
      );
    },
  );
};
