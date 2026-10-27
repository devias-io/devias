import {
  type AiTurn,
  addUsage,
  type ChatEvent,
  type ChatMessage,
  type Conversation,
  type ConversationThread,
  type DisplayBlock,
  emptyUsage,
  type NavigateTarget,
  type ToolCall,
} from '@devias/core';
import { create } from 'zustand';

/**
 * Agent chat state lives outside React so a turn keeps streaming into it while the panel is closed or
 * the user navigates. `reduceChatEvent` folds stream events into the same `ConversationThread` shape
 * the server returns, so a reload after the stream ends is a no-op visually.
 */

export interface ThreadState extends ConversationThread {
  error: { code: string; message: string } | null;
}

const now = () => new Date().toISOString();

const emptyText = (): DisplayBlock => ({ type: 'text', text: '' });

const ensureBlock = (blocks: DisplayBlock[], index: number, make: () => DisplayBlock): DisplayBlock[] => {
  const next = [...blocks];

  while (next.length <= index) {
    next.push(next.length === index ? make() : emptyText());
  }

  const current = next[index];

  if (current && make().type !== current.type && current.type === 'text' && current.text === '') {
    next[index] = make();
  }

  return next;
};

const updateMessage = (
  thread: ThreadState,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ThreadState => ({
  ...thread,
  messages: thread.messages.map((message) => (message.id === messageId ? update(message) : message)),
});

const updateToolCall = (
  thread: ThreadState,
  toolCallId: string,
  update: (call: ToolCall) => ToolCall,
): ThreadState => ({
  ...thread,
  messages: thread.messages.map((message) => ({
    ...message,
    blocks: message.blocks.map((block) =>
      block.type === 'tool_use' && block.toolCall.id === toolCallId
        ? { ...block, toolCall: update(block.toolCall) }
        : block,
    ),
  })),
});

export const reduceChatEvent = (thread: ThreadState, event: ChatEvent): ThreadState => {
  switch (event.type) {
    case 'turn_start': {
      const turn: AiTurn = {
        id: event.turnId,
        conversationId: event.conversationId,
        status: 'running',
        iteration: event.iteration,
        usage: thread.activeTurn?.id === event.turnId ? thread.activeTurn.usage : emptyUsage(),
        error: null,
        startedAt: thread.activeTurn?.id === event.turnId ? thread.activeTurn.startedAt : now(),
        finishedAt: null,
      };

      return {
        ...thread,
        activeTurn: turn,
        error: null,
        conversation: { ...thread.conversation, activeTurnId: event.turnId },
      };
    }
    case 'message_start':
      return {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: event.messageId,
            conversationId: thread.conversation.id,
            turnId: thread.activeTurn?.id ?? '',
            seq: thread.messages.length + 1,
            role: 'assistant',
            blocks: [],
            partial: true,
            createdAt: now(),
          },
        ],
      };
    case 'text_delta':
      return updateMessage(thread, event.messageId, (message) => {
        const blocks = ensureBlock(message.blocks, event.blockIndex, emptyText);
        const block = blocks[event.blockIndex];

        if (block?.type === 'text') {
          blocks[event.blockIndex] = { type: 'text', text: block.text + event.text };
        }

        return { ...message, blocks };
      });
    case 'thinking_delta':
      return updateMessage(thread, event.messageId, (message) => {
        const blocks = ensureBlock(message.blocks, event.blockIndex, () => ({ type: 'thinking', text: '' }));
        const block = blocks[event.blockIndex];

        if (block?.type === 'thinking') {
          blocks[event.blockIndex] = { type: 'thinking', text: block.text + event.text };
        }

        return { ...message, blocks };
      });
    case 'thinking_stop':
      return thread;
    case 'tool_call_start':
      return updateMessage(thread, event.messageId, (message) => {
        const blocks = ensureBlock(message.blocks, event.blockIndex, () => ({
          type: 'tool_use',
          toolCall: {
            id: event.toolUseId,
            toolUseId: event.toolUseId,
            name: event.name,
            input: '',
            status: 'pending',
            requiresApproval: false,
          },
        }));

        return { ...message, blocks };
      });
    case 'tool_call_input_delta':
      return updateMessage(thread, event.messageId, (message) => {
        const blocks = [...message.blocks];
        const block = blocks[event.blockIndex];

        if (block?.type === 'tool_use' && typeof block.toolCall.input === 'string') {
          blocks[event.blockIndex] = {
            type: 'tool_use',
            toolCall: { ...block.toolCall, input: block.toolCall.input + event.partialJson },
          };
        }

        return { ...message, blocks };
      });
    case 'tool_call':
      return updateMessage(thread, event.messageId, (message) => {
        const blocks = ensureBlock(message.blocks, event.blockIndex, () => ({
          type: 'tool_use',
          toolCall: event.toolCall,
        }));
        const existing = blocks.findIndex(
          (b) =>
            b.type === 'tool_use' &&
            (b.toolCall.toolUseId === event.toolCall.toolUseId || b.toolCall.id === event.toolCall.id),
        );
        const index = existing >= 0 ? existing : event.blockIndex;
        blocks[index] = { type: 'tool_use', toolCall: event.toolCall };

        return { ...message, blocks };
      });
    case 'tool_result':
      return updateToolCall(thread, event.toolCallId, (call) => ({
        ...call,
        status: event.status,
        result: event.result,
        isError: event.isError,
        ...(event.revealed ? { revealed: event.revealed } : {}),
        ...(event.status === 'executed' || event.status === 'failed' ? { executedAt: now() } : { resolvedAt: now() }),
      }));
    case 'message_stop':
      return updateMessage(thread, event.messageId, (message) => ({
        ...message,
        partial: false,
        stopReason: event.stopReason,
        usage: event.usage,
        model: event.model,
      }));
    case 'paused':
      return {
        ...thread,
        activeTurn: thread.activeTurn ? { ...thread.activeTurn, status: 'awaiting_approval' } : thread.activeTurn,
      };
    case 'done': {
      const messages = thread.messages.map((message, i) =>
        i === thread.messages.length - 1 && message.role === 'assistant' ? { ...message, partial: false } : message,
      );

      return {
        ...thread,
        messages,
        activeTurn: null,
        conversation: {
          ...thread.conversation,
          activeTurnId: null,
          lastMessageAt: now(),
          usage: addUsage(thread.conversation.usage, event.usage),
        },
      };
    }
    case 'error':
      return { ...thread, error: { code: event.code, message: event.message } };
    case 'navigate':
      return thread;
    default:
      return thread;
  }
};

