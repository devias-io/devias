import {
  type Actor,
  type DocumentChangedEvent,
  type TaskChangeAction,
  WORKFLOW_RUN_STATUSES,
  type WorkspaceEvent,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError } from '../errors';

/**
 * The per-workspace event log. Sequences are allocated under the `workspace_state` row lock, so they
 * are dense and commit-ordered; every writer takes the lock first, then allocates exactly as many
 * sequences as events it writes.
 */

export interface WorkspaceStateRow {
  eventSeq: number;
  metadataVersion: number;
}

export interface EventRow {
  sequence: number;
  type: WorkspaceEvent['type'];
  actor: Actor;
  occurredAt: Date;
  objectId?: string;
  objectName?: string;
  recordId?: string;
  changedFields?: string[];
  diff?: { before: unknown; after: unknown };
  metadataVersion?: number;
  moduleId?: string;
  /** metadata.changed: the entity kind. */
  entity?: string;
  /**
   * metadata.changed: the entity's id; workflow.*, document.changed and task.changed: the workflow's, document's or task's id;
   * notification.changed: the notification's id (absent when every one of a person's was marked read);
   * module.connected / disconnected / connection.failed: the connection's id.
   */
  entityId?: string;
  version?: string;
  /**
   * record.created and record.updated by an import: `{ importId }`; workflow.changed and document.changed: `{ action }`; task.changed: `{ action, changes?, status?, assignee?, runId? }`; workflow.run: `{ runId, status }`; module.connected and the other connection
   * events: `{ providerId }`; module.event: `{ eventType, eventId }`; notification.changed: `{ recipientId, action }`.
   */
  payload?: Record<string, unknown>;
}

/** Lock the workspace row for the rest of the transaction (serializes writers per workspace). */
export const lockWorkspace = async (tx: Db, workspaceId: string): Promise<WorkspaceStateRow> => {
  const rows = await runRaw<{ event_seq: unknown; metadata_version: unknown }>(
    tx,
    sql`SELECT event_seq, metadata_version FROM workspace_state WHERE workspace_id = ${workspaceId} FOR UPDATE`,
  );
  const row = rows[0];

  if (!row) {
    throw new EngineError('NOT_FOUND', `Workspace "${workspaceId}" is not initialized`);
  }

  return { eventSeq: toNumber(row.event_seq), metadataVersion: toNumber(row.metadata_version) };
};

/** Reserve `count` sequences; returns the first one. */
export const allocateSequences = async (tx: Db, workspaceId: string, count: number): Promise<number> => {
  if (count <= 0) {
    throw new Error('allocateSequences: count must be positive');
  }

  const rows = await runRaw<{ event_seq: unknown }>(
    tx,
    sql`UPDATE workspace_state SET event_seq = event_seq + ${count} WHERE workspace_id = ${workspaceId} RETURNING event_seq`,
  );
  const row = rows[0];

  if (!row) {
    throw new EngineError('NOT_FOUND', `Workspace "${workspaceId}" is not initialized`);
  }

  return toNumber(row.event_seq) - count + 1;
};

export const bumpMetadataVersion = async (tx: Db, workspaceId: string): Promise<number> => {
  const rows = await runRaw<{ metadata_version: unknown }>(
    tx,
    sql`UPDATE workspace_state SET metadata_version = metadata_version + 1 WHERE workspace_id = ${workspaceId} RETURNING metadata_version`,
  );
  const row = rows[0];

  if (!row) {
    throw new EngineError('NOT_FOUND', `Workspace "${workspaceId}" is not initialized`);
  }

  return toNumber(row.metadata_version);
};

const nullable = (value: unknown): unknown => (value === undefined ? null : value);
const json = (value: unknown): unknown => (value === undefined ? null : JSON.stringify(value));

