import { pgTable, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** The workspace's AI settings: its default agent, and whether its first agent was ever made. */

export const aiSettings = pgTable('ai_settings', {
  workspaceId: text().primaryKey(),
  /** The agent Home and "new conversation" use; null falls back to the first active agent by name. */
  defaultAgentId: text(),
  /** When the workspace's first agent was created; once set, archiving every agent never seeds another. */
  seededAt: timestamptz(),
  updatedAt: timestamptz().notNull().defaultNow(),
});
