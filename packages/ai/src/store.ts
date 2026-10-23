import {
  type AiAgent,
  type AiSettings,
  type AiSkill,
  type AiSkillSummary,
  type AiTurn,
  type AiUsage,
  addUsage,
  type ChatMessage,
  type Conversation,
  type DisplayBlock,
  emptyUsage,
  type TaskRun,
  type ToolCall,
  type ToolCallStatus,
  type TurnStatus,
} from '@devias/core';
import type { Db } from '@devias/data-engine';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, notInArray, sql } from 'drizzle-orm';
import { aiAgent, aiConversation, aiMessage, aiRun, aiSettings, aiSkill, aiToolCall, aiTurn } from './db/schema';
import {
  type ContentBlock,
  isRedactedThinkingBlock,
  isTextBlock,
  isThinkingBlock,
  isToolUseBlock,
} from './model/types';

/** Persistence for conversations, turns, messages, tool calls and settings, plus the DTO mappers. */

export type ConversationRow = typeof aiConversation.$inferSelect;
export type TurnRow = typeof aiTurn.$inferSelect;
export type MessageRow = typeof aiMessage.$inferSelect;
export type ToolCallRow = typeof aiToolCall.$inferSelect;
export type SettingsRow = typeof aiSettings.$inferSelect;
export type AgentRow = typeof aiAgent.$inferSelect;
export type RunRow = typeof aiRun.$inferSelect;
export type SkillRow = typeof aiSkill.$inferSelect;

