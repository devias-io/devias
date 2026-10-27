import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** A workspace as the engine knows it: its change-feed position and the version of its data model. */

export const workspaceState = pgTable('workspace_state', {
  workspaceId: text().primaryKey(),
  eventSeq: bigint({ mode: 'number' }).notNull().default(0),
  metadataVersion: integer().notNull().default(0),
  createdAt: timestamptz().notNull().defaultNow(),
});
