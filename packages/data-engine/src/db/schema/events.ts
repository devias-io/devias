import { bigint, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/**
 * The workspace's event log: everything that changed, in one dense order per workspace (`sequence`). The change feed,
 * the live stream and the workflow cursors read it; so do the histories and timelines of records, tasks and documents,
 * which show what an event stored (`diff`, `payload`) through their own services. What the feed returns is a whitelist
 * of these columns (`rowToEvent`), so the log can hold what a timeline needs without the feed ever carrying it.
 */
export const event = pgTable(
  'event',
  {
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
    primaryKey({ columns: [t.workspaceId, t.sequence] }),
    index('event_ws_record_idx').on(t.workspaceId, t.recordId, t.sequence),
    index('event_ws_entity_idx').on(t.workspaceId, t.entity, t.entityId, t.sequence),
  ],
);
