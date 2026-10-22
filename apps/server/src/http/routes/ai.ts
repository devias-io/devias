import type { AiService, TurnHandle } from '@devias/ai';
import {
  AiStatusSchema,
  AiTurnSchema,
  type ChatEvent,
  ConversationSchema,
  ConversationThreadSchema,
  CreateConversationInputSchema,
  ResolveToolCallInputSchema,
  SendMessageInputSchema,
} from '@devias/core';
import { fromZodError, type Logger } from '@devias/data-engine';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv, Principal } from '../env';
import { HttpError } from '../errors';
import { errorResponses, jsonBody, jsonResponse, WorkspaceIdParams, WorkspaceParam } from './schemas';

const HEARTBEAT_MS = 15_000;
const security = [{ cookieAuth: [] }];

const userOf = (principal: Principal): { id: string; name: string } => {
  if (principal.kind !== 'user') {
    throw new HttpError('FORBIDDEN', 'Agents are available to signed-in users only');
  }

  return { id: principal.userId, name: principal.user.name };
};

const parseBody = async <T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> => {
  const raw = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw);

  if (!result.success) {
    throw fromZodError(result.error, 'Invalid body');
  }

  return result.data;
};

const sseResponse = (c: Context<AppEnv>, handle: TurnHandle, logger: Logger, describe: string): Response =>
  streamSSE(
    c,
    async (stream) => {
      let closed = false;
      let chain: Promise<void> = Promise.resolve();
      const sink = {
        emit: (event: ChatEvent) => {
          if (closed) {
            return;
          }

          chain = chain
            .then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }))
            .catch(() => {
              closed = true;
            });
        },
      };
      const heartbeat = setInterval(() => {
        if (!closed) {
          stream.write(': ping\n\n').catch(() => {});
        }
      }, HEARTBEAT_MS);
      // A dropped connection only detaches the listener; the turn keeps running server-side.
      stream.onAbort(() => {
        closed = true;
      });

      try {
        await handle.run(sink);
        await chain;
      } finally {
        clearInterval(heartbeat);
      }
    },
    async (error) => {
      logger.warn(`agent stream error (${describe})`, error);
    },
  );

const sseDoc = (summary: string) => ({
  200: {
    description: `${summary} text/event-stream of ChatEvent frames: \`event: <type>\`, \`data: <ChatEvent JSON>\`; heartbeats are comment lines. The stream ends with \`paused\` (approval needed) or \`done\`.`,
  },
  ...errorResponses,
  422: jsonResponse(errorResponses[400].content['application/json'].schema, 'AI is not configured'),
});

/** `/api/workspaces/{workspaceId}/ai/*`: status, conversations, streamed turns, approvals and cancel. Settings are actions. */
export const registerAiRoutes = (app: OpenAPIHono<AppEnv>, deps: { ai: AiService; logger: Logger }) => {
  const { ai, logger } = deps;
  const ConversationParams = WorkspaceParam.extend({ id: z.string() });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/status',
      summary: 'Get AI status',
      tags: ['ai'],
      security,
      request: { params: WorkspaceParam },
      responses: {
        200: jsonResponse(AiStatusSchema, 'Whether the agent is configured, its model and the tools this user can use'),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    }),
    async (c) => {
      userOf(c.get('principal'));

      return c.json(await ai.status(c.get('ctx')), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/conversations',
      summary: 'List conversations',
      tags: ['ai'],
      security,
      request: {
        params: WorkspaceParam,
        query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
      },
      responses: {
        200: jsonResponse(z.array(ConversationSchema), "This user's conversations, most recent first"),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    }),
    async (c) => {
      userOf(c.get('principal'));
      const { limit } = c.req.valid('query');

      return c.json(await ai.conversations.list(c.get('ctx'), limit !== undefined ? { limit } : {}), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/workspaces/{workspaceId}/ai/conversations',
      summary: 'Create a conversation',
      tags: ['ai'],
      security,
      request: { params: WorkspaceParam, body: jsonBody(CreateConversationInputSchema) },
      responses: { 201: jsonResponse(ConversationSchema, 'The new conversation'), ...errorResponses },
    }),
    async (c) => {
      userOf(c.get('principal'));

      return c.json(await ai.conversations.create(c.get('ctx'), c.req.valid('json')), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/workspaces/{workspaceId}/ai/conversations/{id}',
      summary: 'Get a conversation',
      tags: ['ai'],
      security,
      request: { params: WorkspaceIdParams },
      responses: {
        200: jsonResponse(ConversationThreadSchema, 'The conversation with its messages and the active turn'),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    }),
    async (c) => {
      userOf(c.get('principal'));

      return c.json(await ai.conversations.get(c.get('ctx'), c.req.valid('param').id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/ai/conversations/{id}',
      summary: 'Delete a conversation',
      tags: ['ai'],
      security,
      request: { params: WorkspaceIdParams },
      responses: {
        204: { description: 'Deleted' },
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        409: errorResponses[409],
      },
    }),
    async (c) => {
      userOf(c.get('principal'));
      await ai.conversations.delete(c.get('ctx'), c.req.valid('param').id);

      return c.body(null, 204);
    },
  );

  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/api/workspaces/{workspaceId}/ai/conversations/{id}/messages',
    summary: 'Send a message',
    tags: ['ai'],
    security,
    request: { params: ConversationParams, body: jsonBody(SendMessageInputSchema) },
    responses: sseDoc('Send a message and stream the turn.'),
  });
  app.post('/api/workspaces/:workspaceId/ai/conversations/:id/messages', async (c) => {
    const user = userOf(c.get('principal'));
    const input = await parseBody(c, SendMessageInputSchema);
    const handle = await ai.startTurn(c.get('ctx'), c.req.param('id'), input, user);

    return sseResponse(c, handle, logger, 'send');
  });

  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/api/workspaces/{workspaceId}/ai/conversations/{id}/tool-calls/{toolCallId}/resolve',
    summary: 'Resolve a tool call',
    tags: ['ai'],
    security,
    request: {
      params: ConversationParams.extend({ toolCallId: z.string() }),
      body: jsonBody(ResolveToolCallInputSchema),
    },
    responses: sseDoc('Approve or reject a pending tool call and stream the rest of the turn.'),
  });
  app.post('/api/workspaces/:workspaceId/ai/conversations/:id/tool-calls/:toolCallId/resolve', async (c) => {
    const user = userOf(c.get('principal'));
    const input = await parseBody(c, ResolveToolCallInputSchema);
    const handle = await ai.startResolve(c.get('ctx'), c.req.param('id'), c.req.param('toolCallId'), input, user);

    return sseResponse(c, handle, logger, 'resolve');
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/workspaces/{workspaceId}/ai/conversations/{id}/cancel',
      summary: 'Cancel the active turn',
      tags: ['ai'],
      security,
      request: { params: WorkspaceIdParams },
      responses: {
        200: jsonResponse(AiTurnSchema.nullable(), 'The cancelled turn, or null when nothing was running'),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    }),
    async (c) => {
      userOf(c.get('principal'));

      return c.json(await ai.cancel(c.get('ctx'), c.req.valid('param').id), 200);
    },
  );
};
