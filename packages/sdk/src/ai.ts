import type {
  AiAgent,
  AiAgentActivity,
  AiAgentUsage,
  AiClient,
  AiSettings,
  AiSettingsPatch,
  AiStatus,
  AiTurn,
  Conversation,
  ConversationThread,
  CreateConversationInput,
} from '@devias/core';
import type { HttpClient } from './http';
import { streamRequest } from './stream';

const enc = encodeURIComponent;

/** `client.ai` over `/api/workspaces/:workspaceId/ai/*`. */
export const createAiApi = (http: HttpClient, ws: string): AiClient => {
  const base = `${ws}/ai`;

  return {
    status: () => http.get<AiStatus>(`${base}/status`),
    conversations: {
      list: (opts) =>
        http.get<Conversation[]>(`${base}/conversations`, opts?.limit ? { limit: opts.limit } : undefined),
      create: (input?: CreateConversationInput) => http.post<Conversation>(`${base}/conversations`, input ?? {}),
      get: (id) => http.get<ConversationThread>(`${base}/conversations/${enc(id)}`),
      delete: async (id) => {
        await http.delete(`${base}/conversations/${enc(id)}`);
      },
    },
    send: (conversationId, input, onEvent, opts) =>
      streamRequest({
        http,
        path: `${base}/conversations/${enc(conversationId)}/messages`,
        body: input,
        onEvent,
        signal: opts?.signal,
      }),
    resolve: (conversationId, toolCallId, input, onEvent, opts) =>
      streamRequest({
        http,
        path: `${base}/conversations/${enc(conversationId)}/tool-calls/${enc(toolCallId)}/resolve`,
        body: input,
        onEvent,
        signal: opts?.signal,
      }),
    cancel: (conversationId) => http.post<AiTurn | null>(`${base}/conversations/${enc(conversationId)}/cancel`),
    settings: {
      get: () => http.get<AiSettings>(`${base}/settings`),
      update: (patch: AiSettingsPatch) => http.patch<AiSettings>(`${base}/settings`, patch),
    },
    agents: {
      activity: (id, query) =>
        http.get<AiAgentActivity>(`${base}/agents/${enc(id)}/activity`, { days: query?.days, tz: query?.tz }),
      usage: () => http.get<AiAgentUsage[]>(`${base}/agents/usage`),
      list: (opts) => http.get<AiAgent[]>(`${base}/agents${opts?.includeArchived ? '?includeArchived=true' : ''}`),
      create: (input) => http.post<AiAgent>(`${base}/agents`, input),
      update: (id, patch) => http.patch<AiAgent>(`${base}/agents/${enc(id)}`, patch),
      delete: async (id) => {
        await http.delete(`${base}/agents/${enc(id)}`);
      },
    },
  };
};
