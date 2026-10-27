import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ActionRegistry } from '../actions/registry';
import type { AppEnv } from './env';
import { ApiErrorSchema, errorResponses, jsonBody, jsonResponse, security, WorkspaceParam } from './routes/schemas';

const ERROR_RESPONSES = { ...errorResponses, 422: jsonResponse(ApiErrorSchema, 'Missing dependency') };
/** People only: the session cookie, not api keys. */
const SESSION_ONLY: Record<string, string[]>[] = [{ cookieAuth: [] }];

type ActionContext = Context<
  AppEnv,
  string,
  { out: { param: Record<string, string>; query: Record<string, unknown>; json: unknown } }
>;

/**
 * One REST route per action: `{workspaceId}` plus the spec's params as the path, its query and its JSON body, validated by
 * the route; the parts are merged into the action's input (path params win) and its output is the response.
 */
export const mountActions = (app: OpenAPIHono<AppEnv>, actions: ActionRegistry) => {
  for (const action of actions.all()) {
    const { spec } = action;
    const { http } = spec;
    const responses: Record<number, object> = {
      [http.status]: spec.output
        ? jsonResponse(spec.output, http.outputDescription)
        : { description: http.outputDescription },
    };

    if (action.etag) {
      responses[304] = { description: 'Not modified' };
    }

    for (const status of http.errors) {
      responses[status] = ERROR_RESPONSES[status];
    }

    const route = createRoute({
      method: http.method,
      path: http.path,
      summary: spec.summary,
      ...(spec.description ? { description: spec.description } : {}),
      tags: [...spec.tags],
      security: spec.sessionOnly ? SESSION_ONLY : security,
      request: {
        params: spec.params ? WorkspaceParam.extend(spec.params.shape) : WorkspaceParam,
        ...(spec.query ? { query: spec.query } : {}),
        ...(spec.body ? { body: jsonBody(spec.body, http.bodyDescription) } : {}),
      },
      responses,
    });

    const handler = async (c: ActionContext) => {
      const { workspaceId: _workspaceId, ...params } = c.req.valid('param');
      const body = spec.body ? c.req.valid('json') : undefined;
      const input = {
        ...(spec.body ? (spec.bodyField ? { [spec.bodyField]: body } : (body as object)) : {}),
        ...(spec.query ? c.req.valid('query') : {}),
        ...params,
      };
      const output = await actions.run(action, c.get('ctx'), input);

      if (action.etag) {
        const tag = `"${action.etag(output)}"`;

        if (c.req.header('if-none-match') === tag) {
          return c.body(null, 304);
        }

        c.header('ETag', tag);
        c.header('Cache-Control', 'private, no-cache');
      }

      return http.status === 204 ? c.body(null, 204) : c.json(output, http.status);
    };
    // The route is built from data, so its typed handler signature can't be inferred; the shapes are checked above.
    app.openapi(route, handler as never);
  }
};
