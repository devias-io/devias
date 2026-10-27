import {
  type Actor,
  type InstalledModule,
  newId,
  WEBHOOK_EVENT_DEFAULT_LIMIT,
  WEBHOOK_EVENT_RETENTION,
  type WebhookEvent,
  type WebhookEventPage,
  type WebhookEventQuery,
  type WebhookResult,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso } from '../db/exec';
import { EngineError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, lockWorkspace, writeEvents } from '../events/feed';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';

/**
 * The events installed modules delivered through their webhooks: stored once per external id, announced on the change
 * feed for workflows, and pruned to the newest thousand per module. Verifying a delivery is the runtime's job.
 */
export interface WebhookEventsService {
  /** The module's events, newest first; page with `nextCursor`. */
  list(ctx: EngineContext, moduleId: string, query?: WebhookEventQuery): Promise<WebhookEventPage>;
  /**
   * Store webhook events (dropping ones whose external id arrived before) and announce them on the feed; the
   * connection that received them is stamped as used.
   */
  receive(
    workspaceId: string,
    moduleId: string,
    events: IncomingEvent[],
    connectionId?: string,
  ): Promise<WebhookResult & { events: WebhookEvent[] }>;
  get(workspaceId: string, id: string): Promise<WebhookEvent | null>;
}

export interface IncomingEvent {
  type: string;
  externalId?: string | undefined;
  payload: unknown;
}

export interface WebhookEventsServiceDeps {
  db: Db;
  bus: EventBus;
  clock: () => Date;
  metadata: Pick<MetadataService, 'getSnapshot'>;
  /** Events kept per module and workspace (default 1000). */
  retention?: number;
}

interface EventRow extends Record<string, unknown> {
  id: string;
  module_id: string;
  type: string;
  external_id: string | null;
  payload: unknown;
  received_at: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_COLUMNS = sql.raw('id, module_id, type, external_id, payload, received_at');

const toEvent = (row: EventRow): WebhookEvent => ({
  id: row.id,
  moduleId: row.module_id,
  type: row.type,
  externalId: row.external_id ?? null,
  payload: parseJson(row.payload) ?? null,
  receivedAt: toIso(row.received_at),
});

const eventActor = (moduleId: string): Actor => ({ kind: 'system', id: `module:${moduleId}` });

export const createWebhookEventsService = (deps: WebhookEventsServiceDeps): WebhookEventsService => {
  const { db, bus, clock, metadata } = deps;
  const retention = deps.retention ?? WEBHOOK_EVENT_RETENTION;
  const inserted = new Map<string, number>();

  /** The installed module, or NOT_FOUND. */
  const installed = async (workspaceId: string, moduleId: string): Promise<InstalledModule> => {
    const snapshot = await metadata.getSnapshot(workspaceId);
    const module = snapshot.schema.modules.find((candidate) => candidate.id === moduleId);

    if (!module) {
      throw new EngineError('NOT_FOUND', `Module "${moduleId}" is not installed in this workspace`);
    }

    return module;
  };

  const prune = async (workspaceId: string, moduleId: string) => {
    await runRaw(
      db,
      sql`DELETE FROM webhook_event WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}
          AND id NOT IN (SELECT id FROM webhook_event WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}
            ORDER BY id DESC LIMIT ${retention})`,
    );
  };

  return {
    list: async (ctx, moduleId, query = {}) => {
      authorize(ctx, 'module.read');
      await installed(ctx.workspaceId, moduleId);
      const limit = query.limit ?? WEBHOOK_EVENT_DEFAULT_LIMIT;

      if (query.cursor !== undefined && !UUID.test(query.cursor)) {
        throw new EngineError('INVALID_CURSOR', 'The events cursor is malformed');
      }

      // Event ids are time-ordered (uuid v7), so they page newest-first on their own.
      const rows = await runRaw<EventRow>(
        db,
        sql`SELECT ${EVENT_COLUMNS} FROM webhook_event
            WHERE workspace_id = ${ctx.workspaceId} AND module_id = ${moduleId}
            ${query.type === undefined ? sql`` : sql`AND type = ${query.type}`}
            ${query.cursor === undefined ? sql`` : sql`AND id < ${query.cursor}::uuid`}
            ORDER BY id DESC LIMIT ${limit + 1}`,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return { items: page.map(toEvent), nextCursor: rows.length > limit && last ? last.id : null };
    },

    receive: async (workspaceId, moduleId, incoming, connectionId) => {
      await installed(workspaceId, moduleId);

      if (incoming.length === 0) {
        return { received: 0, duplicates: 0, events: [] };
      }

      const now = clock();
      const outcome = await db.transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const stored: WebhookEvent[] = [];

        for (const event of incoming) {
          const id = newId();
          // The unique index on (workspace, module, external id) drops a second delivery of the same event.
          const rows = await runRaw<EventRow>(
            tx,
            sql`INSERT INTO webhook_event (id, workspace_id, module_id, type, external_id, payload, received_at)
                VALUES (${id}::uuid, ${workspaceId}, ${moduleId}, ${event.type}, ${event.externalId ?? null},
                  ${JSON.stringify(event.payload ?? null)}::jsonb, ${now.toISOString()}::timestamptz)
                ON CONFLICT (workspace_id, module_id, external_id) DO NOTHING
                RETURNING ${EVENT_COLUMNS}`,
          );

          if (rows[0]) {
            stored.push(toEvent(rows[0]));
          }
        }

        if (connectionId) {
          await runRaw(
            tx,
            sql`UPDATE connection SET last_used_at = ${now.toISOString()}::timestamptz
                WHERE workspace_id = ${workspaceId} AND id = ${connectionId}::uuid`,
          );
        }

        let sequence: number | null = null;

        if (stored.length > 0) {
          const first = await allocateSequences(tx, workspaceId, stored.length);
          await writeEvents(
            tx,
            workspaceId,
            stored.map((event, i) => ({
              sequence: first + i,
              type: 'module.event' as const,
              actor: eventActor(moduleId),
              occurredAt: now,
              moduleId,
              payload: { eventType: event.type, eventId: event.id },
            })),
          );
          sequence = first + stored.length - 1;
          await bus.publish(tx, workspaceId, { seq: sequence });
        }

        return { stored, sequence };
      });

      if (outcome.sequence !== null) {
        bus.emitLocal(workspaceId, { seq: outcome.sequence });
      }

      const key = `${workspaceId}:${moduleId}`;
      const count = (inserted.get(key) ?? 0) + outcome.stored.length;
      inserted.set(key, count % 100);

      if (Math.floor(count / 100) > 0) {
        await prune(workspaceId, moduleId);
      }

      return {
        received: outcome.stored.length,
        duplicates: incoming.length - outcome.stored.length,
        events: outcome.stored,
      };
    },

    get: async (workspaceId, id) => {
      if (!UUID.test(id)) {
        return null;
      }

      const rows = await runRaw<EventRow>(
        db,
        sql`SELECT ${EVENT_COLUMNS} FROM webhook_event WHERE workspace_id = ${workspaceId} AND id = ${id}::uuid`,
      );

      return rows[0] ? toEvent(rows[0]) : null;
    },
  };
};
