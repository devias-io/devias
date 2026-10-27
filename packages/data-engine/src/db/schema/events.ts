import { bigint, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/**
 * The workspace's event log: everything that changed, in one dense order per workspace (`sequence`). The change feed,
 * the live stream and the workflow cursors read it; so do the histories and timelines of records, tasks and documents,
 * which show what an event stored (`diff`, `payload`) through their own services. What the feed returns is a whitelist
 * of these columns (`rowToEvent`), so the log can hold what a timeline needs without the feed ever carrying it.
 * `sequence` is the position and the cursor, unique within a workspace; `id` is the identity.
 */
export const event = pgTable(
  'event',
  {
    /** The event's own identity, a uuid v7 made as it is written: what `/events/{id}` and an export name it by. */
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    sequence: bigint({ mode: 'number' }).notNull(),
    type: text().notNull(),
    objectId: text(),
    objectName: text(),
    recordId: uuid(),
    actor: jsonb().$type<{ kind: string; id: string }>().notNull(),
    changedFields: jsonb().$type<string[]>(),
    diff: jsonb().$type<{ before: unknown; after: unknown }>(),
    metadataVersion: integer(),
    moduleId: text(),
    /** metadata.changed: which entity kind changed and its id. module.applied: `version`. workflow.*: `entityId` is the workflow. */
    entity: text(),
    entityId: text(),
    version: text(),
    /** workflow.changed: `{ action }`; workflow.run: `{ runId, status }`. */
    payload: jsonb().$type<Record<string, unknown>>(),
    occurredAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('event_workspace_id_sequence_unique').on(t.workspaceId, t.sequence),
    index('event_ws_record_idx').on(t.workspaceId, t.recordId, t.sequence),
    index('event_ws_entity_idx').on(t.workspaceId, t.entity, t.entityId, t.sequence),
  ],
);
