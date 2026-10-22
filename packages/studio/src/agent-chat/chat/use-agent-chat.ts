import {
  type AiAgent,
  type AiStreamHandle,
  type ChatContext,
  type ChatEvent,
  type DeviasApiError,
  type DeviasClient,
  newId,
  type ToolCall,
} from '@devias/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { defaultAgentOf, useAgents, useAiSettings, useAllAgents } from '../../hooks/use-agents';
import { useNavigateTo } from '../../hooks/use-navigate-to';
import { useClient } from '../../providers/client';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { useNavigation } from '../../router/navigation';
import { navigateFor, newThread, pendingCalls, registerNavigator, threadFrom, useAgentChatStore } from './store';

/** What the studio is looking at, sent with each message so the agent can say "this record". */
export const pageContextFrom = (
  pathname: string,
  params: Record<string, string>,
  search: Record<string, unknown>,
): ChatContext => {
  const segments = pathname.split('/').filter(Boolean);
  const path = segments[0] === 'workspaces' ? segments.slice(2).join('/') : '';
  const page: NonNullable<ChatContext['page']> = {};

  if (path) {
    page.path = path;
  }

  if (params.objectKey) {
    page.object = params.objectKey;
  }

  if (params.recordId) {
    page.recordId = params.recordId;
  }

  if (typeof search.view === 'string') {
    page.viewId = search.view;
  }

  if (params.workflowId) {
    page.workflowId = params.workflowId;
  }

  return Object.keys(page).length > 0 ? { page } : {};
};

const errorOf = (error: unknown): { code: string; message: string } => {
  const api = error as Partial<DeviasApiError>;

  return {
    code: typeof api?.code === 'string' ? api.code : 'NETWORK',
    message: error instanceof Error ? error.message : 'The connection to the agent was lost',
  };
};

/** Drives one stream into the store; independent of any component so closing the panel never drops a turn. */
const consume = (
  client: DeviasClient,
  conversationId: string,
  start: (onEvent: (event: ChatEvent) => void) => AiStreamHandle,
) => {
  const store = useAgentChatStore.getState();
  store.setStreaming(conversationId, true);
  let handle: AiStreamHandle;

  try {
    handle = start((event) => {
      useAgentChatStore.getState().applyEvent(conversationId, event);

      if (event.type === 'navigate') {
        navigateFor(client.workspaceId, event.target);
      }
    });
  } catch (error) {
    store.setError(conversationId, errorOf(error));
    store.setStreaming(conversationId, false);

    return Promise.resolve();
  }

  return handle.done
    .catch((error: unknown) => useAgentChatStore.getState().setError(conversationId, errorOf(error)))
    .finally(async () => {
      // Re-sync with what the server persisted (ids, statuses); cheap and makes reconnects trivial.
      try {
        const thread = await client.ai.conversations.get(conversationId);
        const current = useAgentChatStore.getState().threads[conversationId];
        useAgentChatStore.getState().setThread({ ...threadFrom(thread), error: current?.error ?? null });
      } catch {
        // keep the streamed state
      }

      useAgentChatStore.getState().setStreaming(conversationId, false);
    });
};

