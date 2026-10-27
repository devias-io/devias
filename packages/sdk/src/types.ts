import type { AuthUser, MemberRole } from '@devias/core';
import type { FetchLike } from './http';

/** Public option and response types of the HTTP client. */

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole | string;
}

export interface MeResponse {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

export interface WorkspaceApiOptions {
  /** e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** Sent as `x-api-key`; omit to authenticate with the session cookie. */
  apiKey?: string;
  fetch?: FetchLike;
  /** Defaults to `'include'` so the Better Auth session cookie travels cross-origin. */
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
}

export interface ClientOptions extends WorkspaceApiOptions {
  workspaceId: string;
}

/** Workspace-independent calls: who am I, which workspaces can I open, create one. */
export interface WorkspaceApi {
  me(): Promise<MeResponse>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary>;
}
