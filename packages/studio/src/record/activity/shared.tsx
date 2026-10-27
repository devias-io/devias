import type { Actor, Member } from '@devias/core';
import { Avatar, AvatarFallback, AvatarImage, HoverCard, HoverCardContent, HoverCardTrigger, Icon } from '@devias/ui';
import { format, isToday, isYesterday } from 'date-fns';
import { type ReactNode, useMemo } from 'react';
import { AgentMark } from '../../agent-chat/agent-mark';
import { useAgentCards } from '../../hooks/use-agents';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { initials } from '../../shell/user-menu';

/** What the activity and comments of a record share: who did something, how a day and a moment are written. */

/** What a hover card says about someone who acted: a member, a workspace agent, or a module's code. */
export interface ActorCard {
  kind: 'member' | 'agent' | 'module';
  name: string;
  image?: string | null;
  email?: string | null;
  /** A member's role in the workspace. */
  role?: string;
  /** An agent's icon, which its mark is drawn from. */
  icon?: string | null;
  /** What an agent is for. */
  description?: string | null;
}

/** One name in a sentence about who acted ("Note taker", "Robert Comanescu"), with the card resting on it says who it is. */
export interface ActorPart {
  name: string;
  card?: ActorCard;
}

export interface Person {
  /** The whole of it as text: "Note taker for Robert Comanescu". */
  name: string;
  image?: string | null;
  /** What it is made of, each part with its own card; a key or a workflow is one part without a card. */
  parts: ActorPart[];
}

const join = (parts: ActorPart[]): string => parts.map((part) => part.name).join(' for ');

const memberOf = (members: Map<string, Member>, userId: string) => {
  const found = members.get(userId);
  const user = found?.user;

  return {
    name: user?.name || user?.email || 'Someone',
    image: user?.image,
    email: user?.name ? user?.email : null,
    role: found?.role,
  };
};

const memberPart = (members: Map<string, Member>, userId: string): ActorPart => {
  const { name, image, email, role } = memberOf(members, userId);

  return { name, card: { kind: 'member', name, image, email, ...(role ? { role } : {}) } };
};

const nameOf = (members: Map<string, Member>, userId: string): Person => {
  const part = memberPart(members, userId);

  return { name: part.name, image: memberOf(members, userId).image, parts: [part] };
};

export type AgentCards = Map<string, { name: string; icon: string | null; description: string | null }>;

export const actorOf = (
  actor: Actor,
  members: Map<string, Member>,
  agents: AgentCards,
  modules: Map<string, string>,
): Person => {
  const behalf = actor.kind === 'agent' || actor.kind === 'module' ? actor.onBehalfOf : undefined;
  const person = behalf ? memberPart(members, behalf.id) : null;
  const image = behalf ? memberOf(members, behalf.id).image : undefined;
  const alone = (name: string): Person => ({ name, parts: [{ name }] });
  const forPerson = (first: ActorPart): Person => {
    const parts = person ? [first, person] : [first];

    return { name: join(parts), image, parts };
  };

  switch (actor.kind) {
    case 'user':
      return nameOf(members, actor.id);
    case 'agent': {
      // One of the workspace's agents, perhaps acting for someone: each name has its own card.
      const agent = agents.get(actor.id);
      const name = agent?.name ?? 'An agent';

      return forPerson({
        name,
        card: { kind: 'agent', name, icon: agent?.icon ?? null, description: agent?.description ?? null },
      });
    }
    case 'module': {
      // A module's code, run for someone ("Invoicing for Ada"): each name has its own card.
      const name = modules.get(actor.id) ?? actor.id;

      return forPerson({ name, card: { kind: 'module', name } });
    }
    case 'api_key':
      return alone('An API key');
    case 'function':
      return alone('An automation');
    case 'workflow':
      return alone('A workflow');
    default:
      return alone('System');
  }
};

/** Names an actor from the workspace's members, agents and modules. */
export function useActors(): (actor: Actor) => Person {
  const { members } = useWorkspace();
  const { schema } = useSchema();
  const people = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);
  const agents = useAgentCards();
  const modules = useMemo(() => new Map(schema.modules.map((module) => [module.id, module.label])), [schema.modules]);

  return (actor) => actorOf(actor, people, agents, modules);
}

/** "Today", "Yesterday", "Monday, Oct 12", or "Oct 12, 2025" for another year. */
export const dayLabel = (date: Date): string => {
  if (isToday(date)) {
    return 'Today';
  }

  if (isYesterday(date)) {
    return 'Yesterday';
  }

  return format(date, date.getFullYear() === new Date().getFullYear() ? 'EEEE, MMM d' : 'MMM d, yyyy');
};

/** "Oct 16, 2026, 1:15 AM": the date and the time, in full. */
export const fullDate = (date: Date): string => format(date, 'MMM d, yyyy, h:mm a');

export function PersonAvatar({ person }: { person: Person }) {
  return (
    <Avatar size="sm" className="size-6">
      {person.image ? <AvatarImage src={person.image} alt={person.name} /> : null}
      <AvatarFallback className="text-[10px]">{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/** The marker on the rail: an avatar for comments, a small icon for changes. */
export function Marker({ children }: { children: ReactNode }) {
  return <div className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">{children}</div>;
}

const ROLES: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** Who is meant: a member's face, an agent's mark, a module's name, under a quiet line saying which it is. */
function ActorCardBody({ card }: { card: ActorCard }) {
  const kindLabel =
    card.kind === 'agent' ? 'Agent' : card.kind === 'module' ? 'Module' : (ROLES[card.role ?? ''] ?? 'Member');
  const face =
    card.kind === 'agent' ? (
      <AgentMark icon={card.icon} tile className="size-9" />
    ) : card.kind === 'module' ? (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-card-border">
        <Icon name="puzzle" className="size-4" />
      </span>
    ) : (
      <Avatar size="lg" className="size-9">
        {card.image ? <AvatarImage src={card.image} alt="" /> : null}
        <AvatarFallback className="text-xs">{initials(card.name)}</AvatarFallback>
      </Avatar>
    );

  return (
    <div className="flex flex-col gap-2.5" data-slot="actor-card">
      <div className="flex items-center gap-2.5">
        {face}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{card.name}</div>
          <div className="text-muted-foreground">{kindLabel}</div>
        </div>
      </div>
      {card.email ? <div className="truncate text-muted-foreground">{card.email}</div> : null}
      {card.description ? <p className="text-muted-foreground">{card.description}</p> : null}
    </div>
  );
}

/** What a name is wrapped in: resting on it says who it is. Without a card (a key, a workflow) it is left as it is. */
export function ActorHover({ card, children }: { card?: ActorCard | undefined; children: ReactNode }) {
  if (!card) {
    return <>{children}</>;
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={250}
        closeDelay={150}
        className="cursor-default underline decoration-transparent underline-offset-4 transition-colors hover:decoration-muted-foreground/60"
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent>
        <ActorCardBody card={card} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Who acted, as a sentence's subject: "Note taker for Robert Comanescu", each name with a card of its own. */
export function ActorName({ person, className }: { person: Person; className?: string }) {
  return (
    <span className={className}>
      {person.parts.map((part, index) => (
        <span key={`${index}-${part.name}`}>
          {index > 0 ? <span className="font-normal text-muted-foreground">{' for '}</span> : null}
          <ActorHover card={part.card}>{part.name}</ActorHover>
        </span>
      ))}
    </span>
  );
}