export const writeEvents = async (tx: Db, workspaceId: string, events: EventRow[]): Promise<void> => {
  if (events.length === 0) {
    return;
  }

  const values = sql.join(
    events.map(
      (e) =>
        sql`(${workspaceId}, ${e.sequence}, ${uuidv7()}::uuid, ${e.type}, ${nullable(e.objectId)}, ${nullable(e.objectName)}, ${nullable(e.recordId)}::uuid, ${JSON.stringify(e.actor)}::jsonb, ${json(e.changedFields)}::jsonb, ${json(e.diff)}::jsonb, ${nullable(e.metadataVersion)}::int, ${nullable(e.moduleId)}, ${nullable(e.entity)}, ${nullable(e.entityId)}, ${nullable(e.version)}, ${json(e.payload)}::jsonb, ${e.occurredAt.toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  await runRaw(
    tx,
    sql`INSERT INTO event (workspace_id, sequence, id, type, object_id, object_name, record_id, actor, changed_fields, diff, metadata_version, module_id, entity, entity_id, version, payload, occurred_at) VALUES ${values}`,
  );
};

interface RawEventRow extends Record<string, unknown> {
  sequence: unknown;
  type: string;
  object_id: string | null;
  object_name: string | null;
  record_id: string | null;
  actor: unknown;
  changed_fields: unknown;
  metadata_version: unknown;
  module_id: string | null;
  entity: string | null;
  entity_id: string | null;
  version: string | null;
  payload: unknown;
  occurred_at: unknown;
}

export const rowToEvent = (workspaceId: string, row: RawEventRow): WorkspaceEvent => {
  const base = {
    sequence: toNumber(row.sequence),
    workspaceId,
    actor: parseJson<Actor>(row.actor),
    occurredAt: toIso(row.occurred_at),
  };

  switch (row.type) {
    case 'record.created':
    case 'record.updated':
    case 'record.deleted': {
      const changed = row.changed_fields === null ? undefined : parseJson<string[]>(row.changed_fields);
      const importId = row.payload === null ? undefined : parseJson<{ importId?: string }>(row.payload).importId;

      return {
        ...base,
        type: row.type,
        objectId: row.object_id ?? '',
        object: row.object_name ?? '',
        recordId: row.record_id ?? '',
        ...(changed ? { changedFields: changed } : {}),
        ...(importId ? { importId } : {}),
      };
    }
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      return {
        ...base,
        type: row.type,
        objectId: row.object_id ?? '',
        object: row.object_name ?? '',
        recordId: row.record_id ?? '',
        commentId: row.entity_id ?? '',
      };
    case 'metadata.changed':
      return {
        ...base,
        type: 'metadata.changed',
        entity: (row.entity ?? 'object') as 'object',
        entityId: row.entity_id ?? undefined,
        metadataVersion: toNumber(row.metadata_version),
      };
    case 'module.applied':
      return {
        ...base,
        type: 'module.applied',
        moduleId: row.module_id ?? '',
        version: row.version ?? '',
        metadataVersion: toNumber(row.metadata_version),
      };
    case 'workflow.changed': {
      const payload = row.payload === null ? {} : parseJson<{ action?: string }>(row.payload);

      return {
        ...base,
        type: 'workflow.changed',
        workflowId: row.entity_id ?? '',
        action: (payload.action ?? 'updated') as 'created' | 'updated' | 'deleted',
      };
    }
    case 'workflow.run': {
      const payload = row.payload === null ? {} : parseJson<{ runId?: string; status?: string }>(row.payload);

      return {
        ...base,
        type: 'workflow.run',
        workflowId: row.entity_id ?? '',
        runId: payload.runId ?? '',
        status: WORKFLOW_RUN_STATUSES.find((status) => status === payload.status) ?? 'succeeded',
      };
    }
    case 'document.changed': {
      const payload = row.payload === null ? {} : parseJson<{ action?: string }>(row.payload);

      return {
        ...base,
        type: 'document.changed',
        documentId: row.entity_id ?? '',
        action: (payload.action ?? 'updated') as DocumentChangedEvent['action'],
      };
    }
    case 'task.changed': {
      const payload =
        row.payload === null
          ? {}
          : parseJson<{
              action?: string;
              changes?: string[];
              status?: string;
              assignee?: string | null;
              runId?: string;
            }>(row.payload);

      return {
        ...base,
        type: 'task.changed',
        taskId: row.entity_id ?? '',
        action: (payload.action ?? 'updated') as TaskChangeAction,
        ...(payload.changes ? { changes: payload.changes } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.assignee !== undefined ? { assignee: payload.assignee } : {}),
        ...(payload.runId ? { runId: payload.runId } : {}),
      };
    }
    case 'module.connected':
    case 'module.disconnected':
    case 'module.connection.failed': {
      const payload = row.payload === null ? {} : parseJson<{ providerId?: string }>(row.payload);

      return {
        ...base,
        type: row.type,
        moduleId: row.module_id ?? '',
        connectionId: row.entity_id ?? '',
        providerId: payload.providerId ?? '',
      };
    }
    case 'module.event': {
      const payload = row.payload === null ? {} : parseJson<{ eventType?: string; eventId?: string }>(row.payload);

      return {
        ...base,
        type: 'module.event',
        moduleId: row.module_id ?? '',
        eventType: payload.eventType ?? '',
        eventId: payload.eventId ?? '',
      };
    }
    case 'notification.changed': {
      const payload = row.payload === null ? {} : parseJson<{ recipientId?: string; action?: string }>(row.payload);

      return {
        ...base,
        type: 'notification.changed',
        recipientId: payload.recipientId ?? '',
        notificationId: row.entity_id,
        action: payload.action === 'read' ? 'read' : payload.action === 'deleted' ? 'deleted' : 'created',
      };
    }
    default:
      throw new Error(`Unknown event type "${row.type}"`);
  }
};

const EVENT_COLUMNS = sql.raw(
  'sequence, type, object_id, object_name, record_id, actor, changed_fields, metadata_version, module_id, entity, entity_id, version, payload, occurred_at',
);

/** Events with sequence > `after`, ascending, at most `limit`. */
export const readEventsAfter = async (
  db: Db,
  workspaceId: string,
  after: number,
  limit: number,
): Promise<WorkspaceEvent[]> => {
  const rows = await runRaw<RawEventRow>(
    db,
    sql`SELECT ${EVENT_COLUMNS} FROM event WHERE workspace_id = ${workspaceId} AND sequence > ${after} ORDER BY sequence ASC LIMIT ${limit}`,
  );

  return rows.map((row) => rowToEvent(workspaceId, row));
};

export const currentSequence = async (db: Db, workspaceId: string): Promise<number> => {
  const rows = await runRaw<{ event_seq: unknown }>(
    db,
    sql`SELECT event_seq FROM workspace_state WHERE workspace_id = ${workspaceId}`,
  );

  return rows[0] ? toNumber(rows[0].event_seq) : 0;
};

/** The stored before/after data of one record event, or `null` when the event has none. */
export const readEventDiff = async (
  db: Db,
  workspaceId: string,
  sequence: number,
): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null } | null> => {
  const rows = await runRaw<{ diff: unknown }>(
    db,
    sql`SELECT diff FROM event WHERE workspace_id = ${workspaceId} AND sequence = ${sequence}`,
  );
  const row = rows[0];

  if (!row || row.diff === null || row.diff === undefined) {
    return null;
  }

  const diff = parseJson<{ before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }>(row.diff);

  return { before: diff.before ?? null, after: diff.after ?? null };
};
