import { type Actor, personOf } from '@devias/core';
import type { EngineContext } from './context';

/** Who may change what someone wrote: its author and admins. */

/** The same author: the same actor, or the same person behind it (a note the agent wrote for them is theirs). */
export const sameActor = (a: Actor, b: Actor): boolean => {
  const person = personOf(a);

  return person !== null ? person === personOf(b) : a.kind === b.kind && a.id === b.id;
};

export const isAdmin = (ctx: EngineContext): boolean =>
  ctx.actor.kind === 'system' || ctx.role === 'owner' || ctx.role === 'admin';