export const toTaskRun = (row: RunRow): TaskRun => ({
  id: row.id,
  taskId: row.taskId,
  agentId: row.agentId,
  conversationId: row.conversationId,
  status: row.status as TaskRun['status'],
  attempt: row.attempt,
  requestedBy: row.requestedBy,
  summary: row.summary,
  error: row.error,
  startedAt: row.startedAt.toISOString(),
  finishedAt: iso(row.finishedAt),
});

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export const toAgent = (row: AgentRow): AiAgent => ({
  workspaceId: row.workspaceId,
  name: row.name,
  icon: row.icon,
  description: row.description,
  instructions: row.instructions,
  tools: row.tools ?? null,
  starterPrompts: row.starterPrompts ?? [],
  approvalOverrides: row.approvalOverrides ?? {},
  skills: row.skills ?? null,
  takesTasks: row.takesTasks,
  moduleId: row.moduleId,
  id: row.id,
  archivedAt: iso(row.archivedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toSkillSummary = (row: SkillRow): AiSkillSummary => ({
  workspaceId: row.workspaceId,
  id: row.id,
  title: row.title,
  description: row.description,
  moduleId: row.moduleId,
  archivedAt: iso(row.archivedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toSkill = (row: SkillRow): AiSkill => ({ ...toSkillSummary(row), body: row.body });

export const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  userId: row.userId,
  agentId: row.agentId,
  title: row.title,
  activeTurnId: row.activeTurnId,
  usage: row.usage ?? emptyUsage(),
  lastMessageAt: iso(row.lastMessageAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toTurn = (row: TurnRow): AiTurn => ({
  id: row.id,
  conversationId: row.conversationId,
  status: row.status as TurnStatus,
  iteration: row.iteration,
  usage: row.usage ?? emptyUsage(),
  error: row.error ?? null,
  startedAt: row.startedAt.toISOString(),
  finishedAt: iso(row.finishedAt),
});

export const toToolCall = (row: ToolCallRow): ToolCall => ({
  id: row.id,
  toolUseId: row.toolUseId,
  name: row.name,
  input: row.input,
  status: row.status as ToolCallStatus,
  requiresApproval: row.requiresApproval,
  ...(row.result !== null && row.result !== undefined ? { result: row.result } : {}),
  ...(row.isError ? { isError: true } : {}),
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  ...(row.executedAt ? { executedAt: row.executedAt.toISOString() } : {}),
  ...(row.inputRequest ? { inputRequest: row.inputRequest } : {}),
});

/** The studio's view of a stored message: assistant blocks in order with their tool calls joined in. */
export const toChatMessage = (row: MessageRow, calls: ToolCallRow[]): ChatMessage => {
  const blocks: DisplayBlock[] = [];

  if (row.role === 'user') {
    blocks.push({ type: 'text', text: row.text ?? '' });
  } else {
    const byToolUse = new Map(calls.map((c) => [c.toolUseId, c]));

    for (const block of (row.content ?? []) as ContentBlock[]) {
      if (isTextBlock(block)) {
        if (block.text) {
          blocks.push({ type: 'text', text: block.text });
        }
      } else if (isThinkingBlock(block)) {
        if (block.thinking) {
          blocks.push({ type: 'thinking', text: block.thinking });
        }
      } else if (isRedactedThinkingBlock(block)) {
        blocks.push({ type: 'thinking', text: '' });
      } else if (isToolUseBlock(block)) {
        const call = byToolUse.get(block.id);
        blocks.push({
          type: 'tool_use',
          toolCall: call
            ? toToolCall(call)
            : {
                id: block.id,
                toolUseId: block.id,
                name: block.name,
                input: block.input,
                status: 'declined',
                requiresApproval: false,
              },
        });
      }
    }
  }

  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    seq: row.seq,
    role: row.role as 'user' | 'assistant',
    blocks,
    ...(row.role === 'user' && row.text !== null ? { text: row.text } : {}),
    ...(row.context ? { context: row.context } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.usage ? { usage: row.usage } : {}),
    ...(row.stopReason !== null ? { stopReason: row.stopReason } : {}),
    ...(row.partial ? { partial: true } : {}),
    createdAt: row.createdAt.toISOString(),
  };
};

export const toSettings = (row: SettingsRow | undefined): AiSettings => ({
  defaultAgentId: row?.defaultAgentId ?? null,
  updatedAt: row ? row.updatedAt.toISOString() : null,
});

const ACTIVE_CALL_STATUSES = ['pending', 'approved', 'running'];

/** Ids are uuids; anything else cannot match a row, and Postgres would refuse to compare it. */
const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const createAiStore = (db: Db, clock: () => Date = () => new Date()) => {
  const one = <T>(rows: T[]): T | undefined => rows[0];

  const conversations = {
    create: async (
      workspaceId: string,
      userId: string,
      id: string,
      title: string | null,
      agentId: string,
      runId: string | null = null,
    ): Promise<ConversationRow> => {
      const now = clock();
      const rows = await db
        .insert(aiConversation)
        .values({ id, workspaceId, userId, agentId, title, runId, usage: emptyUsage(), createdAt: now, updatedAt: now })
        .returning();

      return rows[0] as ConversationRow;
    },
    /** Conversations and the tokens they used, per agent, over everyone's conversations in the workspace. */
    usageByAgent: async (
      workspaceId: string,
    ): Promise<Map<string, { conversations: number; usage: AiUsage; lastMessageAt: string | null }>> => {
      const total = (key: keyof AiUsage) => sql<string>`coalesce(sum((${aiConversation.usage}->>${key})::bigint), 0)`;
      const rows = await db
        .select({
          agentId: aiConversation.agentId,
          conversations: count(),
          inputTokens: total('inputTokens'),
          outputTokens: total('outputTokens'),
          cacheReadInputTokens: total('cacheReadInputTokens'),
          cacheCreationInputTokens: total('cacheCreationInputTokens'),
          lastMessageAt: max(aiConversation.lastMessageAt),
        })
        .from(aiConversation)
        .where(eq(aiConversation.workspaceId, workspaceId))
        .groupBy(aiConversation.agentId);

      return new Map(
        rows.map((row) => [
          row.agentId,
          {
            conversations: Number(row.conversations),
            usage: {
              inputTokens: Number(row.inputTokens),
              outputTokens: Number(row.outputTokens),
              cacheReadInputTokens: Number(row.cacheReadInputTokens),
              cacheCreationInputTokens: Number(row.cacheCreationInputTokens),
            },
            lastMessageAt: iso(row.lastMessageAt),
          },
        ]),
      );
    },
    /**
     * One agent's replies, tokens and new conversations per day, from `firstDay` (`YYYY-MM-DD`) on, with the days
     * counted in `tz`. Days without activity are left out.
     */
    activityByDay: async (
      workspaceId: string,
      agentId: string,
      firstDay: string,
      tz: string,
    ): Promise<Map<string, { conversations: number; messages: number; inputTokens: number; outputTokens: number }>> => {
      // The first day's midnight in the time zone.
      const since = sql`(${firstDay}::date::timestamp AT TIME ZONE ${tz})`;
      const tokens = (key: keyof AiUsage) => sql<string>`coalesce(sum((${aiMessage.usage}->>${key})::bigint), 0)`;
      // Grouped by position: the same expression with its own bind parameters would not match the selected one.
      const replies = await db
        .select({
          day: sql<string>`to_char(${aiMessage.createdAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
          messages: count(),
          inputTokens: tokens('inputTokens'),
          outputTokens: tokens('outputTokens'),
        })
        .from(aiMessage)
        .innerJoin(aiConversation, eq(aiConversation.id, aiMessage.conversationId))
        .where(
          and(
            eq(aiConversation.workspaceId, workspaceId),
            eq(aiConversation.agentId, agentId),
            eq(aiMessage.role, 'assistant'),
            sql`${aiMessage.createdAt} >= ${since}`,
          ),
        )
        .groupBy(sql`1`);
      const started = await db
        .select({
          day: sql<string>`to_char(${aiConversation.createdAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
          conversations: count(),
        })
        .from(aiConversation)
        .where(
          and(
            eq(aiConversation.workspaceId, workspaceId),
            eq(aiConversation.agentId, agentId),
            sql`${aiConversation.createdAt} >= ${since}`,
          ),
        )
        .groupBy(sql`1`);
      const days = new Map<
        string,
        { conversations: number; messages: number; inputTokens: number; outputTokens: number }
      >();
      const day = (key: string) => {
        const existing = days.get(key) ?? { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 };
        days.set(key, existing);

        return existing;
      };

      for (const row of replies) {
        Object.assign(day(row.day), {
          messages: Number(row.messages),
          inputTokens: Number(row.inputTokens),
          outputTokens: Number(row.outputTokens),
        });
      }

      for (const row of started) {
        day(row.day).conversations = Number(row.conversations);
      }

      return days;
    },
    list: (workspaceId: string, userId: string, limit: number): Promise<ConversationRow[]> =>
      db
        .select()
        .from(aiConversation)
        .where(and(eq(aiConversation.workspaceId, workspaceId), eq(aiConversation.userId, userId)))
        .orderBy(desc(aiConversation.updatedAt), desc(aiConversation.id))
        .limit(limit),
    get: async (workspaceId: string, id: string): Promise<ConversationRow | undefined> =>
      isUuid(id)
        ? one(
            await db
              .select()
              .from(aiConversation)
              .where(and(eq(aiConversation.workspaceId, workspaceId), eq(aiConversation.id, id)))
              .limit(1),
          )
        : undefined,
    delete: async (workspaceId: string, id: string): Promise<boolean> => {
      const rows = await db
        .delete(aiConversation)
        .where(and(eq(aiConversation.workspaceId, workspaceId), eq(aiConversation.id, id)))
        .returning({ id: aiConversation.id });

      return rows.length > 0;
    },
    update: async (
      id: string,
      patch: Partial<Pick<ConversationRow, 'title' | 'schemaVersionSeen' | 'lastMessageAt'>>,
    ): Promise<void> => {
      await db
        .update(aiConversation)
        .set({ ...patch, updatedAt: clock() })
        .where(eq(aiConversation.id, id));
    },
    addUsage: async (id: string, usage: AiUsage): Promise<void> => {
      const row = await conversations.get_(id);

      if (!row) {
        return;
      }

      await db
        .update(aiConversation)
        .set({ usage: addUsage(row.usage ?? emptyUsage(), usage), updatedAt: clock() })
        .where(eq(aiConversation.id, id));
    },
    get_: async (id: string): Promise<ConversationRow | undefined> =>
      one(await db.select().from(aiConversation).where(eq(aiConversation.id, id)).limit(1)),
    /** Take the per-conversation lock; false when another turn holds it. */
    claim: async (id: string, turnId: string): Promise<boolean> => {
      const rows = await db
        .update(aiConversation)
        .set({ activeTurnId: turnId, updatedAt: clock() })
        .where(and(eq(aiConversation.id, id), isNull(aiConversation.activeTurnId)))
        .returning({ id: aiConversation.id });

      return rows.length > 0;
    },
    /** Release the lock if this turn still holds it (idempotent). */
    release: async (id: string, turnId: string): Promise<void> => {
      await db
        .update(aiConversation)
        .set({ activeTurnId: null, updatedAt: clock() })
        .where(and(eq(aiConversation.id, id), eq(aiConversation.activeTurnId, turnId)));
    },
  };

  const runs = {
    insert: async (row: {
      id: string;
      workspaceId: string;
      taskId: string;
      agentId: string;
      conversationId: string;
      attempt: number;
      requestedBy: string;
    }): Promise<RunRow> => {
      const rows = await db
        .insert(aiRun)
        .values({ ...row, status: 'running', startedAt: clock() })
        .returning();

      return rows[0] as RunRow;
    },
    get: async (id: string): Promise<RunRow | undefined> => {
      const rows = await db.select().from(aiRun).where(eq(aiRun.id, id)).limit(1);

      return rows[0];
    },
    /** A task's runs, newest first. */
    listByTask: (workspaceId: string, taskId: string): Promise<RunRow[]> =>
      db
        .select()
        .from(aiRun)
        .where(and(eq(aiRun.workspaceId, workspaceId), eq(aiRun.taskId, taskId)))
        .orderBy(desc(aiRun.startedAt), desc(aiRun.id)),
    /** The runs that have not ended, in every workspace. */
    listOpen: (): Promise<RunRow[]> =>
      db
        .select()
        .from(aiRun)
        .where(inArray(aiRun.status, ['running', 'awaiting_review'])),
    update: async (
      id: string,
      patch: Partial<Pick<RunRow, 'status' | 'summary' | 'error' | 'finishedAt'>>,
    ): Promise<RunRow | undefined> => {
      const rows = await db.update(aiRun).set(patch).where(eq(aiRun.id, id)).returning();

      return rows[0];
    },
  };

  const turns = {
    insert: async (row: { id: string; conversationId: string; workspaceId: string }): Promise<TurnRow> => {
      const rows = await db
        .insert(aiTurn)
        .values({ ...row, status: 'running', iteration: 0, usage: emptyUsage(), startedAt: clock() })
        .returning();

      return rows[0] as TurnRow;
    },
    get: async (id: string): Promise<TurnRow | undefined> =>
      one(await db.select().from(aiTurn).where(eq(aiTurn.id, id)).limit(1)),
    delete: async (id: string): Promise<void> => {
      await db.delete(aiTurn).where(eq(aiTurn.id, id));
    },
    update: async (
      id: string,
      patch: Partial<Pick<TurnRow, 'status' | 'iteration' | 'usage' | 'error' | 'stopReason' | 'finishedAt'>>,
    ): Promise<TurnRow | undefined> => one(await db.update(aiTurn).set(patch).where(eq(aiTurn.id, id)).returning()),
    /** Compare-and-set on status; undefined when the turn was not in one of `from`. */
    cas: async (
      id: string,
      from: TurnStatus[],
      patch: Partial<Pick<TurnRow, 'status' | 'error' | 'stopReason' | 'finishedAt' | 'usage'>>,
    ): Promise<TurnRow | undefined> =>
      one(
        await db
          .update(aiTurn)
          .set(patch)
          .where(and(eq(aiTurn.id, id), inArray(aiTurn.status, from)))
          .returning(),
      ),
    listByStatus: (status: TurnStatus): Promise<TurnRow[]> => db.select().from(aiTurn).where(eq(aiTurn.status, status)),
    /** The newest turn of a conversation. */
    latest: async (conversationId: string): Promise<TurnRow | undefined> => {
      const rows = await db
        .select()
        .from(aiTurn)
        .where(eq(aiTurn.conversationId, conversationId))
        .orderBy(desc(aiTurn.startedAt))
        .limit(1);

      return rows[0];
    },
  };

  const messages = {
    nextSeq: async (conversationId: string): Promise<number> => {
      const rows = await db
        .select({ max: max(aiMessage.seq) })
        .from(aiMessage)
        .where(eq(aiMessage.conversationId, conversationId));

      return (rows[0]?.max ?? 0) + 1;
    },
    insert: async (row: Omit<MessageRow, 'createdAt' | 'partial'> & { partial?: boolean }): Promise<MessageRow> => {
      const rows = await db
        .insert(aiMessage)
        .values({ ...row, partial: row.partial ?? false, createdAt: clock() })
        .returning();

      return rows[0] as MessageRow;
    },
    list: (conversationId: string): Promise<MessageRow[]> =>
      db.select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId)).orderBy(asc(aiMessage.seq)),
  };

  const toolCalls = {
    insert: async (row: Omit<ToolCallRow, 'createdAt'>): Promise<ToolCallRow> => {
      const rows = await db
        .insert(aiToolCall)
        .values({ ...row, createdAt: clock() })
        .returning();

      return rows[0] as ToolCallRow;
    },
    get: async (id: string): Promise<ToolCallRow | undefined> =>
      one(await db.select().from(aiToolCall).where(eq(aiToolCall.id, id)).limit(1)),
    update: async (
      id: string,
      patch: Partial<Pick<ToolCallRow, 'status' | 'result' | 'isError' | 'reason' | 'resolvedAt' | 'executedAt'>>,
    ): Promise<ToolCallRow> => {
      const rows = await db.update(aiToolCall).set(patch).where(eq(aiToolCall.id, id)).returning();

      return rows[0] as ToolCallRow;
    },
    list: (conversationId: string): Promise<ToolCallRow[]> =>
      db
        .select()
        .from(aiToolCall)
        .where(eq(aiToolCall.conversationId, conversationId))
        .orderBy(asc(aiToolCall.createdAt), asc(aiToolCall.id)),
    /** Names of the tools that ran in a conversation (to know whether it has read outside content). */
    executedNames: async (conversationId: string): Promise<string[]> =>
      (
        await db
          .selectDistinct({ name: aiToolCall.name })
          .from(aiToolCall)
          .where(and(eq(aiToolCall.conversationId, conversationId), eq(aiToolCall.status, 'executed')))
      ).map((row) => row.name),
    pending: (turnId: string): Promise<ToolCallRow[]> =>
      db
        .select()
        .from(aiToolCall)
        .where(and(eq(aiToolCall.turnId, turnId), eq(aiToolCall.status, 'pending')))
        .orderBy(asc(aiToolCall.createdAt), asc(aiToolCall.id)),
    /** Mark every unfinished call of a turn as declined (cancel, failure, restart). */
    declineActive: async (turnId: string, message: string): Promise<ToolCallRow[]> =>
      db
        .update(aiToolCall)
        .set({ status: 'declined', result: { declined: true, message }, isError: true, resolvedAt: clock() })
        .where(and(eq(aiToolCall.turnId, turnId), inArray(aiToolCall.status, ACTIVE_CALL_STATUSES)))
        .returning(),
  };

  const settings = {
    get: async (workspaceId: string): Promise<AiSettings> =>
      toSettings(one(await db.select().from(aiSettings).where(eq(aiSettings.workspaceId, workspaceId)).limit(1))),
    /** Only the given parts change. */
    upsert: async (
      workspaceId: string,
      patch: {
        defaultAgentId?: string | null;
      },
    ): Promise<AiSettings> => {
      const set = { ...patch, updatedAt: clock() };
      const rows = await db
        .insert(aiSettings)
        .values({ workspaceId, ...set })
        .onConflictDoUpdate({ target: aiSettings.workspaceId, set })
        .returning();

      return toSettings(rows[0]);
    },
  };

  type AgentPatch = Partial<
    Pick<
      AgentRow,
      | 'name'
      | 'icon'
      | 'description'
      | 'instructions'
      | 'tools'
      | 'skills'
      | 'starterPrompts'
      | 'approvalOverrides'
      | 'takesTasks'
      | 'archivedAt'
    >
  >;

  const agents = {
    /** Active agents by name; archived ones only when asked for. */
    list: (workspaceId: string, includeArchived = false): Promise<AgentRow[]> =>
      db
        .select()
        .from(aiAgent)
        .where(
          includeArchived
            ? eq(aiAgent.workspaceId, workspaceId)
            : and(eq(aiAgent.workspaceId, workspaceId), isNull(aiAgent.archivedAt)),
        )
        .orderBy(asc(aiAgent.name), asc(aiAgent.id)),
    get: async (workspaceId: string, id: string): Promise<AgentRow | undefined> =>
      one(
        await db
          .select()
          .from(aiAgent)
          .where(and(eq(aiAgent.workspaceId, workspaceId), eq(aiAgent.id, id)))
          .limit(1),
      ),
    insert: async (
      row: { id: string; workspaceId: string } & Required<Omit<AgentPatch, 'archivedAt'>>,
    ): Promise<AgentRow> => {
      const now = clock();
      const rows = await db
        .insert(aiAgent)
        .values({ ...row, createdAt: now, updatedAt: now })
        .returning();

      return rows[0] as AgentRow;
    },
    update: async (workspaceId: string, id: string, patch: AgentPatch): Promise<AgentRow | undefined> =>
      one(
        await db
          .update(aiAgent)
          .set({ ...patch, updatedAt: clock() })
          .where(and(eq(aiAgent.workspaceId, workspaceId), eq(aiAgent.id, id)))
          .returning(),
      ),
  };

  type SkillPatch = Partial<Pick<SkillRow, 'title' | 'description' | 'body' | 'archivedAt'>>;

  const skills = {
    /** Active skills by title; archived ones only when asked for. */
    list: (workspaceId: string, includeArchived = false): Promise<SkillRow[]> =>
      db
        .select()
        .from(aiSkill)
        .where(
          includeArchived
            ? eq(aiSkill.workspaceId, workspaceId)
            : and(eq(aiSkill.workspaceId, workspaceId), isNull(aiSkill.archivedAt)),
        )
        .orderBy(asc(aiSkill.title), asc(aiSkill.id)),
    get: async (workspaceId: string, id: string): Promise<SkillRow | undefined> =>
      one(
        await db
          .select()
          .from(aiSkill)
          .where(and(eq(aiSkill.workspaceId, workspaceId), eq(aiSkill.id, id)))
          .limit(1),
      ),
    insert: async (row: { id: string; workspaceId: string; title: string; description: string; body: string }) => {
      const now = clock();
      const rows = await db
        .insert(aiSkill)
        .values({ ...row, createdAt: now, updatedAt: now })
        .returning();

      return rows[0] as SkillRow;
    },
    update: async (workspaceId: string, id: string, patch: SkillPatch): Promise<SkillRow | undefined> =>
      one(
        await db
          .update(aiSkill)
          .set({ ...patch, updatedAt: clock() })
          .where(and(eq(aiSkill.workspaceId, workspaceId), eq(aiSkill.id, id)))
          .returning(),
      ),
  };

  /** What a module's manifest says one of its agents is: the part the module owns. */
  interface ModuleAgentRow {
    moduleId: string;
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    instructions: string | null;
    tools: string[];
    skills: string[];
    starterPrompts: string[];
  }

  /**
   * Make the workspace's agents match what its installed modules ship: create the new ones, update the module-owned
   * fields of the rest (never the workspace's own: approvals, the default), restore one that was archived because its
   * module went away, and archive those no module provides any more. An agent a person archived stays archived.
   */
  const syncModuleAgents = async (workspaceId: string, provided: ModuleAgentRow[]): Promise<void> => {
    const now = clock();
    await db.transaction(async (tx) => {
      for (const agent of provided) {
        const owned = {
          moduleId: agent.moduleId,
          name: agent.name,
          icon: agent.icon,
          description: agent.description,
          instructions: agent.instructions,
          tools: agent.tools,
          skills: agent.skills,
          starterPrompts: agent.starterPrompts,
        };
        await tx
          .insert(aiAgent)
          .values({
            workspaceId,
            id: agent.id,
            ...owned,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aiAgent.workspaceId, aiAgent.id],
            set: {
              ...owned,
              updatedAt: now,
              archivedAt: sql`case when ${aiAgent.archivedByModule} then null else ${aiAgent.archivedAt} end`,
              archivedByModule: false,
            },
          });
      }

      const keep = provided.map((agent) => agent.id);
      await tx
        .update(aiAgent)
        .set({ archivedAt: now, archivedByModule: true, updatedAt: now })
        .where(
          and(
            eq(aiAgent.workspaceId, workspaceId),
            isNotNull(aiAgent.moduleId),
            isNull(aiAgent.archivedAt),
            keep.length > 0 ? notInArray(aiAgent.id, keep) : undefined,
          ),
        );
    });
  };

  /**
   * Give a workspace its first agent, once ever. The claim (`seeded_at`) and the insert share a transaction, so a
   * concurrent caller waits on the claim and then sees the agent; only the claimer inserts. Returns whether this call
   * seeded.
   */
  const seedAgent = async (
    workspaceId: string,
    agent: { id: string } & Required<Omit<AgentPatch, 'archivedAt' | 'approvalOverrides'>>,
  ): Promise<boolean> => {
    const now = clock();

    return db.transaction(async (tx) => {
      await tx.insert(aiSettings).values({ workspaceId, updatedAt: now }).onConflictDoNothing();
      const claimed = await tx
        .update(aiSettings)
        .set({ seededAt: now })
        .where(and(eq(aiSettings.workspaceId, workspaceId), isNull(aiSettings.seededAt)))
        .returning({ workspaceId: aiSettings.workspaceId });

      if (claimed.length === 0) {
        return false;
      }

      await tx.insert(aiAgent).values({ ...agent, workspaceId, approvalOverrides: {}, createdAt: now, updatedAt: now });
      await tx
        .update(aiSettings)
        .set({ defaultAgentId: agent.id, updatedAt: now })
        .where(eq(aiSettings.workspaceId, workspaceId));

      return true;
    });
  };

  /** What a module's manifest says one of its skills is: the part the module owns. */
  interface ModuleSkillRow {
    moduleId: string;
    id: string;
    title: string;
    description: string;
    body: string;
  }

  /**
   * Make the workspace's skills match what its installed modules ship, as agents are (`syncModuleAgents`): create the
   * new ones, update the module-owned text of the rest, restore one that was archived because its module went away,
   * and archive those no module provides any more. A skill a person archived stays archived.
   */
  const syncModuleSkills = async (workspaceId: string, provided: ModuleSkillRow[]): Promise<void> => {
    const now = clock();
    await db.transaction(async (tx) => {
      for (const skill of provided) {
        const owned = {
          moduleId: skill.moduleId,
          title: skill.title,
          description: skill.description,
          body: skill.body,
        };
        await tx
          .insert(aiSkill)
          .values({ workspaceId, id: skill.id, ...owned, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [aiSkill.workspaceId, aiSkill.id],
            set: {
              ...owned,
              updatedAt: now,
              archivedAt: sql`case when ${aiSkill.archivedByModule} then null else ${aiSkill.archivedAt} end`,
              archivedByModule: false,
            },
          });
      }

      const keep = provided.map((skill) => skill.id);
      await tx
        .update(aiSkill)
        .set({ archivedAt: now, archivedByModule: true, updatedAt: now })
        .where(
          and(
            eq(aiSkill.workspaceId, workspaceId),
            isNotNull(aiSkill.moduleId),
            isNull(aiSkill.archivedAt),
            keep.length > 0 ? notInArray(aiSkill.id, keep) : undefined,
          ),
        );
    });
  };

  const purgeWorkspace = async (workspaceId: string): Promise<void> => {
    await db.delete(aiRun).where(eq(aiRun.workspaceId, workspaceId));
    await db.delete(aiConversation).where(eq(aiConversation.workspaceId, workspaceId));
    await db.delete(aiAgent).where(eq(aiAgent.workspaceId, workspaceId));
    await db.delete(aiSkill).where(eq(aiSkill.workspaceId, workspaceId));
    await db.delete(aiSettings).where(eq(aiSettings.workspaceId, workspaceId));
  };

  /** After a restart: turns that were running can never resume, so fail them and free their conversations. */
  const recoverInterrupted = async (): Promise<number> => {
    const running = await turns.listByStatus('running');

    for (const turn of running) {
      await turns.update(turn.id, {
        status: 'failed',
        error: { code: 'INTERRUPTED', message: 'The server restarted while the agent was working' },
        finishedAt: clock(),
      });
      await toolCalls.declineActive(turn.id, 'The server restarted before this call finished');
      await conversations.release(turn.conversationId, turn.id);
    }

    return running.length;
  };

  return {
    conversations,
    runs,
    turns,
    messages,
    toolCalls,
    settings,
    agents,
    skills,
    seedAgent,
    syncModuleAgents,
    syncModuleSkills,
    purgeWorkspace,
    recoverInterrupted,
  };
};

export type AiStore = ReturnType<typeof createAiStore>;
