import type { AiAgent, Conversation } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { formatDistanceToNowStrict } from 'date-fns';

const when = (conversation: Conversation): string => {
  const at = conversation.lastMessageAt ?? conversation.updatedAt;

  try {
    return formatDistanceToNowStrict(new Date(at), { addSuffix: true });
  } catch {
    return '';
  }
};

/** History dropdown: pick a previous conversation or start a new one. */
export function ConversationList({
  conversations,
  agents = [],
  activeId,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  /** To name the agent a conversation is with, archived ones included. */
  agents?: AiAgent[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const agentName = (conversation: Conversation): string =>
    agents.find((agent) => agent.id === conversation.agentId)?.label ?? 'Agent';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="Conversation history" />}>
        <Icon name="history" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Conversations</DropdownMenuLabel>
          {conversations.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</div>
          ) : (
            conversations.map((conversation) => (
              <DropdownMenuItem key={conversation.id} onClick={() => onSelect(conversation.id)}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{conversation.title ?? 'Untitled'}</span>
                  <span className="text-xs text-muted-foreground">
                    {when(conversation)}
                    {` · ${agentName(conversation)}`}
                  </span>
                </span>
                {conversation.id === activeId ? <Icon name="check" className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>
          <Icon name="plus" /> New conversation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
