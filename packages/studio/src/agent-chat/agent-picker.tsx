import type { AiAgent } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { AgentMark } from './agent-mark';

/**
 * Which agent to talk to: the panel's title and the chip on Home's composer. `agents` are the active ones and `agent`
 * the one in use (it may be archived, for a thread that stays readable). With nothing else to pick it is a plain label.
 */
export function AgentPicker({
  agents,
  agent,
  onSelect,
  variant = 'title',
}: {
  agents: AiAgent[];
  agent: AiAgent | null;
  onSelect: (id: string) => void;
  /** `title`: bare, for a header. `chip`: outlined, for a composer. */
  variant?: 'title' | 'chip';
}) {
  const label = (
    <>
      <AgentMark icon={agent?.icon} className="size-5" />
      <span className="truncate text-xs font-medium">{agent?.label ?? 'Agent'}</span>
      {agent?.archivedAt ? <span className="text-xs text-muted-foreground">archived</span> : null}
    </>
  );
  const alone = agents.length === 0 || (agents.length === 1 && agents[0]?.id === agent?.id);

  if (alone) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" data-slot="agent-picker">
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant === 'chip' ? 'outline' : 'ghost'}
            size="sm"
            className={variant === 'chip' ? 'h-7 gap-1.5 px-2' : '-ml-1 h-7 gap-1.5 px-1.5'}
            aria-label="Choose an agent"
            data-slot="agent-picker"
          />
        }
      >
        {label}
        <Icon name="chevron-down" className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Talk to</DropdownMenuLabel>
          {agents.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onSelect(item.id)} data-agent={item.id}>
              <AgentMark icon={item.icon} className="size-5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                {item.description ? (
                  <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                ) : null}
              </span>
              {agent?.id === item.id ? <Icon name="check" className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