export const threadFrom = (thread: ConversationThread): ThreadState => ({ ...thread, error: null });

export const newThread = (conversation: Conversation): ThreadState => ({
  conversation,
  messages: [],
  activeTurn: null,
  error: null,
});

/** Tool calls the user still has to approve or reject, across the active turn. */
export const pendingCalls = (thread: ThreadState | undefined): ToolCall[] =>
  thread?.activeTurn?.status === 'awaiting_approval'
    ? thread.messages.flatMap((m) =>
        m.blocks.flatMap((b) =>
          b.type === 'tool_use' && b.toolCall.status === 'pending' && b.toolCall.requiresApproval ? [b.toolCall] : [],
        ),
      )
    : [];

/** A request to start a conversation: what to say, and to which agent (the default agent when absent). */
export interface QueuedPrompt {
  text: string;
  agentId?: string | undefined;
}

interface AgentChatState {
  /** Active conversation per workspace; null means "start a new one on the next message". */
  activeId: Record<string, string | null>;
  /** The agent the next new conversation is with, per workspace; null is the workspace's default agent. */
  agentId: Record<string, string | null>;
  setAgent: (workspaceId: string, id: string | null) => void;
  threads: Record<string, ThreadState>;
  streaming: Record<string, boolean>;
  setActive: (workspaceId: string, id: string | null) => void;
  setThread: (thread: ThreadState) => void;
  removeThread: (id: string) => void;
  applyEvent: (id: string, event: ChatEvent) => void;
  appendUserMessage: (id: string, message: ChatMessage) => void;
  setStreaming: (id: string, streaming: boolean) => void;
  setError: (id: string, error: ThreadState['error']) => void;
  /** A prompt from elsewhere in the studio (e.g. Home) for the panel to send in a new conversation with an agent. */
  queued: Record<string, QueuedPrompt | undefined>;
  queuePrompt: (workspaceId: string, prompt: QueuedPrompt) => void;
  /** Returns the queued prompt once and clears it. */
  takePrompt: (workspaceId: string) => QueuedPrompt | undefined;
}

export const useAgentChatStore = create<AgentChatState>()((set, get) => ({
  activeId: {},
  agentId: {},
  setAgent: (workspaceId, id) => set((state) => ({ agentId: { ...state.agentId, [workspaceId]: id } })),
  threads: {},
  streaming: {},
  queued: {},
  queuePrompt: (workspaceId, prompt) => set((state) => ({ queued: { ...state.queued, [workspaceId]: prompt } })),
  takePrompt: (workspaceId) => {
    const prompt = get().queued[workspaceId];

    if (prompt !== undefined) {
      set((state) => ({ queued: { ...state.queued, [workspaceId]: undefined } }));
    }

    return prompt;
  },
  setActive: (workspaceId, id) => set((state) => ({ activeId: { ...state.activeId, [workspaceId]: id } })),
  setThread: (thread) => set((state) => ({ threads: { ...state.threads, [thread.conversation.id]: thread } })),
  removeThread: (id) =>
    set((state) => {
      const { [id]: _removed, ...threads } = state.threads;
      const { [id]: _streaming, ...streaming } = state.streaming;

      return { threads, streaming };
    }),
  applyEvent: (id, event) =>
    set((state) => {
      const thread = state.threads[id];

      if (!thread) {
        return state;
      }

      return { threads: { ...state.threads, [id]: reduceChatEvent(thread, event) } };
    }),
  appendUserMessage: (id, message) =>
    set((state) => {
      const thread = state.threads[id];

      if (!thread) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [id]: {
            ...thread,
            error: null,
            messages: [...thread.messages, message],
            conversation: {
              ...thread.conversation,
              title: thread.conversation.title ?? message.text?.slice(0, 80) ?? null,
            },
          },
        },
      };
    }),
  setStreaming: (id, streaming) => set((state) => ({ streaming: { ...state.streaming, [id]: streaming } })),
  setError: (id, error) =>
    set((state) => {
      const thread = state.threads[id];

      if (!thread) {
        return state;
      }

      return { threads: { ...state.threads, [id]: { ...thread, error } } };
    }),
}));

/** Navigation requests from the agent are handed to whichever panel is mounted for the workspace. */
const navigators = new Map<string, (target: NavigateTarget) => void>();
export const registerNavigator = (workspaceId: string, navigate: (target: NavigateTarget) => void): (() => void) => {
  navigators.set(workspaceId, navigate);

  return () => {
    if (navigators.get(workspaceId) === navigate) {
      navigators.delete(workspaceId);
    }
  };
};
export const navigateFor = (workspaceId: string, target: NavigateTarget): void => navigators.get(workspaceId)?.(target);
