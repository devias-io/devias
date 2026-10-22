import type { ApprovalMode } from '@devias/core';
import { boolean, index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Agents. */

/** An agent: the runtime shaped by these columns. Archived, never deleted, so conversations keep their agent. */
export const aiAgent = pgTable(
  'ai_agent',
  {
    workspaceId: text().notNull(),
    /** `workspace.<uuid>` for an agent the workspace made, `<module>.<key>` for one a module ships (the key an update finds it by). */
    id: text().notNull(),
    name: text().notNull(),
    icon: text(),
    description: text(),
    /** Added to the system prompt of its conversations. */
    instructions: text(),
    /** Tool names it may use; null means every tool the person may use. */
    tools: jsonb().$type<string[] | null>(),
    /** The end of "I want to …" it suggests on Home and in an empty conversation. */
    starterPrompts: jsonb().$type<string[]>().notNull().default([]),
    /** Its approval modes, on top of the workspace's overrides. */
    approvalOverrides: jsonb().$type<Record<string, ApprovalMode>>().notNull().default({}),
    /** Whether tasks can be assigned to it, for it to work on its own. */
    takesTasks: boolean().notNull().default(false),
    /** The module that ships it; null for an agent the workspace made. Its name, instructions and tools are the module's. */
    moduleId: text(),
    /** Set when archived: it takes no new messages. */
    archivedAt: timestamptz(),
    /** Archived because its module was uninstalled, so installing the module again restores it. */
    archivedByModule: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('ai_agent_ws_idx').on(t.workspaceId, t.name), primaryKey({ columns: [t.workspaceId, t.id] })],
);
