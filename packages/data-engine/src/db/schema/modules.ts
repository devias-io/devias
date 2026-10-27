import { index, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Installed modules and the events they deliver. */

export const module = pgTable(
  'module',
  {
    workspaceId: text().notNull(),
    id: text().notNull(),
    version: text().notNull(),
    manifestHash: text().notNull(),
    manifest: jsonb().$type<Record<string, unknown>>().notNull(),
    installedAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    installedBy: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] })],
);

/** One event a module delivered through its webhook; the payload is what the outside service sent, verified. */
export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    moduleId: text().notNull(),
    type: text().notNull(),
    /** The outside service's own event id; a second delivery of the same id is dropped. */
    externalId: text(),
    payload: jsonb().$type<unknown>(),
    receivedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('webhook_event_ws_module_idx').on(t.workspaceId, t.moduleId, t.id.desc()),
    unique('webhook_event_ws_module_external_uq').on(t.workspaceId, t.moduleId, t.externalId),
  ],
);
