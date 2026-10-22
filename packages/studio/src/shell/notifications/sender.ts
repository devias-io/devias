import type { Actor, Member } from '@devias/core';

const memberName = (members: ReadonlyMap<string, Member>, userId: string): string => {
  const user = members.get(userId)?.user;

  return user?.name || user?.email || 'Someone';
};

/**
 * Who sent a notification, for its meta line: a member by name; the agent (or an agent) or a module's code,
 * naming the person it acted for unless that is the reader; a workflow; the module behind an older action
 * (`acme.x` → "Module acme").
 */
export const senderOf = (
  actor: Actor,
  {
    members,
    agents,
    selfId,
    modules,
  }: {
    members: ReadonlyMap<string, Member>;
    agents: ReadonlyMap<string, string>;
    selfId: string;
    /** Module display names by id. */
    modules?: ReadonlyMap<string, string>;
  },
): string => {
  switch (actor.kind) {
    case 'user':
      return memberName(members, actor.id);
    case 'agent': {
      const agent = agents.get(actor.id) ?? 'An agent';
      const forId = actor.onBehalfOf?.id;

      return forId && forId !== selfId ? `${agent} for ${memberName(members, forId)}` : agent;
    }
    case 'module': {
      const module = modules?.get(actor.id) ?? `Module ${actor.id}`;
      const forId = actor.onBehalfOf?.id;

      return forId && forId !== selfId ? `${module} for ${memberName(members, forId)}` : module;
    }
    case 'workflow':
      return 'Workflow';
    case 'function':
      return `Module ${actor.id.split('.')[0] || actor.id}`;
    case 'api_key':
      return 'An API key';
    default:
      return 'System';
  }
};
