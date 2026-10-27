import { type Assignee, parseAssigneeRef } from '@devias/core';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { type ReactNode, useMemo } from 'react';
import { AgentMark } from '../agent-chat/agent-mark';
import { useAgents } from '../hooks/use-agents';
import { useWorkspace } from '../providers/workspace';

const UNASSIGNED = '__unassigned__';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export interface AssigneeCard {
  /** `user:<id>` or `agent:<id>`. */
  ref: string;
  kind: Assignee['kind'];
  name: string;
  image: string | null;
  icon: string | null;
}

/** The people and agents a task can be given to, and a way to name any assignee reference (even a former member). */
export const useAssignees = () => {
  const { members } = useWorkspace();
  const agents = useAgents();

  return useMemo(() => {
    const people: AssigneeCard[] = members.map((member) => ({
      ref: `user:${member.userId}`,
      kind: 'user',
      name: member.user.name,
      image: member.user.image ?? null,
      icon: null,
    }));
    const everyAgent: AssigneeCard[] = (agents.data ?? []).map((agent) => ({
      ref: `agent:${agent.id}`,
      kind: 'agent',
      name: agent.label,
      image: null,
      icon: agent.icon,
    }));
    // Only agents that take tasks can be given one; any agent still has a name where it was.
    const takers = new Set((agents.data ?? []).filter((agent) => agent.takesTasks).map((agent) => `agent:${agent.id}`));
    const bots = everyAgent.filter((agent) => takers.has(agent.ref));
    const byRef = new Map([...people, ...everyAgent].map((card) => [card.ref, card]));

    return {
      people,
      agents: bots,
      /** The card of an assignee reference; a former member or archived agent still gets a name. */
      card: (ref: string | null): AssigneeCard | null => {
        if (!ref) {
          return null;
        }

        const known = byRef.get(ref);

        if (known) {
          return known;
        }

        const assignee = parseAssigneeRef(ref);

        return assignee
          ? {
              ref,
              kind: assignee.kind,
              name: assignee.kind === 'agent' ? 'Former agent' : 'Former member',
              image: null,
              icon: null,
            }
          : null;
      },
    };
  }, [members, agents.data]);
};

/** A person's photo or initials, or an agent's mark. */
export function AssigneeAvatar({ card, className }: { card: AssigneeCard | null; className?: string }) {
  if (!card) {
    return <Icon name="user" className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
  }

  if (card.kind === 'agent') {
    return <AgentMark icon={card.icon} tile className={cn('size-5', className)} />;
  }

  return (
    <Avatar size="sm" className={className}>
      {card.image ? <AvatarImage src={card.image} alt={card.name} /> : null}
      <AvatarFallback className="text-[10px]">{initialsOf(card.name)}</AvatarFallback>
    </Avatar>
  );
}

/** An assignee as a mark and a name, for rows and cards. */
export function AssigneeChip({ value, className }: { value: string | null; className?: string }) {
  const { card } = useAssignees();
  const found = card(value);

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)} data-slot="assignee">
      <AssigneeAvatar card={found} />
      <span className={cn('truncate', !found && 'text-muted-foreground')}>{found?.name ?? 'Unassigned'}</span>
    </span>
  );
}

/** Who has a task, changed from a menu of the workspace's people, then its agents. */
export function AssigneeMenu({
  value,
  onChange,
  disabled,
  trigger,
  label = 'Assignee',
  align = 'start',
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** What the menu opens from; the default is a quiet button with the current assignee. */
  trigger?: ReactNode;
  label?: string;
  align?: 'start' | 'end';
}) {
  const { people, agents, card } = useAssignees();
  const current = card(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            disabled={disabled}
            className="h-8 w-full justify-start gap-2 px-2 font-normal text-foreground hover:bg-muted"
          />
        }
      >
        {trigger ?? (
          <>
            <AssigneeAvatar card={current} />
            <span className={cn('truncate', !current && 'text-muted-foreground')}>{current?.name ?? 'Unassigned'}</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-52 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={value ?? UNASSIGNED}
          onValueChange={(next) => onChange(next === UNASSIGNED ? null : String(next))}
        >
          <DropdownMenuRadioItem value={UNASSIGNED}>
            <Icon name="user" className="size-4 text-muted-foreground" />
            Unassigned
          </DropdownMenuRadioItem>
          {people.map((person) => (
            <DropdownMenuRadioItem key={person.ref} value={person.ref}>
              <AssigneeAvatar card={person} />
              {person.name}
            </DropdownMenuRadioItem>
          ))}
          {agents.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Agents</DropdownMenuLabel>
              {agents.map((agent) => (
                <DropdownMenuRadioItem key={agent.ref} value={agent.ref}>
                  <AssigneeAvatar card={agent} />
                  {agent.name}
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
