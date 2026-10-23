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
    /** Ids of the skills it may use; null means every active skill. */
    skills: jsonb().$type<string[] | null>(),
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

/** A skill: a procedure agents load when a request calls for it. Archived, never deleted, so an agent's list stays honest. */
export const aiSkill = pgTable(
  'ai_skill',
  {
    workspaceId: text().notNull(),
    /** `workspace.<uuid>` for a skill the workspace wrote, `<module>.<key>` for one a module ships. */
    id: text().notNull(),
    title: text().notNull(),
    /** One line saying when to use it: what an agent sees before it loads the body. */
    description: text().notNull(),
    /** The procedure, as Markdown. */
    body: text().notNull(),
    /** The module that ships it; null for a skill the workspace wrote. Its title, description and body are the module's. */
    moduleId: text(),
    /** Set when archived: no agent lists or loads it. */
    archivedAt: timestamptz(),
    /** Archived because its module was uninstalled, so installing the module again restores it. */
    archivedByModule: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('ai_skill_ws_idx').on(t.workspaceId, t.title), primaryKey({ columns: [t.workspaceId, t.id] })],
);
