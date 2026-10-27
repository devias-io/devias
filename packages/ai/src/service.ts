import {
  type AiAgent,
  type AiAgentActivity,
  type AiAgentActivityQuery,
  type AiAgentInput,
  type AiAgentPatch,
  type AiAgentUsage,
  type AiSettings,
  type AiSettingsPatch,
  type AiSkill,
  type AiSkillInput,
  type AiSkillPatch,
  type AiSkillSummary,
  type AiStatus,
  type AiTurn,
  activityDays,
  type ChatEvent,
  type Conversation,
  type ConversationThread,
  type CreateConversationInput,
  DEFAULT_SUGGESTED_PROMPTS,
  emptyUsage,
  isTimeZone,
  newId,
  personOf,
  type ResolveToolCallInput,
  type SendMessageInput,
  SKILLS_MAX,
  type TaskRun,
  toolOfAction,
} from '@devias/core';
import {
  agentContext,
  authorize,
  type DataEngine,
  type Db,
  type EngineContext,
  EngineError,
  type Logger,
  silentLogger,
} from '@devias/data-engine';
import type { ModelClient, TextParam } from './model/types';
import { contextBlock, linkTargetsOf, type MentionedRecord, schemaDigest } from './prompt/context';
import { describeTool, sanitizeOverrides } from './runtime/approval';
import { type AgentProfile, createTurnRuntime, type EventSink } from './runtime/turn';
import { skillsBlock, skillsOf } from './skills';
import {
  type AgentRow,
  type AiStore,
  type ConversationRow,
  createAiStore,
  type SkillRow,
  toAgent,
  toChatMessage,
  toConversation,
  toSkill,
  toSkillSummary,
  toTaskRun,
  toTurn,
} from './store';
import { shapeRecord } from './tools/helpers';
import { createToolRegistry, type ToolRegistry } from './tools/registry';
import { checkAnswers } from './tools/secure';
import type { ActionsPort, ToolDefinition, WorkflowRunPort } from './tools/types';

export interface AiServiceOptions {
  engine: DataEngine;
  db: Db;
  /** Runs workflows for `run_workflow`; without it the tool reports that runs are unavailable. */
  workflows?: WorkflowRunPort;
  /** The host's actions: every one a built-in tool doesn't serve becomes a generated tool. */
  actions?: ActionsPort;
  /** The model; `null` (or omitted) means "not configured": status reports it and turns are refused. */
  model?: ModelClient | null;
  /** Reported by `status()` when no model is configured. */
  modelName?: string;
  effort?: string;
  logger?: Logger;
  clock?: () => Date;
  maxIterations?: number;
  /** Override the built-in tool set (tests). */
  builtinTools?: ToolDefinition[];
}

export interface TurnHandle {
  turn: AiTurn;
  userMessageId?: string;
  /** Drive the turn, streaming events into `sink`; resolves when the turn pauses or ends. */
  run(sink: EventSink): Promise<void>;
}

export interface UserInfo {
  id: string;
  name: string;
}

