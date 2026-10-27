import { isEventVisibleTo, type WorkspaceEvent } from '@devias/core';
import type { EngineContext } from '../context';
import type { Db } from '../db/exec';
import { authorize } from '../permissions/policy';
import type { BusAllListener, BusListener, EventBus } from './bus';
import { currentSequence, readEventDiff, readEventsAfter } from './feed';

export const EVENT_PAGE_MAX = 500;

export interface EventService {
  /**
   * Events after `after` (exclusive), ascending, minus the ones the caller may not see (other people's notification
   * events, see `isEventVisibleTo`); requires `event.read`.
   */
  list(ctx: EngineContext, options: { after: number; limit?: number }): Promise<WorkspaceEvent[]>;
  current(ctx: EngineContext): Promise<number>;
  /** Internal readers (SSE hub, trigger runner). */
  readAfter(workspaceId: string, after: number, limit?: number): Promise<WorkspaceEvent[]>;
  /** The before/after data stored with a record event (internal: workflow conditions on deletions). */
  diffOf(
    workspaceId: string,
    sequence: number,
  ): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null } | null>;
  currentSequence(workspaceId: string): Promise<number>;
  subscribe(workspaceId: string, listener: BusListener): () => void;
  subscribeAll(listener: BusAllListener): () => void;
}

export const createEventService = (db: Db, bus: EventBus): EventService => ({
  list: async (ctx, { after, limit }) => {
    authorize(ctx, 'event.read');
    const wanted = Math.min(limit ?? 100, EVENT_PAGE_MAX);
    const visible: WorkspaceEvent[] = [];
    let cursor = after;

    // Events the caller may not see are skipped, so keep reading until the page is full or the log ends: a short
    // page then means the end of the log, as callers expect.
    while (visible.length < wanted) {
      const batch = await readEventsAfter(db, ctx.workspaceId, cursor, wanted);
      const last = batch.at(-1);

      if (!last) {
        break;
      }

      for (const event of batch) {
        if (isEventVisibleTo(event, ctx.actor)) {
          visible.push(event);
        }
      }

      cursor = last.sequence;

      if (batch.length < wanted) {
        break;
      }
    }

    return visible.slice(0, wanted);
  },
  current: async (ctx) => {
    authorize(ctx, 'event.read');

    return currentSequence(db, ctx.workspaceId);
  },
  readAfter: (workspaceId, after, limit) =>
    readEventsAfter(db, workspaceId, after, Math.min(limit ?? 100, EVENT_PAGE_MAX)),
  diffOf: (workspaceId, sequence) => readEventDiff(db, workspaceId, sequence),
  currentSequence: (workspaceId) => currentSequence(db, workspaceId),
  subscribe: (workspaceId, listener) => bus.subscribe(workspaceId, listener),
  subscribeAll: (listener) => bus.subscribeAll(listener),
});
