import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { type Db, runRaw } from '../db/exec';
import type { Logger } from '../logger';
import { silentLogger } from '../logger';

/**
 * The bus is a doorbell, not a queue: it tells subscribers "workspace X has events up to sequence N";
 * they then read the durable `event` log. Duplicate or lost doorbells are harmless because
 * consumers poll the log by sequence.
 */
export interface BusPayload {
  seq: number;
}

export type BusListener = (payload: BusPayload) => void;
export type BusAllListener = (workspaceId: string, payload: BusPayload) => void;

export interface EventBus {
  /** Called inside the writing transaction; delivered to other processes after commit. */
  publish(tx: Db, workspaceId: string, payload: BusPayload): Promise<void>;
  /** Called after commit in the writing process. */
  emitLocal(workspaceId: string, payload: BusPayload): void;
  subscribe(workspaceId: string, listener: BusListener): () => void;
  subscribeAll(listener: BusAllListener): () => void;
  close(): Promise<void>;
}

/** Single NOTIFY channel; the workspace travels in the payload. */
export const NOTIFY_CHANNEL = 'devias_events';

const emitterFor = (emitter: EventEmitter) => ({
  emit: (workspaceId: string, payload: BusPayload) => {
    emitter.emit(`ws:${workspaceId}`, payload);
    emitter.emit('*', workspaceId, payload);
  },
  subscribe: (workspaceId: string, listener: BusListener) => {
    const key = `ws:${workspaceId}`;
    emitter.on(key, listener);

    return () => {
      emitter.off(key, listener);
    };
  },
  subscribeAll: (listener: BusAllListener) => {
    emitter.on('*', listener);

    return () => {
      emitter.off('*', listener);
    };
  },
});

/** In-process bus: correct on its own for a single server process (including PGlite). */
export const createLocalBus = (): EventBus => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const local = emitterFor(emitter);

  return {
    publish: async () => {},
    emitLocal: local.emit,
    subscribe: local.subscribe,
    subscribeAll: local.subscribeAll,
    close: async () => {
      emitter.removeAllListeners();
    },
  };
};

export interface PgNotifyBusOptions {
  /** Creates a fresh, dedicated pg Client for LISTEN (the bus connects and reconnects it). */
  createClient: () => Client;
  logger?: Logger;
  reconnectDelayMs?: number;
}

/**
 * Multi-process bus over Postgres LISTEN/NOTIFY with a dedicated client and reconnects. Local
 * subscribers still get `emitLocal` immediately; the NOTIFY from our own transaction arrives too,
 * which is fine for a doorbell.
 */
export const createPgNotifyBus = (options: PgNotifyBusOptions): EventBus => {
  const logger = options.logger ?? silentLogger;
  const delay = options.reconnectDelayMs ?? 1000;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const local = emitterFor(emitter);
  let client: Client | null = null;
  let closed = false;
  let connecting: Promise<void> | null = null;

  const handleNotification = (raw: string | undefined) => {
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { ws?: string; seq?: number };

      if (typeof parsed.ws === 'string' && typeof parsed.seq === 'number') {
        local.emit(parsed.ws, { seq: parsed.seq });
      }
    } catch (error) {
      logger.warn('pg notify payload could not be parsed', error);
    }
  };

  const connect = async (): Promise<void> => {
    if (closed) {
      return;
    }

    const next = options.createClient();
    next.on('notification', (message) => handleNotification(message.payload));
    next.on('error', (error) => {
      logger.warn('pg listen client error; reconnecting', error);
      scheduleReconnect();
    });
    next.on('end', () => {
      if (!closed) {
        scheduleReconnect();
      }
    });
    await next.connect();
    await next.query(`LISTEN ${NOTIFY_CHANNEL}`);
    client = next;
  };

  const scheduleReconnect = () => {
    if (closed || connecting) {
      return;
    }

    client = null;
    connecting = new Promise<void>((resolve) => {
      setTimeout(() => {
        connecting = null;
        connect()
          .catch((error) => {
            logger.warn('pg listen reconnect failed', error);
            scheduleReconnect();
          })
          .finally(resolve);
      }, delay).unref();
    });
  };

  const ready = connect().catch((error) => {
    logger.warn('pg listen initial connect failed', error);
    scheduleReconnect();
  });

  return {
    publish: async (tx, workspaceId, payload) => {
      await runRaw(
        tx,
        sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify({ ws: workspaceId, seq: payload.seq })})`,
      );
    },
    emitLocal: local.emit,
    subscribe: local.subscribe,
    subscribeAll: local.subscribeAll,
    close: async () => {
      closed = true;
      await ready;
      emitter.removeAllListeners();
      const current = client;
      client = null;

      if (current) {
        await current.end().catch(() => {});
      }
    },
  };
};