export interface AiService {
  status(ctx: EngineContext): Promise<AiStatus>;
  conversations: {
    list(ctx: EngineContext, opts?: { limit?: number }): Promise<Conversation[]>;
    create(ctx: EngineContext, input?: CreateConversationInput): Promise<Conversation>;
    get(ctx: EngineContext, id: string): Promise<ConversationThread>;
    delete(ctx: EngineContext, id: string): Promise<void>;
  };
  /** Validate, take the conversation lock and persist the user message; the returned handle runs the turn. */
  startTurn(ctx: EngineContext, conversationId: string, input: SendMessageInput, user?: UserInfo): Promise<TurnHandle>;
  startResolve(
    ctx: EngineContext,
    conversationId: string,
    toolCallId: string,
    input: ResolveToolCallInput,
    user?: UserInfo,
  ): Promise<TurnHandle>;
  cancel(ctx: EngineContext, conversationId: string): Promise<AiTurn | null>;
  settings: {
    get(ctx: EngineContext): Promise<AiSettings>;
    update(ctx: EngineContext, patch: AiSettingsPatch): Promise<AiSettings>;
  };
  /** The workspace's agents: everyone lists them, `ai.manage` shapes them. Deleting archives. */
  agents: {
    /** Active agents by name; archived ones too with `includeArchived`. */
    list(ctx: EngineContext, opts?: { includeArchived?: boolean }): Promise<AiAgent[]>;
    /** Conversations and tokens per agent, archived ones too (`ai.manage`). */
    usage(ctx: EngineContext): Promise<AiAgentUsage[]>;
    /** One agent's conversations, replies and tokens per day (`ai.manage`). */
    activity(ctx: EngineContext, id: string, query?: AiAgentActivityQuery): Promise<AiAgentActivity>;
    get(ctx: EngineContext, id: string): Promise<AiAgent>;
    create(ctx: EngineContext, input: AiAgentInput): Promise<AiAgent>;
    update(ctx: EngineContext, id: string, patch: AiAgentPatch): Promise<AiAgent>;
    /** Archives the agent (`update` with `archived: false` restores it). */
    delete(ctx: EngineContext, id: string): Promise<void>;
  };
  /** The workspace's skills: procedures agents load when a request calls for them. `ai.manage` writes and reads them. */
  skills: {
    /** Active skills by label, without their text; archived ones too with `includeArchived`. */
    list(ctx: EngineContext, opts?: { includeArchived?: boolean }): Promise<AiSkillSummary[]>;
    get(ctx: EngineContext, id: string): Promise<AiSkill>;
    create(ctx: EngineContext, input: AiSkillInput): Promise<AiSkill>;
    update(ctx: EngineContext, id: string, patch: AiSkillPatch): Promise<AiSkill>;
    /** Archives the skill (`update` with `archived: false` restores it). */
    delete(ctx: EngineContext, id: string): Promise<void>;
  };
  /** Agents working tasks: each run is a conversation the agent has for the person it acts for. */
  runs: {
    /** Make the run and its conversation and persist the brief; the returned handle drives the agent's turn. */
    start(
      ctx: EngineContext,
      input: {
        /** The run's id; the task row names the same one. */
        id: string;
        taskId: string;
        agentId: string;
        title: string;
        content: string;
        attempt: number;
        user?: UserInfo;
      },
    ): Promise<{ run: TaskRun; handle: TurnHandle }>;
    /** A task's runs, newest first. */
    list(ctx: EngineContext, taskId: string): Promise<TaskRun[]>;
    /** Cancels what the agent is doing in a run's conversation. */
    abort(workspaceId: string, conversationId: string): Promise<void>;
  };
  registry: ToolRegistry;
  store: AiStore;
  purgeWorkspace(workspaceId: string): Promise<void>;
  /** Fail turns interrupted by a restart and free their conversations. */
  recover(): Promise<number>;
  close(): Promise<void>;
}

const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_LIST_LIMIT = 50;

const titleFrom = (content: string): string => {
  const line = content.trim().split('\n')[0] ?? '';

  return line.length > 80 ? `${line.slice(0, 77)}…` : line || 'New conversation';
};

/** What an agent's conversations get after the system prompt. */
const agentInstructions = (agent: AiAgent, skills: readonly SkillRow[]): string =>
  [
    `## This agent\nYou are "${agent.label}", an agent in this workspace. Everything above still applies.`,
    agent.description ? `Purpose: ${agent.description}` : '',
    agent.tools ? 'You only have the tools listed; when asked for something else, say this agent cannot do it.' : '',
    agent.instructions ? `Instructions from the workspace:\n${agent.instructions}` : '',
    skillsBlock(skills),
  ]
    .filter(Boolean)
    .join('\n');

const dedupe = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** Blank lines are dropped and repeats kept once, in the order written. */
const cleanPrompts = (prompts: readonly string[]): string[] =>
  dedupe(prompts.map((prompt) => prompt.trim()).filter(Boolean));

/** The agent every workspace starts with: all tools, takes tasks, editable and archivable like any other. */
const SEEDED_AGENT = {
  label: 'Assistant',
  icon: 'avatar-1',
  description: 'Works with everything in the workspace.',
  instructions: null,
  tools: null,
  skills: null,
  starterPrompts: [...DEFAULT_SUGGESTED_PROMPTS],
  takesTasks: true,
} as const;

const agentLabel = (name: string): string => {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new EngineError('VALIDATION', 'An agent needs a label');
  }

  return trimmed;
};

