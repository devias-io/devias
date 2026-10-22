import { isEventVisibleTo } from '@devias/core';
import type { DataEngine, EngineContext, Logger } from '@devias/data-engine';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

export interface SseHubOptions {
  engine: DataEngine;
  logger: Logger;
  heartbeatMs?: number;
  batchSize?: number;
}

/**
 * Server-sent events per workspace. Each connection first receives `event: ready` with the current
 * sequence, then the backlog after `after` (or `Last-Event-ID`), then live events as the bus rings;
 * every event carries `id: <sequence>` so clients resume exactly. Events the caller may not see (other people's
 * notification events, see `isEventVisibleTo`) are skipped, so a stream can have gaps in its ids.
 */
export const createSseHub = ({ engine, logger, heartbeatMs = 25_000, batchSize = 200 }: SseHubOptions) => {
  const connections = new Map<string, number>();

  const handle = (c: Context, ctx: EngineContext, after: number | undefined): Response => {
    const { workspaceId } = ctx;

    return streamSSE(
      c,
      async (stream) => {
        let closed = false;
        let last = 0;
        let pumping = false;
        let again = false;
        let finish: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });

        const pump = async () => {
          if (closed) {
            return;
          }

          if (pumping) {
            again = true;

            return;
          }

          pumping = true;

          try {
            do {
              again = false;
              let batch = await engine.events.readAfter(workspaceId, last, batchSize);

              while (batch.length > 0 && !closed) {
                for (const event of batch) {
                  if (isEventVisibleTo(event, ctx.actor)) {
                    await stream.writeSSE({
                      id: String(event.sequence),
                      event: event.type,
                      data: JSON.stringify(event),
                    });
                  }

                  last = event.sequence;
                }

                batch = batch.length === batchSize ? await engine.events.readAfter(workspaceId, last, batchSize) : [];
              }
            } while (again && !closed);
          } catch (error) {
            if (!closed) {
              logger.warn('sse pump failed', error);
            }
          } finally {
            pumping = false;
          }
        };

        const current = await engine.events.currentSequence(workspaceId);
        last = after ?? current;
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ sequence: current }) });

        const unsubscribe = engine.events.subscribe(workspaceId, () => {
          void pump();
        });
        const heartbeat = setInterval(() => {
          stream.write(': ping\n\n').catch(() => {});
        }, heartbeatMs);
        connections.set(workspaceId, (connections.get(workspaceId) ?? 0) + 1);

        stream.onAbort(() => {
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          connections.set(workspaceId, Math.max(0, (connections.get(workspaceId) ?? 1) - 1));
          finish();
        });

        try {
          await pump();
          await done;
        } finally {
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
        }
      },
      async (error) => {
        logger.warn('sse stream error', error);
      },
    );
  };

  return { handle, connectionCount: (workspaceId: string) => connections.get(workspaceId) ?? 0 };
};

export type SseHub = ReturnType<typeof createSseHub>;
