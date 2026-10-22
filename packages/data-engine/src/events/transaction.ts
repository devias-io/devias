import type { Actor } from '@devias/core';
import type { EngineContext } from '../context';
import type { Db } from '../db/exec';
import type { EventBus } from './bus';
import { allocateSequences, type EventRow, lockWorkspace, writeEvents } from './feed';

export interface EventTransactionDeps {
  db: Db;
  bus: EventBus;
  clock: () => Date;
}

/** An event as a write names it: the engine fills in the sequence, the actor and the time. */
export type EventDraft = Omit<EventRow, 'sequence' | 'actor' | 'occurredAt'> & {
  /** Who the event is about when it is not the caller: an agent's run the platform records. */
  actor?: Actor;
};

/**
 * One transaction for a write and the events it makes: the workspace lock, the write, a dense sequence for each
 * event and the doorbell. `write` returns the events it caused (usually one) along with its value.
 */
export const inEventTransaction = async <T>(
  deps: EventTransactionDeps,
  ctx: EngineContext,
  write: (tx: Db, now: Date) => Promise<{ value: T; events: EventDraft[] }>,
): Promise<T> => {
  const { db, bus, clock } = deps;
  const now = clock();
  const { value, last } = await db.transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const written = await write(tx, now);

    if (written.events.length === 0) {
      return { value: written.value, last: null };
    }

    const first = await allocateSequences(tx, ctx.workspaceId, written.events.length);
    await writeEvents(
      tx,
      ctx.workspaceId,
      written.events.map((event, i) => ({
        ...event,
        sequence: first + i,
        actor: event.actor ?? ctx.actor,
        occurredAt: now,
      })),
    );
    const sequence = first + written.events.length - 1;
    await bus.publish(tx, ctx.workspaceId, { seq: sequence });

    return { value: written.value, last: sequence };
  });

  if (last !== null) {
    bus.emitLocal(ctx.workspaceId, { seq: last });
  }

  return value;
};
