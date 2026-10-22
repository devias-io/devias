import { type AiAgent, type ChatMessage, type DisplayBlock, type LinkInText, linksIn } from '@devias/core';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn, Icon } from '@devias/ui';
import { useState } from 'react';
import { RichMarkdown } from '../../components/markdown';
import { useNavigateTo } from '../../hooks/use-navigate-to';
import { AgentMark } from '../agent-mark';
import type { ThreadState } from './store';
import { ToolCallCard } from './tool-call-card';

/** What the person wrote, as they wrote it, with the records, workflows and documents they mentioned as links to them. */
function MessageText({ text }: { text: string }) {
  const nav = useNavigateTo();
  const parts: (string | LinkInText)[] = [];
  let last = 0;

  for (const link of linksIn(text)) {
    parts.push(text.slice(last, link.start), link);
    last = link.end;
  }

  parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <a
            key={i}
            href={nav.href.link(part.target)}
            data-slot="message-mention"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={(event) => {
              event.preventDefault();
              nav.toLink(part.target);
            }}
          >
            @{part.label}
          </a>
        ),
      )}
    </>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="xs" className="h-5 gap-1 px-1 text-xs text-muted-foreground" />}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="size-3" />
        Thinking
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 border-l-2 border-border pl-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {text || '(not shown)'}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Block({
  block,
  onResolve,
  busy,
}: {
  block: DisplayBlock;
  onResolve?: (toolCallId: string, approved: boolean, values?: Record<string, string>) => void;
  busy: boolean;
}) {
  switch (block.type) {
    case 'text':
      return block.text ? <RichMarkdown text={block.text} /> : null;
    case 'thinking':
      return <ThinkingBlock text={block.text} />;
    case 'tool_use':
      return (
        <ToolCallCard
          call={block.toolCall}
          busy={busy}
          onResolve={onResolve ? (approved, values) => onResolve(block.toolCall.id, approved, values) : undefined}
        />
      );
  }
}

function Message({
  message,
  onResolve,
  busy,
}: {
  message: ChatMessage;
  onResolve?: (toolCallId: string, approved: boolean, values?: Record<string, string>) => void;
  busy: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap">
          <MessageText text={message.text ?? ''} />
        </div>
      </div>
    );
  }

  const visible = message.blocks.filter((b) => !(b.type === 'text' && b.text === ''));

  return (
    <div className="flex flex-col gap-2" data-role="assistant">
      {visible.map((block, i) => (
        <Block
          key={block.type === 'tool_use' ? block.toolCall.id : `${message.id}-${i}`}
          block={block}
          onResolve={onResolve}
          busy={busy}
        />
      ))}
      {message.partial && visible.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="loader-circle" className="size-3.5 animate-spin" /> Thinking…
        </div>
      ) : null}
      {message.stopReason === 'refusal' ? (
        <div className="text-xs text-muted-foreground">The agent declined this request.</div>
      ) : null}
    </div>
  );
}

export function Thread({
  thread,
  agent,
  streaming,
  onResolve,
  onSuggestion,
}: {
  thread: ThreadState | undefined;
  /** The agent the conversation is (or will be) with. Its starter prompts are what an empty conversation offers. */
  agent?: AiAgent | null;
  streaming: boolean;
  onResolve: (toolCallId: string, approved: boolean, values?: Record<string, string>) => void;
  onSuggestion: (text: string) => void;
}) {
  if (!thread || thread.messages.length === 0) {
    return (
      <div className="flex min-h-full flex-col gap-3 px-4 py-6" data-slot="agent-chat-empty">
        <AgentMark tile icon={agent?.icon} className="size-9" />
        <div>
          <div className="text-xs font-medium">{agent ? `Ask ${agent.name}` : 'Ask an agent'}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {agent?.description ??
              'It can find and change records, add fields and views, and open things for you. Changes that matter ask for your approval first.'}
          </p>
        </div>
        {/* At the bottom, by the box you type in. */}
        <div className="-mx-2 mt-auto flex flex-col">
          {(agent?.starterPrompts ?? []).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={() => onSuggestion(`I want to ${suggestion}`)}
            >
              <Icon name="arrow-right" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="text-foreground">I want to</span> {suggestion}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const awaiting = thread.activeTurn?.status === 'awaiting_approval';

  return (
    <div className="flex flex-col gap-4 px-3 py-3" data-slot="agent-chat-thread">
      {thread.messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          onResolve={awaiting && !streaming ? onResolve : undefined}
          busy={streaming}
        />
      ))}
      {thread.error ? (
        <div
          className={cn(
            'rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive',
          )}
          role="alert"
        >
          {thread.error.message}
        </div>
      ) : null}
    </div>
  );
}
