import { coreIds, defineBlockComponent } from '@devias/core';
import { Button, Icon, Tooltip, TooltipContent, TooltipTrigger } from '@devias/ui';
import { useId, useState } from 'react';
import { useAgents, useDefaultAgent } from '../../hooks/use-agents';
import { useWorkspace } from '../../providers/workspace';
import { useDock } from '../../shell/dock';
import { AgentPicker } from '../agent-picker';
import { AGENT_PANEL_ID, askAgent } from '../ask';

/**
 * Under the Home grid: the chosen agent's starter prompts ("I want to …") and a composer. Either hands the request to
 * the panel, which answers it in a new conversation with that agent. Without an active agent there is nothing to ask.
 */
function AskAgent() {
  const { workspaceId } = useWorkspace();
  const agents = useAgents();
  const defaultAgent = useDefaultAgent();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const inputId = useId();
  const active = agents.data ?? [];
  const agent = active.find((item) => item.id === chosenId) ?? defaultAgent;

  if (!agent) {
    return null;
  }

  const prompts = agent.starterPrompts;
  const ask = (prompt: string) => {
    if (!prompt.trim()) {
      return;
    }

    askAgent(workspaceId, prompt.trim(), agent.id);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2" data-slot="ask-agent">
      <div className="overflow-hidden rounded-lg border border-border bg-card p-1 empty:hidden">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="flex w-full items-baseline gap-1.5 rounded-xs px-4 py-2 text-left text-xs transition-colors hover:bg-muted"
            onClick={() => ask(`I want to ${prompt}`)}
          >
            <span className="shrink-0 text-foreground">I want to</span>
            <span className="truncate text-muted-foreground">{prompt}</span>
          </button>
        ))}
      </div>
      <form
        className="overflow-hidden rounded-lg border border-border bg-card"
        onSubmit={(event) => {
          event.preventDefault();
          ask(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask {agent.label}
        </label>
        <textarea
          id={inputId}
          rows={2}
          value={text}
          placeholder="I want to…"
          className="block w-full resize-none bg-transparent px-5 pt-4 text-xs outline-none placeholder:text-muted-foreground"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              ask(text);
            }
          }}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <AgentPicker agents={active} agent={agent} onSelect={setChosenId} variant="chip" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Past conversations"
                  className="text-muted-foreground"
                  onClick={() => useDock.getState().open(AGENT_PANEL_ID)}
                />
              }
            >
              <Icon name="history" />
            </TooltipTrigger>
            <TooltipContent>Past conversations · ⌘J</TooltipContent>
          </Tooltip>
          <Button type="submit" size="icon-sm" aria-label="Ask" className="ms-auto" disabled={!text.trim()}>
            <Icon name="arrow-up" />
          </Button>
        </div>
      </form>
    </div>
  );
}

export const askAgentBlock = defineBlockComponent({
  id: coreIds.blocks.ask_agent,
  label: 'Ask an agent',
  icon: 'agent',
  surfaces: { home: { order: 50, placement: 'below' } },
  component: AskAgent,
});