export const useAgentChat = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const nav = useNavigateTo();

  const status = useQuery({
    queryKey: keys.aiStatus(workspaceId),
    queryFn: () => client.ai.status(),
    staleTime: 60_000,
  });
  const conversations = useQuery({
    queryKey: keys.aiConversations(workspaceId),
    queryFn: () => client.ai.conversations.list({ limit: 50 }),
    staleTime: 30_000,
  });
  const agentsQuery = useAgents();
  const allAgentsQuery = useAllAgents();
  const settingsQuery = useAiSettings();
  /** The agents a conversation can start with. */
  const agents: AiAgent[] = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const allAgents: AiAgent[] = useMemo(() => allAgentsQuery.data ?? [], [allAgentsQuery.data]);
  const defaultAgent = useMemo(() => defaultAgentOf(allAgents, settingsQuery.data), [allAgents, settingsQuery.data]);

  const activeId = useAgentChatStore((state) => state.activeId[workspaceId] ?? null);
  const thread = useAgentChatStore((state) => (activeId ? state.threads[activeId] : undefined));
  const streaming = useAgentChatStore((state) => (activeId ? (state.streaming[activeId] ?? false) : false));
  const chosenAgentId = useAgentChatStore((state) => state.agentId[workspaceId] ?? null);
  const { setActive, setAgent, setThread, removeThread, appendUserMessage } = useAgentChatStore.getState();
  // The open conversation's agent, else the one chosen for the next conversation, else the workspace's default.
  const agentId = thread ? thread.conversation.agentId : (chosenAgentId ?? defaultAgent?.id ?? null);
  // Archived agents are looked up too: their threads stay open, read-only.
  const agent = useMemo(() => allAgents.find((a) => a.id === agentId) ?? null, [allAgents, agentId]);
  const archived = agent?.archivedAt != null;

  useEffect(
    () =>
      registerNavigator(workspaceId, (target) => {
        switch (target.kind) {
          case 'record':
            nav.toRecord(target.object, target.id);

            return;
          case 'object':
            nav.toObject(target.object, target.viewId);

            return;
          case 'settings':
            nav.toSettings(target.section);

            return;
          case 'page':
            nav.toPage(target.pagePath);

            return;
          case 'workflow':
            nav.toWorkflow(target.id);

            return;
          case 'document':
            nav.toDocument(target.id);

            return;
          case 'task':
            nav.toTask(target.id);

            return;
        }
      }),
    [workspaceId, nav],
  );

  // Load the selected conversation once; streaming keeps it fresh afterwards.
  useEffect(() => {
    if (!activeId || thread) {
      return;
    }

    let cancelled = false;
    client.ai.conversations
      .get(activeId)
      .then((loaded) => {
        if (!cancelled) {
          setThread(threadFrom(loaded));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActive(workspaceId, null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeId, thread, client, setThread, setActive, workspaceId]);

  const context = useMemo(
    () => pageContextFrom(navigation.pathname, navigation.params, navigation.search),
    [navigation.pathname, navigation.params, navigation.search],
  );

  const invalidateList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: keys.aiConversations(workspaceId) }),
    [queryClient, workspaceId],
  );

  const send = useCallback(
    async (content: string, options: { newConversation?: boolean; agentId?: string | undefined } = {}) => {
      const text = content.trim();

      if (!text) {
        return;
      }

      let id = options.newConversation ? null : activeId;

      if (!id) {
        // Named, else the one picked for the next conversation, else the server's default.
        const withAgent = options.agentId ?? (options.newConversation ? null : chosenAgentId);
        const conversation = await client.ai.conversations.create(withAgent ? { agentId: withAgent } : {});
        setThread(newThread(conversation));
        setActive(workspaceId, conversation.id);
        id = conversation.id;
        void invalidateList();
      }

      appendUserMessage(id, {
        id: newId(),
        conversationId: id,
        turnId: '',
        seq: (useAgentChatStore.getState().threads[id]?.messages.length ?? 0) + 1,
        role: 'user',
        blocks: [{ type: 'text', text }],
        text,
        context,
        createdAt: new Date().toISOString(),
      });
      await consume(client, id, (onEvent) => client.ai.send(id, { content: text, context }, onEvent));
      void invalidateList();
    },
    [activeId, chosenAgentId, client, workspaceId, context, setThread, setActive, appendUserMessage, invalidateList],
  );

  const resolve = useCallback(
    async (toolCallId: string, approved: boolean, values?: Record<string, string>, reason?: string) => {
      if (!activeId) {
        return;
      }

      const id = activeId;
      await consume(client, id, (onEvent) =>
        client.ai.resolve(
          id,
          toolCallId,
          { approved, ...(reason ? { reason } : {}), ...(values ? { values } : {}) },
          onEvent,
        ),
      );
    },
    [activeId, client],
  );

  const cancel = useCallback(async () => {
    if (!activeId) {
      return;
    }

    await client.ai.cancel(activeId);
    const loaded = await client.ai.conversations.get(activeId);
    setThread(threadFrom(loaded));
  }, [activeId, client, setThread]);

  const newConversation = useCallback(() => setActive(workspaceId, null), [setActive, workspaceId]);
  const select = useCallback((id: string) => setActive(workspaceId, id), [setActive, workspaceId]);
  /** Talk to an agent: the next message starts a new conversation with it. */
  const selectAgent = useCallback(
    (id: string) => {
      setAgent(workspaceId, id);
      setActive(workspaceId, null);
    },
    [setAgent, setActive, workspaceId],
  );
  const remove = useCallback(
    async (id: string) => {
      await client.ai.conversations.delete(id);
      removeThread(id);

      if (useAgentChatStore.getState().activeId[workspaceId] === id) {
        setActive(workspaceId, null);
      }

      void invalidateList();
    },
    [client, removeThread, setActive, workspaceId, invalidateList],
  );

  const pending: ToolCall[] = useMemo(() => pendingCalls(thread), [thread]);

  return {
    status,
    conversations,
    agents,
    allAgents,
    agent,
    agentId,
    archived,
    defaultAgent,
    agentsLoading: agentsQuery.isPending || settingsQuery.isPending,
    activeId,
    thread,
    streaming,
    pending,
    awaitingApproval: pending.length > 0,
    send,
    resolve,
    cancel,
    newConversation,
    select,
    selectAgent,
    remove,
  };
};

export type AgentChat = ReturnType<typeof useAgentChat>;
