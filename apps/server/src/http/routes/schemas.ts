import { z } from '@hono/zod-openapi';

/** Shared OpenAPI building blocks for route definitions. */

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.enum([
        'VALIDATION',
        'NOT_FOUND',
        'FORBIDDEN',
        'UNAUTHORIZED',
        'CONFLICT',
        'UNIQUE_VIOLATION',
        'INVALID_CURSOR',
        'DESTRUCTIVE_CHANGE',
        'PLAN_MISMATCH',
        'MISSING_DEPENDENCY',
        'RATE_LIMITED',
        'INTERNAL',
      ]),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ApiError' });

export const WorkspaceParam = z.object({
  workspaceId: z.string().meta({ description: 'Workspace (organization) id' }),
});
export const IdParam = z.object({ id: z.string() });
export const WorkspaceIdParams = WorkspaceParam.extend({ id: z.string() });

export const jsonBody = <T extends z.ZodTypeAny>(schema: T, description = 'Request body') => ({
  content: { 'application/json': { schema } },
  description,
  required: true,
});

export const jsonResponse = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});

export const errorResponses = {
  400: jsonResponse(ApiErrorSchema, 'Validation error or invalid cursor'),
  401: jsonResponse(ApiErrorSchema, 'Not authenticated'),
  403: jsonResponse(ApiErrorSchema, 'Not allowed'),
  404: jsonResponse(ApiErrorSchema, 'Not found'),
  409: jsonResponse(ApiErrorSchema, 'Conflict'),
};

export const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { apiKeyAuth: [] }];

export const WorkspaceSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    role: z.string(),
  })
  .meta({ id: 'WorkspaceSummary' });

export const MeSchema = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable().optional() }),
    workspaces: z.array(WorkspaceSummarySchema),
  })
  .meta({ id: 'Me' });
