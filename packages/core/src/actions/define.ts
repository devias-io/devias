import { z } from 'zod';
import type { ApprovalMode } from '../ai';
import type { Permission } from '../permissions';

/**
 * An action is one thing a caller can do in a workspace, declared once as data. The server implements it and
 * mounts it as a REST route; the agent and MCP clients get it as a tool. The input is split the way HTTP carries
 * it (path params, query, body), and the same parts merged make the one object a tool takes.
 */

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

export interface ActionHttp {
  method: HttpMethod;
  /** Starts with `/api/workspaces/{workspaceId}`: the workspace comes from the caller's context, never from the input. */
  path: string;
  status: 200 | 201 | 204;
  /** The error responses the API reference lists. */
  errors: readonly ErrorStatus[];
  bodyDescription: string;
  outputDescription: string;
}

/**
 * How the agent (and MCP clients) reach an action: the tool that serves it, or why none does. A hand-written
 * tool with that name serves it (several actions may name one); otherwise a tool is generated from the spec.
 */
export type ActionAi =
  | { tool: string; description?: string }
  | { tool: null; category: NoToolCategory; reason: string };

/**
 * Why an action has no tool. Not "withheld on purpose": a restriction is a permission, never an absent tool.
 * `needs_a_person`: a person must do it themselves (a secret, a consent page); `covered_by`: another tool returns the same.
 */
export type NoToolCategory = 'needs_a_person' | 'covered_by';

export interface ActionSpecInput<P, Q, B, F, O, I extends string = string> {
  /**
   * The action's id, written out: a uuid. A core action's tool is named by the key its id is written under in
   * `coreIds.actions` (`update_record`); a module's action names its own tool.
   */
  id: I;
  /** The module that declares the action; core's have none. */
  module?: string;
  /** Short imperative title: "Delete a view". */
  summary: string;
  /** Longer explanation for the API reference and the model. */
  description?: string;
  tags: readonly string[];
  /** The least the caller needs; checked before the action runs (services may check more). */
  permission: Permission;
  /** Whether the agent asks before running it. Reads default to `auto`, everything else to `approve`. */
  approval?: ApprovalMode;
  /** When true, no agent's own approval mode can make this action `auto`. */
  locked?: boolean;
  /** Changes nothing, so it may run freely even after outside content was read. Defaults to a `.read` permission. */
  readOnly?: boolean;
  /** People only: signed-in users (or an agent acting for one), never api keys or automations. */
  sessionOnly?: boolean;
  /** The output carries content from outside the workspace (webhook payloads, emails): data, never instructions. */
  externalContent?: boolean;
  /** Path params besides `workspaceId`. */
  params?: P;
  query?: Q;
  body?: B;
  /** Carry the body under this input key instead of spreading its fields (for bodies that are not plain objects). */
  bodyField?: F;
  /** Absent means the action answers 204 with no body. */
  output?: O;
  /** The tool that serves it, or why none does. */
  ai: ActionAi;
  http: {
    method: HttpMethod;
    path: string;
    status?: 200 | 201 | 204;
    errors?: readonly ErrorStatus[];
    bodyDescription?: string;
    outputDescription?: string;
  };
}

type Out<T> = T extends z.ZodType ? z.output<T> : unknown;
type BodyOut<B, F> = B extends z.ZodType ? (F extends string ? { [K in F]: z.output<B> } : z.output<B>) : unknown;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** The parsed input an implementation receives: body fields, then query, then path params (the path wins). */
export type ActionInputOf<P, Q, B, F> = Simplify<
  (B extends z.ZodType ? Omit<BodyOut<B, F>, keyof Out<P>> : unknown) & Out<Q> & Out<P>
>;

export interface ActionSpec<I = unknown, O = unknown> {
  /** The action's id. What workflows, layouts and policies name. */
  id: string;
  summary: string;
  description?: string;
  tags: readonly string[];
  permission: Permission;
  approval: ApprovalMode;
  locked: boolean;
  readOnly: boolean;
  sessionOnly: boolean;
  externalContent: boolean;
  module: string | null;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  bodyField?: string;
  output: z.ZodType | null;
  ai: ActionAi;
  http: ActionHttp;
  /** Every input field in one object, for tools: body fields, query, then path params. */
  input: z.ZodObject;
  /** Split a merged input into its parts and validate each with its own schema (refinements included). */
  parse(raw: unknown): I;
  /** Type carrier only; never set. */
  readonly types?: { input: I; output: O };
}