export const createAiService = (options: AiServiceOptions): AiService => {
  const { engine } = options;
  const logger = options.logger ?? silentLogger;
  const clock = options.clock ?? (() => new Date());
  const model = options.model ?? null;
  const store = createAiStore(options.db, clock);
  const registry = createToolRegistry({
    engine,
    ...(options.builtinTools ? { builtin: options.builtinTools } : {}),
    ...(options.actions ? { actions: options.actions } : {}),
  });
  const controllers = new Map<string, AbortController>();
  const runtime = model
    ? createTurnRuntime({
        store,
        model,
        registry,
        engine,
        logger,
        clock,
        controllers,
        maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        ...(options.workflows ? { workflows: options.workflows } : {}),
        ...(options.actions ? { actions: options.actions } : {}),
      })
    : null;

  const requireUser = (ctx: EngineContext): string => {
    const userId = personOf(ctx.actor);

    if (!userId) {
      throw new EngineError('FORBIDDEN', 'Agents are available to signed-in users only');
    }

    return userId;
  };

  const requireRuntime = () => {
    if (!runtime) {
      throw new EngineError('MISSING_DEPENDENCY', "AI is not configured: set the AI provider's API key on the server");
    }

    return runtime;
  };

  const owned = async (ctx: EngineContext, id: string): Promise<ConversationRow> => {
    const userId = requireUser(ctx);
    const row = await store.conversations.get(ctx.workspaceId, id);

    if (!row || row.userId !== userId) {
      throw new EngineError('NOT_FOUND', `Conversation "${id}" not found`);
    }

    return row;
  };

  const seeded = new Set<string>();
  const seeding = new Map<string, Promise<void>>();

  /**
   * Give a workspace its first agent, once (memoized per process; `seeded_at` makes it once ever, so archiving every
   * agent never brings another back). Everything that reads agents or settings goes through here first.
   */
  const ensureSeeded = (workspaceId: string): Promise<void> => {
    if (seeded.has(workspaceId)) {
      return Promise.resolve();
    }

    const pending =
      seeding.get(workspaceId) ??
      store
        .seedAgent(workspaceId, {
          id: newId(),
          ...SEEDED_AGENT,
          starterPrompts: [...SEEDED_AGENT.starterPrompts],
        })
        .then(() => {
          seeded.add(workspaceId);
        })
        .finally(() => seeding.delete(workspaceId));
    seeding.set(workspaceId, pending);

    return pending;
  };

  const syncedVersion = new Map<string, number>();
  const syncing = new Map<string, Promise<void>>();

  /**
   * Make the workspace's agents match what its installed modules ship (memoized per process by metadata version, so an
   * install, an update or an uninstall is seen on the next use). A tool a module's agent names that no tool answers
   * to, or that reaches beyond its name (a module may not hand out workflows, keys, members, modules or agents), is
   * dropped with a warning; an agent left with no tool is not made.
   */
  const syncModules = (workspaceId: string): Promise<void> => {
    const run = async () => {
      const snapshot = await engine.metadata.getSnapshot(workspaceId);

      if (syncedVersion.get(workspaceId) === snapshot.version) {
        return;
      }

      const provided = snapshot.schema.modules.flatMap((installed) =>
        installed.agents.flatMap((agent) => {
          const tools = agent.actionIds.flatMap((actionId) => {
            const name = toolOfAction(actionId, installed.actions);
            const tool = name === null ? undefined : registry.get(name);
            const ok = tool !== undefined && !tool.escalates;

            if (!ok) {
              logger.warn(
                `the agent "${agent.id}" names the action "${actionId}", ${tool ? 'whose tool reaches beyond its name' : 'which no tool serves'}; dropped`,
              );
            }

            return ok && name !== null ? [name] : [];
          });

          if (tools.length === 0) {
            logger.warn(`the agent "${agent.id}" has no usable tool; not made`);

            return [];
          }

          return [
            {
              moduleId: installed.id,
              id: agent.id,
              label: agent.label,
              icon: agent.icon ?? null,
              description: agent.description ?? null,
              instructions: agent.instructions ?? null,
              tools: dedupe(tools),
              skills: dedupe(agent.skillIds),
              starterPrompts: cleanPrompts(agent.starterPrompts),
            },
          ];
        }),
      );
      // Skills first: an agent's list names them.
      await store.syncModuleSkills(
        workspaceId,
        snapshot.schema.modules.flatMap((installed) =>
          installed.skills.map((skill) => ({
            moduleId: installed.id,
            id: skill.id,
            label: skill.label,
            description: skill.description,
            body: skill.body,
          })),
        ),
      );
      await store.syncModuleAgents(workspaceId, provided);
      syncedVersion.set(workspaceId, snapshot.version);
    };
    const pending = syncing.get(workspaceId) ?? run().finally(() => syncing.delete(workspaceId));
    syncing.set(workspaceId, pending);

    return pending;
  };

  /** Everything that reads agents or settings goes through here first: the first agent, then the modules'. */
  const ensureReady = async (workspaceId: string): Promise<void> => {
    await ensureSeeded(workspaceId);
    await syncModules(workspaceId);
  };

  /** The agent Home and a new conversation use: the workspace's choice while it is active, else the first by name. */
  const defaultAgent = async (workspaceId: string): Promise<AgentRow> => {
    await ensureReady(workspaceId);
    const { defaultAgentId } = await store.settings.get(workspaceId);
    const chosen = defaultAgentId ? await store.agents.get(workspaceId, defaultAgentId) : undefined;
    const row = chosen && !chosen.archivedAt ? chosen : (await store.agents.list(workspaceId))[0];

    if (!row) {
      throw new EngineError('NOT_FOUND', 'This workspace has no active agent; an admin can create one');
    }

    return row;
  };

  const archivedError = (name: string) =>
    new EngineError('CONFLICT', `The agent "${name}" is archived; restore it or pick another agent`);

  /**
   * One of the workspace's agents as the runtime sees it: its instructions and tools, with the workspace's approval
   * overrides under the agent's. An archived agent takes no new work, but `allowArchived` lets an approval already
   * waiting on it finish.
   */
  const profileFor = async (
    workspaceId: string,
    agentId: string,
    options: { allowArchived?: boolean } = {},
  ): Promise<AgentProfile> => {
    const row = await store.agents.get(workspaceId, agentId);

    if (!row) {
      throw new EngineError('NOT_FOUND', `Agent "${agentId}" not found`);
    }

    if (row.archivedAt && !options.allowArchived) {
      throw archivedError(row.label);
    }

    const agent = toAgent(row);
    const allowed = agent.skills ? new Set(agent.skills) : null;
    const skills = skillsOf(await store.skills.list(workspaceId), allowed);

    return {
      id: agent.id,
      name: agent.label,
      instructions: agentInstructions(agent, skills),
      skills: { allowed, count: skills.length },
      ...(agent.tools ? { tools: new Set(agent.tools) } : {}),
      approvalOverrides: agent.approvalOverrides,
    };
  };

  const status = async (ctx: EngineContext): Promise<AiStatus> => {
    requireUser(ctx);
    await ensureReady(ctx.workspaceId);
    const snapshot = await engine.metadata.getSnapshot(ctx.workspaceId);

    return {
      configured: model !== null,
      model: model?.model ?? options.modelName ?? '',
      effort: model?.effort ?? options.effort ?? '',
      tools: registry.toolsFor(ctx, snapshot).map((tool) => describeTool(tool)),
      canManage: engine.permissions.can(ctx, 'ai.manage'),
    };
  };

  const conversations: AiService['conversations'] = {
    list: async (ctx, opts) => {
      const userId = requireUser(ctx);
      const rows = await store.conversations.list(
        ctx.workspaceId,
        userId,
        Math.min(Math.max(opts?.limit ?? DEFAULT_LIST_LIMIT, 1), 200),
      );

      return rows.map(toConversation);
    },
    create: async (ctx, input) => {
      const userId = requireUser(ctx);
      let agent: AgentRow;

      if (input?.agentId) {
        await ensureReady(ctx.workspaceId);
        const found = await store.agents.get(ctx.workspaceId, input.agentId);

        if (!found) {
          throw new EngineError('NOT_FOUND', `Agent "${input.agentId}" not found`);
        }

        agent = found;
      } else {
        agent = await defaultAgent(ctx.workspaceId);
      }

      if (agent.archivedAt) {
        throw archivedError(agent.label);
      }

      const row = await store.conversations.create(ctx.workspaceId, userId, newId(), input?.title ?? null, agent.id);

      return toConversation(row);
    },
    get: async (ctx, id) => {
      const row = await owned(ctx, id);
      const [messages, calls] = await Promise.all([store.messages.list(id), store.toolCalls.list(id)]);
      const byMessage = new Map<string, typeof calls>();

      for (const call of calls) {
        const list = byMessage.get(call.messageId) ?? [];
        list.push(call);
        byMessage.set(call.messageId, list);
      }

      const activeTurn = row.activeTurnId ? await store.turns.get(row.activeTurnId) : undefined;

      return {
        conversation: toConversation(row),
        messages: messages.map((m) => toChatMessage(m, byMessage.get(m.id) ?? [])),
        activeTurn: activeTurn ? toTurn(activeTurn) : null,
      };
    },
    delete: async (ctx, id) => {
      const row = await owned(ctx, id);

      if (row.activeTurnId) {
        const turn = await store.turns.get(row.activeTurnId);

        if (turn?.status === 'running') {
          throw new EngineError('CONFLICT', 'The agent is still working on this conversation; cancel it first');
        }
      }

      await store.conversations.delete(ctx.workspaceId, id);
    },
  };

  const startTurn: AiService['startTurn'] = async (ctx, conversationId, input, user) => {
    const rt = requireRuntime();
    const conversation = await owned(ctx, conversationId);
    // A module uninstalled since the last message takes its agents with it.
    await syncModules(ctx.workspaceId);
    // The agent first: an archived or missing one must fail before anything is stored.
    const agent = await profileFor(ctx.workspaceId, conversation.agentId);
    const turnRow = await store.turns.insert({ id: newId(), conversationId, workspaceId: ctx.workspaceId });
    const claimed = await store.conversations.claim(conversationId, turnRow.id);

    if (!claimed) {
      await store.turns.delete(turnRow.id);

      throw new EngineError('CONFLICT', 'The agent is still working on this conversation; wait for it or cancel it');
    }

    try {
      const snapshot = await engine.metadata.getSnapshot(ctx.workspaceId);
      const now = clock();
      const workflowId = input.context?.page?.workflowId;
      // Name the open workflow when the caller may read it; a stale or foreign id just stays an id.
      const workflow = workflowId ? await engine.workflows.get(ctx, workflowId).catch(() => undefined) : undefined;
      // Records the person linked with @ are read for them, so the model starts with what they point at.
      const mentions: MentionedRecord[] = await Promise.all(
        linkTargetsOf(input.content).map(async (target): Promise<MentionedRecord> => {
          if (target.kind === 'workflow') {
            const workflow = await engine.workflows.get(ctx, target.id).catch(() => null);

            return {
              target,
              record: workflow
                ? {
                    title: workflow.title,
                    enabled: workflow.enabled,
                    trigger: workflow.trigger,
                    steps: workflow.steps.map(({ id: stepId, label, kind }) => ({ id: stepId, label, kind })),
                  }
                : null,
            };
          }

          // A member is named by the link; who they are is read with `list_members`.
          if (target.kind === 'member') {
            return { target, record: { kind: 'workspace member', userId: target.id } };
          }

          if (target.kind === 'agent') {
            const found = await store.agents.get(ctx.workspaceId, target.id);

            return {
              target,
              record: found
                ? {
                    kind: 'agent',
                    name: found.label,
                    description: found.description,
                    takesTasks: found.takesTasks,
                    ...(found.archivedAt ? { archived: true } : {}),
                  }
                : null,
            };
          }

          if (target.kind === 'task') {
            const task = await engine.tasks.get(ctx, target.id).catch(() => null);

            return {
              target,
              record: task
                ? {
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    assignee: task.assignee,
                    dueDate: task.dueDate,
                    version: task.version,
                    markdown: task.markdown,
                  }
                : null,
            };
          }

          if (target.kind === 'document') {
            const document = await engine.documents.get(ctx, target.id).catch(() => null);

            return {
              target,
              record: document
                ? {
                    title: document.title,
                    version: document.version,
                    updatedAt: document.updatedAt,
                    markdown: document.markdown,
                  }
                : null,
            };
          }

          const resolved =
            snapshot.index.objectsByName.get(target.object) ?? snapshot.index.objectsById.get(target.object);
          const record = resolved
            ? await engine.records.get(ctx, resolved.nameSingular, target.id).catch(() => null)
            : null;

          return { target, record: record && resolved ? shapeRecord(snapshot.index, resolved, record) : null };
        }),
      );
      const context = contextBlock({
        mentions,
        today: now.toISOString().slice(0, 10),
        user: user ? { name: user.name, role: ctx.role } : undefined,
        page: input.context?.page,
        workflow,
        index: snapshot.index,
      });
      const includeSchema = conversation.schemaVersionSeen !== snapshot.version;
      const blocks: TextParam[] = [
        { type: 'text', text: input.content },
        { type: 'text', text: includeSchema ? `${context}\n${schemaDigest(snapshot.index)}` : context },
      ];
      const userMessageId = newId();
      await store.messages.insert({
        id: userMessageId,
        conversationId,
        turnId: turnRow.id,
        workspaceId: ctx.workspaceId,
        seq: await store.messages.nextSeq(conversationId),
        role: 'user',
        content: blocks,
        text: input.content,
        context: input.context ?? null,
        model: null,
        usage: null,
        stopReason: null,
      });
      await store.conversations.update(conversationId, {
        schemaVersionSeen: snapshot.version,
        lastMessageAt: now,
        title: conversation.title ?? titleFrom(input.content),
      });
      const fresh = (await store.conversations.get(ctx.workspaceId, conversationId)) ?? conversation;
      const acting = agentContext(ctx, agent.id, await runRef(conversation));

      return {
        turn: toTurn(turnRow),
        userMessageId,
        run: (sink) => {
          sink.emit({ type: 'turn_start', turnId: turnRow.id, conversationId, userMessageId, iteration: 0 });

          return rt.run({ turn: turnRow, conversation: fresh, ctx: acting, agent, user, sink });
        },
      };
    } catch (error) {
      await store.conversations.release(conversationId, turnRow.id);
      await store.turns.delete(turnRow.id);

      throw error;
    }
  };

  const startResolve: AiService['startResolve'] = async (ctx, conversationId, toolCallId, input, user) => {
    const rt = requireRuntime();
    const conversation = await owned(ctx, conversationId);
    const call = await store.toolCalls.get(toolCallId);

    if (!call || call.conversationId !== conversationId) {
      throw new EngineError('NOT_FOUND', `Tool call "${toolCallId}" not found`);
    }

    if (call.status !== 'pending') {
      throw new EngineError('CONFLICT', 'This tool call was already resolved');
    }

    if (conversation.activeTurnId !== call.turnId) {
      throw new EngineError('CONFLICT', 'This tool call belongs to a turn that already ended');
    }

    // Answers to an input request are checked before anything changes, so a mistake can be corrected and resent.
    const values = input.approved && call.inputRequest ? checkAnswers(call.inputRequest, input.values) : undefined;
    // An archived agent may still finish what it was waiting on.
    const agent = await profileFor(ctx.workspaceId, conversation.agentId, { allowArchived: true });
    const acting = agentContext(ctx, agent.id, await runRef(conversation));
    const turn = await store.turns.cas(call.turnId, ['awaiting_approval'], { status: 'running' });

    if (!turn) {
      throw new EngineError('CONFLICT', 'The agent is not waiting for approval right now');
    }

    return {
      turn: toTurn(turn),
      run: (sink) =>
        rt.resolve({ turn, conversation, ctx: acting, agent, user, sink }, call, {
          approved: input.approved,
          reason: input.reason,
          ...(values ? { values } : {}),
        }),
    };
  };

  /** The run a conversation was made for, as the context of the agent working in it. */
  const runRef = async (conversation: ConversationRow): Promise<{ id: string; taskId: string } | undefined> => {
    const run = conversation.runId ? await store.runs.get(conversation.runId) : undefined;

    return run ? { id: run.id, taskId: run.taskId } : undefined;
  };

  const cancelConversation = async (conversation: ConversationRow): Promise<AiTurn | null> => {
    const conversationId = conversation.id;

    if (!conversation.activeTurnId) {
      return null;
    }

    const turnId = conversation.activeTurnId;
    controllers.get(turnId)?.abort();
    const updated = await store.turns.cas(turnId, ['running', 'awaiting_approval'], {
      status: 'cancelled',
      finishedAt: clock(),
    });
    await store.toolCalls.declineActive(turnId, 'The turn was cancelled before this call ran.');
    await store.conversations.release(conversationId, turnId);
    const row = updated ?? (await store.turns.get(turnId));

    return row ? toTurn(row) : null;
  };

  const cancel: AiService['cancel'] = async (ctx, conversationId) =>
    cancelConversation(await owned(ctx, conversationId));

  const runs: AiService['runs'] = {
    start: async (ctx, input) => {
      const userId = requireUser(ctx);
      await ensureReady(ctx.workspaceId);
      const agent = await store.agents.get(ctx.workspaceId, input.agentId);

      if (!agent || agent.archivedAt || !agent.takesTasks) {
        throw new EngineError('CONFLICT', 'This agent does not take tasks');
      }

      const conversationId = newId();
      const runId = input.id;
      await store.conversations.create(ctx.workspaceId, userId, conversationId, input.title, agent.id, runId);
      const row = await store.runs.insert({
        id: runId,
        workspaceId: ctx.workspaceId,
        taskId: input.taskId,
        agentId: agent.id,
        conversationId,
        attempt: input.attempt,
        requestedBy: userId,
      });

      try {
        const handle = await startTurn(ctx, conversationId, { content: input.content }, input.user);

        return { run: toTaskRun(row), handle };
      } catch (error) {
        await store.runs.update(runId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          finishedAt: clock(),
        });

        throw error;
      }
    },
    list: async (ctx, taskId) => {
      authorize(ctx, 'task.read');

      return (await store.runs.listByTask(ctx.workspaceId, taskId)).map(toTaskRun);
    },
    abort: async (workspaceId, conversationId) => {
      const conversation = await store.conversations.get(workspaceId, conversationId);

      if (conversation) {
        await cancelConversation(conversation);
      }
    },
  };

  const settings: AiService['settings'] = {
    get: async (ctx) => {
      requireUser(ctx);
      await ensureReady(ctx.workspaceId);

      return store.settings.get(ctx.workspaceId);
    },
    update: async (ctx, patch) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);

      if (patch.defaultAgentId) {
        const row = await store.agents.get(ctx.workspaceId, patch.defaultAgentId);

        if (!row) {
          throw new EngineError('NOT_FOUND', `Agent "${patch.defaultAgentId}" not found`);
        }

        if (row.archivedAt) {
          throw archivedError(row.label);
        }
      }

      return store.settings.upsert(ctx.workspaceId, {
        ...(patch.defaultAgentId !== undefined ? { defaultAgentId: patch.defaultAgentId } : {}),
      });
    },
  };

  /** An agent's tool list and approval overrides, checked against the registry; returns the overrides to store. */
  const checkAgent = (input: AiAgentInput | AiAgentPatch): Record<string, 'auto' | 'approve'> | undefined => {
    const known = registry.all();

    if (input.tools) {
      const names = new Set(known.map((tool) => tool.name));
      const unknown = input.tools.filter((name) => !names.has(name));

      if (unknown.length > 0) {
        throw new EngineError('VALIDATION', `Unknown tools: ${unknown.join(', ')}`, { unknown });
      }
    }

    if (!input.approvalOverrides) {
      return undefined;
    }

    const { accepted, refused } = sanitizeOverrides(input.approvalOverrides, known);

    if (refused.length > 0) {
      throw new EngineError('VALIDATION', `These tools cannot be overridden: ${refused.join(', ')}`, { refused });
    }

    return accepted;
  };

  /** A tool list names at least one tool: an empty one would be an agent that can do nothing. */
  const checkTools = (tools: string[] | null | undefined) => {
    if (tools && tools.length === 0) {
      throw new EngineError('VALIDATION', 'An agent needs at least one tool, or null for all');
    }
  };

  /**
   * The skills an agent is given must exist and be active: an id that names none would be a list that silently
   * shrinks. One the agent already has is not asked again, so saving an agent whose skill was archived since is not
   * refused for it.
   */
  const checkSkills = async (
    workspaceId: string,
    skills: string[] | null | undefined,
    already: readonly string[] = [],
  ) => {
    if (!skills || skills.length === 0) {
      return;
    }

    const active = new Set((await store.skills.list(workspaceId)).map((row) => row.id));
    const unknown = dedupe(skills).filter((id) => !active.has(id) && !already.includes(id));

    if (unknown.length > 0) {
      throw new EngineError('VALIDATION', `Unknown or archived skills: ${unknown.join(', ')}`, { unknown });
    }
  };

  const agents: AiService['agents'] = {
    list: async (ctx, opts) => {
      requireUser(ctx);
      await ensureReady(ctx.workspaceId);

      return (await store.agents.list(ctx.workspaceId, opts?.includeArchived ?? false)).map(toAgent);
    },
    usage: async (ctx) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      const [rows, used] = await Promise.all([
        store.agents.list(ctx.workspaceId, true),
        store.conversations.usageByAgent(ctx.workspaceId),
      ]);

      return rows.map((row) => ({
        agentId: row.id,
        conversations: used.get(row.id)?.conversations ?? 0,
        usage: used.get(row.id)?.usage ?? emptyUsage(),
        lastMessageAt: used.get(row.id)?.lastMessageAt ?? null,
      }));
    },
    activity: async (ctx, id, query = {}) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);

      if (!(await store.agents.get(ctx.workspaceId, id))) {
        throw new EngineError('NOT_FOUND', `Agent "${id}" not found`);
      }

      const tz = query.tz ?? 'UTC';

      if (!isTimeZone(tz)) {
        throw new EngineError('VALIDATION', `Unknown time zone "${tz}"`);
      }

      const dates = activityDays(clock(), query.days ?? 30, tz);
      const counts = await store.conversations.activityByDay(ctx.workspaceId, id, dates[0] as string, tz);

      return {
        days: dates.map((date) => ({
          date,
          ...(counts.get(date) ?? { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 }),
        })),
      };
    },
    get: async (ctx, id) => {
      requireUser(ctx);
      await ensureReady(ctx.workspaceId);
      const row = await store.agents.get(ctx.workspaceId, id);

      if (!row) {
        throw new EngineError('NOT_FOUND', `Agent "${id}" not found`);
      }

      return toAgent(row);
    },
    create: async (ctx, input) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      checkTools(input.tools);
      await checkSkills(ctx.workspaceId, input.skills);
      const approvalOverrides = checkAgent(input) ?? {};
      const row = await store.agents.insert({
        id: newId(),
        workspaceId: ctx.workspaceId,
        label: agentLabel(input.label),
        icon: input.icon ?? null,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        tools: input.tools ? dedupe(input.tools) : null,
        skills: input.skills ? dedupe(input.skills) : null,
        starterPrompts: cleanPrompts(input.starterPrompts ?? []),
        approvalOverrides,
        takesTasks: input.takesTasks ?? false,
      });

      return toAgent(row);
    },
    update: async (ctx, id, patch) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      const current = await store.agents.get(ctx.workspaceId, id);

      if (!current) {
        throw new EngineError('NOT_FOUND', `Agent "${id}" not found`);
      }

      if (current.moduleId) {
        // What the module wrote changes with the module; the workspace keeps its approvals and the archive switch.
        const owned = (
          ['label', 'icon', 'description', 'instructions', 'tools', 'skills', 'starterPrompts'] as const
        ).filter((key) => patch[key] !== undefined);

        if (owned.length > 0) {
          throw new EngineError(
            'VALIDATION',
            `This agent comes with the module "${current.moduleId}", which owns its ${owned.join(', ')}. Change its approvals, or archive it.`,
            { owned },
          );
        }

        if (patch.archived === false && current.archivedByModule) {
          throw new EngineError(
            'CONFLICT',
            `The module "${current.moduleId}" no longer provides this agent; install it again`,
          );
        }
      }

      checkTools(patch.tools);
      await checkSkills(ctx.workspaceId, patch.skills, current.skills ?? []);
      const approvalOverrides = checkAgent(patch);
      const row = await store.agents.update(ctx.workspaceId, id, {
        ...(patch.label !== undefined ? { label: agentLabel(patch.label) } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
        ...(patch.tools !== undefined ? { tools: patch.tools ? dedupe(patch.tools) : null } : {}),
        ...(patch.skills !== undefined ? { skills: patch.skills ? dedupe(patch.skills) : null } : {}),
        ...(patch.starterPrompts ? { starterPrompts: cleanPrompts(patch.starterPrompts) } : {}),
        ...(approvalOverrides ? { approvalOverrides } : {}),
        ...(patch.takesTasks !== undefined ? { takesTasks: patch.takesTasks } : {}),
        ...(patch.archived !== undefined
          ? { archivedAt: patch.archived ? (current.archivedAt ?? clock()) : null }
          : {}),
      });

      if (patch.archived) {
        // An archived agent cannot be the default; the fallback (first active by name) takes over.
        const { defaultAgentId } = await store.settings.get(ctx.workspaceId);

        if (defaultAgentId === id) {
          await store.settings.upsert(ctx.workspaceId, { defaultAgentId: null });
        }
      }

      return toAgent(row ?? current);
    },
    delete: async (ctx, id) => {
      await agents.update(ctx, id, { archived: true });
    },
  };

  const skillLabel = (label: string): string => {
    const trimmed = label.trim();

    if (!trimmed) {
      throw new EngineError('VALIDATION', 'A skill needs a label');
    }

    return trimmed;
  };

  /**
   * What the workspace wrote must stay a short list of distinct labels: at most `SKILLS_MAX` active ones, none sharing
   * a label (any case) with another. `except` is the skill being changed.
   */
  const checkWritten = async (workspaceId: string, label: string, except?: string, counting = true) => {
    const written = (await store.skills.list(workspaceId)).filter((row) => row.moduleId === null && row.id !== except);

    if (counting && written.length >= SKILLS_MAX) {
      throw new EngineError('CONFLICT', `A workspace can have ${SKILLS_MAX} skills of its own; archive one first`);
    }

    if (written.some((row) => row.label.toLowerCase() === label.toLowerCase())) {
      throw new EngineError('CONFLICT', `A skill called "${label}" already exists`);
    }
  };

  const skills: AiService['skills'] = {
    list: async (ctx, opts) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);

      return (await store.skills.list(ctx.workspaceId, opts?.includeArchived ?? false)).map(toSkillSummary);
    },
    get: async (ctx, id) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      const row = await store.skills.get(ctx.workspaceId, id);

      if (!row) {
        throw new EngineError('NOT_FOUND', `Skill "${id}" not found`);
      }

      return toSkill(row);
    },
    create: async (ctx, input) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      const label = skillLabel(input.label);
      await checkWritten(ctx.workspaceId, label);

      return toSkill(
        await store.skills.insert({
          id: newId(),
          workspaceId: ctx.workspaceId,
          label,
          description: input.description.trim(),
          body: input.body.trim(),
        }),
      );
    },
    update: async (ctx, id, patch) => {
      requireUser(ctx);
      authorize(ctx, 'ai.manage');
      await ensureReady(ctx.workspaceId);
      const current = await store.skills.get(ctx.workspaceId, id);

      if (!current) {
        throw new EngineError('NOT_FOUND', `Skill "${id}" not found`);
      }

      if (current.moduleId) {
        // What the module wrote changes with the module; the workspace keeps the archive switch.
        const owned = (['label', 'description', 'body'] as const).filter((key) => patch[key] !== undefined);

        if (owned.length > 0) {
          throw new EngineError(
            'VALIDATION',
            `This skill comes with the module "${current.moduleId}", which owns its ${owned.join(', ')}. Archive it, or write a skill of your own.`,
            { owned },
          );
        }

        if (patch.archived === false && current.archivedByModule) {
          throw new EngineError(
            'CONFLICT',
            `The module "${current.moduleId}" no longer provides this skill; install it again`,
          );
        }
      } else {
        const label = patch.label !== undefined ? skillLabel(patch.label) : current.label;
        const restoring = patch.archived === false && current.archivedAt !== null;

        if (patch.label !== undefined || restoring) {
          await checkWritten(ctx.workspaceId, label, id, restoring);
        }
      }

      const row = await store.skills.update(ctx.workspaceId, id, {
        ...(patch.label !== undefined ? { label: skillLabel(patch.label) } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
        ...(patch.archived !== undefined
          ? { archivedAt: patch.archived ? (current.archivedAt ?? clock()) : null }
          : {}),
      });

      return toSkill(row ?? current);
    },
    delete: async (ctx, id) => {
      await skills.update(ctx, id, { archived: true });
    },
  };

  return {
    status,
    conversations,
    startTurn,
    startResolve,
    cancel,
    settings,
    agents,
    skills,
    runs,
    registry,
    store,
    purgeWorkspace: async (workspaceId) => {
      seeded.delete(workspaceId);
      await store.purgeWorkspace(workspaceId);
    },
    recover: () => store.recoverInterrupted(),
    close: async () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }

      controllers.clear();
    },
  };
};

export type { ChatEvent };
