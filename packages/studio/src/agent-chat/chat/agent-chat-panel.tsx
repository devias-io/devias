import { Button, EmptyState, Icon, Tooltip, TooltipContent, TooltipTrigger } from '@devias/ui';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChatInput, type ChatInputHandle } from '../../editor';
import { errorMessage } from '../../hooks/use-mutations';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { useDock } from '../../shell/dock';
import { AgentPicker } from '../agent-picker';
import { ConversationList } from './conversation-list';
import { useAgentChatStore } from './store';
import { Thread } from './thread';
import { useAgentChat } from './use-agent-chat';

function Composer({
  disabled,
  busy,
  streaming,
  awaitingApproval,
  agentName,
  archived,
  onSend,
  onCancel,
}: {
  /** The panel can't be used yet (still loading), or the conversation's agent is archived. */
  disabled: boolean;
  /** Who the message goes to, for the placeholder. */
  agentName?: string | undefined;
  /** The conversation's agent was archived: the composer says so instead of inviting a message. */
  archived?: boolean | undefined;
  /** A reply is streaming or an action awaits approval: typing is fine, sending waits. */
  busy: boolean;
  streaming: boolean;
  awaitingApproval: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [empty, setEmpty] = useState(true);
  const input = useRef<ChatInputHandle>(null);
  const submit = (message = input.current?.markdown() ?? '') => {
    const text = message.trim();

    if (!text || disabled || busy) {
      return;
    }

    input.current?.clear();
    onSend(text);
    // Keep typing after sending with the button, like after Enter.
    input.current?.focus();
  };
  // When a reply finishes or an approval is resolved, focus returns here unless the user moved on elsewhere
  // (clicking Approve or Stop leaves focus on nothing once those buttons disappear).
  useEffect(() => {
    if (busy || disabled) {
      return;
    }

    const active = document.activeElement;

    if (!active || active === document.body) {
      input.current?.focus();
    }
  }, [busy, disabled]);

  return (
    <div className="p-3" data-slot="agent-chat-composer">
      <div className="flex flex-col gap-2 rounded-lg bg-transparent px-3 pt-2.5 pb-2 ring-1 ring-input ring-inset transition-shadow focus-within:ring-ring dark:bg-input/30">
        <ChatInput
          ariaLabel="Message the agent"
          placeholder={
            archived
              ? 'This agent is archived'
              : awaitingApproval
                ? 'Approve or reject the pending action first…'
                : agentName
                  ? `Ask ${agentName}…`
                  : 'Ask an agent…'
          }
          handleRef={input}
          disabled={disabled}
          onSubmit={submit}
          onEmptyChange={setEmpty}
          {...(streaming ? { onEscape: onCancel } : {})}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line · @ to mention
          </span>
          {streaming ? (
            <Button size="xs" variant="secondary" onClick={onCancel} aria-label="Stop">
              <Icon name="octagon-x" /> Stop
            </Button>
          ) : (
            <Button size="icon-sm" onClick={() => submit()} disabled={disabled || busy || empty} aria-label="Send">
              <Icon name="arrow-up" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The docked panel: header with the agent and history, the thread, and the composer. */
export function AgentChatPanel() {
  const chat = useAgentChat();
  const navigation = useNavigation();
  const close = useDock((state) => state.close);
  const scroller = useRef<HTMLDivElement>(null);
  const { thread, streaming, awaitingApproval, status } = chat;

  // Keep the newest content in view while a reply streams in.
  const messageCount = thread?.messages.length ?? 0;
  const lastBlock = thread?.messages.at(-1)?.blocks.at(-1);
  const lastLength = lastBlock?.type === 'text' || lastBlock?.type === 'thinking' ? lastBlock.text.length : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows, not when refs change
  useEffect(() => {
    const el = scroller.current;

    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messageCount, lastLength, streaming]);

  const run = (action: Promise<void>) => {
    action.catch((error) => toast.error(errorMessage(error)));
  };

  // A prompt sent from elsewhere (e.g. Home) starts a new conversation as soon as the panel is open.
  const { workspaceId, slug } = useWorkspace();
  const queued = useAgentChatStore((state) => state.queued[workspaceId]);
  const { send } = chat;
  useEffect(() => {
    if (queued === undefined) {
      return;
    }

    const prompt = useAgentChatStore.getState().takePrompt(workspaceId);

    // The agent the request names (Home's picker), else the workspace's default, whichever agent the panel was on.
    if (prompt?.text) {
      send(prompt.text, { newConversation: true, agentId: prompt.agentId }).catch((error) =>
        toast.error(errorMessage(error)),
      );
    }
  }, [queued, workspaceId, send]);

  const configured = status.data?.configured ?? true;
  const noAgents = !chat.agentsLoading && chat.agents.length === 0 && !thread;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="agent-chat-panel">
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-1.5 border-b border-border px-2">
        <AgentPicker agents={chat.agents} agent={chat.agent} onSelect={chat.selectAgent} />
        <div className="ml-auto flex items-center gap-0.5">
          <ConversationList
            conversations={chat.conversations.data ?? []}
            agents={chat.allAgents}
            activeId={chat.activeId}
            onSelect={chat.select}
            onNew={chat.newConversation}
          />
          {chat.activeId ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label="Delete conversation"
                    disabled={streaming}
                    onClick={() => chat.activeId && run(chat.remove(chat.activeId))}
                  />
                }
              >
                <Icon name="trash-2" className="size-5" />
              </TooltipTrigger>
              <TooltipContent>Delete conversation</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-lg" aria-label="New conversation" onClick={chat.newConversation} />
              }
            >
              <Icon name="plus" className="size-5" />
            </TooltipTrigger>
            <TooltipContent>New conversation</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-lg" aria-label="Close panel" onClick={close}>
            <Icon name="x" className="size-5" />
          </Button>
        </div>
      </div>
      {!configured ? (
        <EmptyState
          icon="agent"
          title="AI is not configured"
          description="Set the AI provider's API key on the server and restart it to enable agents."
          className="flex-1"
        />
      ) : noAgents ? (
        <EmptyState
          icon="agent"
          title="No agents yet"
          description={
            status.data?.canManage
              ? 'Create an agent to start talking to it.'
              : 'Ask a workspace admin to create an agent.'
          }
          action={
            status.data?.canManage ? (
              <Button size="lg" onClick={() => navigation.navigate(links.agent(slug))}>
                <Icon name="plus" /> New agent
              </Button>
            ) : undefined
          }
          className="flex-1"
        />
      ) : (
        <>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <Thread
              thread={thread}
              agent={chat.agent}
              streaming={streaming}
              onResolve={(toolCallId, approved, values) => run(chat.resolve(toolCallId, approved, values))}
              onSuggestion={(text) => run(chat.send(text))}
            />
          </div>
          {chat.archived ? (
            <div
              className="mx-3 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
              data-slot="archived-notice"
            >
              <span className="text-muted-foreground">
                {chat.agent?.label} was archived. This conversation is read-only.
              </span>
              <Button size="xs" variant="secondary" onClick={chat.newConversation}>
                New conversation
              </Button>
            </div>
          ) : null}
          <Composer
            disabled={status.isPending || chat.archived}
            archived={chat.archived}
            busy={streaming || awaitingApproval}
            streaming={streaming}
            awaitingApproval={awaitingApproval}
            agentName={chat.agent?.label}
            onSend={(text) => run(chat.send(text))}
            onCancel={() => run(chat.cancel())}
          />
        </>
      )}
    </div>
  );
}
