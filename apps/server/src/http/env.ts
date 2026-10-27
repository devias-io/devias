import type { EngineContext } from '@devias/data-engine';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Who is calling, as established by the actor middleware (before any workspace is known). */
export type Principal =
  | { kind: 'user'; userId: string; user: SessionUser; activeOrganizationId: string | null }
  | { kind: 'api_key'; keyId: string; workspaceId: string; permissions: Record<string, string[]> };

export type AppEnv = {
  Variables: {
    principal: Principal;
    ctx: EngineContext;
  };
};
