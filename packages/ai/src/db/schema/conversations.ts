import type { AiUsage, ChatContext, InputRequest } from '@devias/core';
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { aiAgent } from './agents';
import { timestamptz } from './columns';

/** Conversations with agents: turns, messages and tool calls, as rows so approvals survive restarts and reconnects. */

const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

export const aiConversation = pgTable(
  'ai_conversation',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    userId: text().notNull(),
    /** The agent it is with. Agents are archived rather than deleted, so this never dangles. */
    agentId: text().notNull(),
    title: text(),
    /** The run it was made for, when an agent worked a task in it. */
    runId: uuid(),
    /** The running or paused turn; doubles as the lock that serializes turns per conversation. */
    activeTurnId: uuid(),
    usage: jsonb().$type<AiUsage>().notNull().default(ZERO_USAGE),
    /** Metadata version whose schema digest the model last received in this conversation. */
    schemaVersionSeen: integer(),
    lastMessageAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.agentId], foreignColumns: [aiAgent.workspaceId, aiAgent.id] }).onDelete(
      'restrict',
    ),
    index('ai_conversation_ws_user_idx').on(t.workspaceId, t.userId, t.updatedAt.desc()),
  ],
);

export const aiTurn = pgTable(
  'ai_turn',
  {
    id: uuid().primaryKey(),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    workspaceId: text().notNull(),
    /** running | awaiting_approval | completed | failed | cancelled */
    status: text().notNull().default('running'),
    iteration: integer().notNull().default(0),
    usage: jsonb().$type<AiUsage>().notNull().default(ZERO_USAGE),
    error: jsonb().$type<{ code: string; message: string }>(),
    stopReason: text(),
    startedAt: timestamptz().notNull().defaultNow(),
    finishedAt: timestamptz(),
  },
  (t) => [index('ai_turn_conversation_idx').on(t.conversationId), index('ai_turn_status_idx').on(t.status)],
);

export const aiMessage = pgTable(
  'ai_message',
  {
    id: uuid().primaryKey(),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    turnId: uuid().notNull(),
    workspaceId: text().notNull(),
    seq: integer().notNull(),
    /** user | assistant */
    role: text().notNull(),
    /** Content blocks exactly as sent to / returned by the model (thinking blocks included). */
    content: jsonb().$type<unknown[]>().notNull().default([]),
    /** For user messages: the text as typed, without the injected context block. */
    text: text(),
    context: jsonb().$type<ChatContext>(),
    model: text(),
    usage: jsonb().$type<AiUsage>(),
    stopReason: text(),
    partial: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [unique('ai_message_conversation_seq_uq').on(t.conversationId, t.seq)],
);

export const aiToolCall = pgTable(
  'ai_tool_call',
  {
    id: uuid().primaryKey(),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversation.id, { onDelete: 'cascade' }),
    turnId: uuid().notNull(),
    messageId: uuid().notNull(),
    workspaceId: text().notNull(),
    /** The model's `tool_use.id`. */
    toolUseId: text().notNull(),
    name: text().notNull(),
    input: jsonb().$type<unknown>(),
    /** pending | approved | rejected | running | executed | failed | declined */
    status: text().notNull().default('pending'),
    requiresApproval: boolean().notNull().default(false),
    result: jsonb().$type<unknown>(),
    isError: boolean().notNull().default(false),
    reason: text(),
    /** Fields the call waits for from the person (labels only; the values never reach the database). */
    inputRequest: jsonb().$type<InputRequest>(),
    resolvedAt: timestamptz(),
    executedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('ai_tool_call_conversation_tool_use_uq').on(t.conversationId, t.toolUseId),
    index('ai_tool_call_turn_status_idx').on(t.turnId, t.status),
    index('ai_tool_call_message_idx').on(t.messageId),
  ],
);