export type AnyActionSpec = ActionSpec<unknown, unknown>;
export type InputOf<S> = S extends ActionSpec<infer I, unknown> ? I : never;
export type OutputOf<S> = S extends ActionSpec<unknown, infer O> ? O : never;

const WORKSPACE_PREFIX = '/api/workspaces/{workspaceId}';

const defaultErrors = (method: HttpMethod, hasParams: boolean): ErrorStatus[] =>
  method === 'get' || method === 'delete' ? (hasParams ? [401, 403, 404] : [401, 403]) : [400, 401, 403, 404, 409];

const pick = (source: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));

const omit = (source: Record<string, unknown>, keys: Set<string>) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !keys.has(key)));

export const defineActionSpec = <
  P extends z.ZodObject | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  F extends string | undefined = undefined,
  O extends z.ZodType | undefined = undefined,
  I extends string = string,
>(
  definition: ActionSpecInput<P, Q, B, F, O, I>,
): ActionSpec<ActionInputOf<P, Q, B, F>, O extends z.ZodType ? z.output<O> : void> => {
  const { id, params, query, body, bodyField, output, http } = definition;

  if (!http.path.startsWith(WORKSPACE_PREFIX)) {
    throw new Error(`Action "${id}" must live under ${WORKSPACE_PREFIX}`);
  }

  const pathKeys = [...http.path.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((key) => key !== 'workspaceId');
  const paramKeys = params ? Object.keys(params.shape) : [];

  if (pathKeys.join() !== paramKeys.join()) {
    throw new Error(`Action "${id}": params (${paramKeys.join(', ')}) must match the path (${pathKeys.join(', ')})`);
  }

  if (body && !bodyField && !(body instanceof z.ZodObject)) {
    throw new Error(`Action "${id}": a body that is not an object needs a bodyField`);
  }

  const queryKeys = query ? Object.keys(query.shape) : [];
  const status = http.status ?? (output ? 200 : 204);
  const bodyShape = body ? (bodyField ? { [bodyField]: body } : (body as z.ZodObject).shape) : {};

  return {
    id,
    summary: definition.summary,
    ...(definition.description ? { description: definition.description } : {}),
    tags: definition.tags,
    permission: definition.permission,
    approval: definition.approval ?? (http.method === 'get' ? 'auto' : 'approve'),
    locked: definition.locked ?? false,
    readOnly: definition.readOnly ?? definition.permission.endsWith('.read'),
    sessionOnly: definition.sessionOnly ?? false,
    externalContent: definition.externalContent ?? false,
    module: definition.module ?? null,
    ...(params ? { params } : {}),
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
    ...(bodyField ? { bodyField } : {}),
    output: output ?? null,
    ai: definition.ai,
    http: {
      method: http.method,
      path: http.path,
      status,
      errors: http.errors ?? defaultErrors(http.method, paramKeys.length > 0),
      bodyDescription: http.bodyDescription ?? 'Request body',
      outputDescription: http.outputDescription ?? (status === 204 ? 'Done' : 'The result'),
    },
    input: z.object({ ...bodyShape, ...query?.shape, ...params?.shape }),
    parse: (raw) => {
      const source = z.record(z.string(), z.unknown()).parse(raw ?? {});
      const parsedParams = params ? params.parse(pick(source, paramKeys)) : {};
      const parsedQuery = query ? query.parse(pick(source, queryKeys)) : {};
      let parsedBody: Record<string, unknown> = {};

      if (body && bodyField) {
        parsedBody = { [bodyField]: body.parse(source[bodyField]) };
      } else if (body) {
        parsedBody = body.parse(omit(source, new Set([...paramKeys, ...queryKeys]))) as Record<string, unknown>;
      }

      return { ...parsedBody, ...parsedQuery, ...parsedParams } as never;
    },
  };
};
