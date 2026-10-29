import { z } from 'zod';
import type { AnyActionSpec } from './actions/define';
import { POLICY_DECISIONS } from './manifest/consent';
import { CONNECTION_VISIBILITIES, SettingFieldSchema } from './module-runtime';
import type { Permission } from './permissions';
import { isTimeZone, WORKFLOW_ACTIVITY_MAX_DAYS } from './workflow';

/**
 * Contracts for the agent: the event stream a turn produces, the persisted conversation
 * shapes, and the settings. Shared by the server (`@devias/ai`), the SDK (HTTP + mock) and the studio.
 */

/** Tool names must satisfy the model API's constraint. A module action's tool is its `name`, with no module in front. */
export const AI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const ApprovalModeSchema = z.enum(['auto', 'approve']).meta({ id: 'ApprovalMode' });
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ToolCallStatusSchema = z
  .enum(['pending', 'approved', 'rejected', 'running', 'executed', 'failed', 'declined'])
  .meta({ id: 'ToolCallStatus' });
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

/**
 * What a call needs from the person. Usually what the model must never see, or must agree to knowingly. Values (an API key):
 * the card renders these fields and the values go from the person to the server with the approval, straight into
 * the run, never stored. An account to connect: the card opens the provider's consent page, and the person
 * connecting it approves the call. A module to install: the card shows what it may do, and installing is consenting.
 * A question is the exception: its answer is for the agent, and comes back as the call's result.
 */
export const InputRequestSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    fields: z.array(SettingFieldSchema).default([]),
    /**
     * A question for the person, whose answer goes back to the agent: the card offers the options (none means a free
     * text answer) and, with `other`, a box for an answer of their own. The answer is the single field `answer`.
     */
    question: z
      .object({
        options: z.array(z.object({ value: z.string(), label: z.string(), description: z.string().optional() })),
        other: z.boolean(),
      })
      .optional(),
    connect: z
      .object({
        module: z.string(),
        provider: z.string(),
        visibility: z.enum(CONNECTION_VISIBILITIES),
        /** The provider as people know it: "Google account". */
        label: z.string(),
      })
      .optional(),
    consent: z
      .object({
        module: z.string(),
        label: z.string(),
        version: z.string(),
        /** An upgrade: the version installed now. */
        fromVersion: z.string().nullable(),
        policies: z.array(z.object({ description: z.string(), decision: z.enum(POLICY_DECISIONS) })),
        /** What installing changes, in words: "Adds 2 objects, 13 fields". */
        changes: z.array(z.string()),
        /** The manifest this card describes: installing applies it, or nothing when the server's changed since. */
        manifestHash: z.string(),
      })
      .optional(),
  })
  .meta({ id: 'InputRequest' });
export type InputRequest = z.infer<typeof InputRequestSchema>;

/** A value a call produced for the person only (a new API key): shown once in the card, never to the model. */
export const RevealedValueSchema = z.object({ label: z.string(), value: z.string() }).meta({ id: 'RevealedValue' });
export type RevealedValue = z.infer<typeof RevealedValueSchema>;

export const ToolCallSchema = z
  .object({
    id: z.string(),
    toolUseId: z.string(),
    name: z.string(),
    input: z.unknown(),
    status: ToolCallStatusSchema,
    requiresApproval: z.boolean(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
    reason: z.string().optional(),
    resolvedAt: z.string().optional(),
    executedAt: z.string().optional(),
    /** The call waits for these values from the person (with their approval). */
    inputRequest: InputRequestSchema.optional(),
    /** Only on the live `tool_result` event, never stored: values for the person's eyes. */
    revealed: z.array(RevealedValueSchema).optional(),
  })
  .meta({ id: 'ToolCall' });
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const NavigateTargetSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('record'), object: z.string(), id: z.string() }),
    z.object({ kind: z.literal('object'), object: z.string(), viewId: z.string().optional() }),
    z.object({ kind: z.literal('settings'), section: z.string().optional() }),
    z.object({ kind: z.literal('page'), pagePath: z.string() }),
    /** A workflow in the workflow editor. */
    z.object({ kind: z.literal('workflow'), id: z.string() }),
    z.object({ kind: z.literal('document'), id: z.string() }),
    z.object({ kind: z.literal('task'), id: z.string() }),
  ])
  .meta({ id: 'NavigateTarget' });
export type NavigateTarget = z.infer<typeof NavigateTargetSchema>;

export const AiUsageSchema = z
  .object({
    inputTokens: z.number().int().default(0),
    outputTokens: z.number().int().default(0),
    cacheReadInputTokens: z.number().int().default(0),
    cacheCreationInputTokens: z.number().int().default(0),
  })
  .meta({ id: 'AiUsage' });
export type AiUsage = z.infer<typeof AiUsageSchema>;

export const emptyUsage = (): AiUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

export const addUsage = (a: AiUsage, b: Partial<AiUsage>): AiUsage => ({
  inputTokens: a.inputTokens + (b.inputTokens ?? 0),
  outputTokens: a.outputTokens + (b.outputTokens ?? 0),
  cacheReadInputTokens: a.cacheReadInputTokens + (b.cacheReadInputTokens ?? 0),
  cacheCreationInputTokens: a.cacheCreationInputTokens + (b.cacheCreationInputTokens ?? 0),
});

export const TurnStatusSchema = z
  .enum(['running', 'awaiting_approval', 'completed', 'failed', 'cancelled'])
  .meta({ id: 'TurnStatus' });
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

export const AiTurnSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    status: TurnStatusSchema,
    iteration: z.number().int(),
    usage: AiUsageSchema,
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'AiTurn' });
export type AiTurn = z.infer<typeof AiTurnSchema>;

// ---------------------------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------------------------

export const ChatEventSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('turn_start'),
      turnId: z.string(),
      conversationId: z.string(),
      userMessageId: z.string().optional(),
      iteration: z.number().int(),
    }),
    z.object({ type: z.literal('message_start'), messageId: z.string(), iteration: z.number().int() }),
    z.object({ type: z.literal('text_delta'), messageId: z.string(), blockIndex: z.number().int(), text: z.string() }),
    z.object({
      type: z.literal('thinking_delta'),
      messageId: z.string(),
      blockIndex: z.number().int(),
      text: z.string(),
    }),
    z.object({ type: z.literal('thinking_stop'), messageId: z.string(), blockIndex: z.number().int() }),
    z.object({
      type: z.literal('tool_call_start'),
      messageId: z.string(),
      blockIndex: z.number().int(),
      toolUseId: z.string(),
      name: z.string(),
    }),
    z.object({
      type: z.literal('tool_call_input_delta'),
      messageId: z.string(),
      blockIndex: z.number().int(),
      partialJson: z.string(),
    }),
    z.object({
      type: z.literal('tool_call'),
      messageId: z.string(),
      blockIndex: z.number().int(),
      toolCall: ToolCallSchema,
    }),
    z.object({
      type: z.literal('tool_result'),
      toolCallId: z.string(),
      status: ToolCallStatusSchema,
      result: z.unknown().optional(),
      isError: z.boolean(),
      /** Values for the person only, sent once on this event; the model and the stored result never have them. */
      revealed: z.array(RevealedValueSchema).optional(),
    }),
    z.object({
      type: z.literal('message_stop'),
      messageId: z.string(),
      stopReason: z.string().nullable(),
      usage: AiUsageSchema,
      model: z.string(),
    }),
    z.object({ type: z.literal('navigate'), target: NavigateTargetSchema }),
    z.object({ type: z.literal('paused'), turnId: z.string(), pending: z.array(ToolCallSchema) }),
    z.object({
      type: z.literal('done'),
      turnId: z.string(),
      status: z.enum(['completed', 'cancelled', 'failed']),
      stopReason: z.string().nullable().optional(),
      truncated: z.boolean().optional(),
      usage: AiUsageSchema,
    }),
    z.object({
      type: z.literal('error'),
      turnId: z.string().optional(),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  ])
  .meta({ id: 'ChatEvent' });
export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type ChatEventType = ChatEvent['type'];

// ---------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------

export const ChatContextSchema = z
  .object({
    page: z
      .object({
        object: z.string().optional(),
        recordId: z.string().optional(),
        viewId: z.string().optional(),
        /** The studio page open, by path (`billing/new`). */
        path: z.string().optional(),
        /** The workflow open in the workflow editor. */
        workflowId: z.string().optional(),
      })
      .optional(),
  })
  .meta({ id: 'ChatContext' });
export type ChatContext = z.infer<typeof ChatContextSchema>;

export const SendMessageInputSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    context: ChatContextSchema.optional(),
  })
  .meta({ id: 'SendMessageInput' });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const ResolveToolCallInputSchema = z
  .object({
    approved: z.boolean(),
    reason: z.string().max(2000).optional(),
    /** Answers to the call's input request, by field key. Used for that one run, never stored or shown to the model. */
    values: z.record(z.string(), z.string().max(10_000)).optional(),
  })
  .meta({ id: 'ResolveToolCallInput' });
export type ResolveToolCallInput = z.infer<typeof ResolveToolCallInputSchema>;

export const ConversationSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    userId: z.string(),
    /** The agent this conversation is with. */
    agentId: z.string(),
    title: z.string().nullable(),
    activeTurnId: z.string().nullable(),
    usage: AiUsageSchema,
    lastMessageAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Conversation' });
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationInputSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** The agent to talk to; the workspace's default agent when omitted. */
    agentId: z.string().optional(),
  })
  .meta({ id: 'CreateConversationInput' });
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

/** What the studio renders: the agent's content blocks in order, with tool calls joined in. */
export const DisplayBlockSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('thinking'), text: z.string() }),
    z.object({ type: z.literal('tool_use'), toolCall: ToolCallSchema }),
  ])
  .meta({ id: 'DisplayBlock' });
export type DisplayBlock = z.infer<typeof DisplayBlockSchema>;

export const ChatMessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    seq: z.number().int(),
    role: z.enum(['user', 'assistant']),
    blocks: z.array(DisplayBlockSchema),
    /** For user messages: the text as typed (without the injected context block). */
    text: z.string().optional(),
    context: ChatContextSchema.optional(),
    model: z.string().optional(),
    usage: AiUsageSchema.optional(),
    stopReason: z.string().nullable().optional(),
    partial: z.boolean().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'ChatMessage' });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationThreadSchema = z
  .object({
    conversation: ConversationSchema,
    messages: z.array(ChatMessageSchema),
    activeTurn: AiTurnSchema.nullable(),
  })
  .meta({ id: 'ConversationThread' });
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;

// ---------------------------------------------------------------------------------------------
// Status and settings
// ---------------------------------------------------------------------------------------------

/** What a tool works on, in the order the studio lists the areas and the system prompt adds its sections. */
export const AI_TOOL_AREAS = [
  { key: 'records', label: 'Records' },
  { key: 'model', label: 'Data model' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'documents', label: 'Documents' },
  { key: 'assets', label: 'Assets' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'modules', label: 'Modules' },
  { key: 'actions', label: 'Module actions' },
  { key: 'people', label: 'People and access' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'agents', label: 'Agents and AI' },
  { key: 'skills', label: 'Skills' },
  { key: 'interface', label: 'Open things' },
  { key: 'conversation', label: 'Asking the person' },
] as const;

export type AiToolArea = (typeof AI_TOOL_AREAS)[number]['key'];
export const AiToolAreaSchema = z.enum(AI_TOOL_AREAS.map((area) => area.key) as [AiToolArea, ...AiToolArea[]]);

/** The area of the tools that serve the core actions with a tag (`metadata` → `model`). */
export const ACTION_AREA_BY_TAG: Readonly<Record<string, AiToolArea>> = {
  metadata: 'model',
  records: 'records',
  activity: 'records',
  comments: 'records',
  workflows: 'workflows',
  documents: 'documents',
  assets: 'assets',
  tasks: 'tasks',
  modules: 'modules',
  members: 'people',
  'api-keys': 'people',
  notifications: 'notifications',
  ai: 'agents',
  skills: 'skills',
};

/**
 * The area of the tool an action is served by, from what the action works on (its first tag). Actions a module
 * declares are module actions; so is anything unmapped, and a test makes sure core maps all of its own.
 */
export const areaOfAction = (spec: Pick<AnyActionSpec, 'tags' | 'module'>): AiToolArea =>
  spec.module !== null ? 'actions' : (ACTION_AREA_BY_TAG[spec.tags[0] ?? ''] ?? 'actions');

/**
 * Permissions that reach beyond what a tool's name suggests: workflows run with their own record and module
 * permissions, and keys, members, modules and agents change what everyone can do. Tools needing one are flagged.
 */
export const ESCALATING_PERMISSIONS: readonly Permission[] = [
  'workflow.manage',
  'workflow.run',
  'module.manage',
  'member.manage',
  'apikey.manage',
  'ai.manage',
  'task.control',
];

export const AiToolInfoSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    area: AiToolAreaSchema,
    /** Only reads. */
    readOnly: z.boolean(),
    /** Reaches beyond what its name suggests (see `ESCALATING_PERMISSIONS`); a flag, it blocks nothing. */
    escalates: z.boolean(),
    /** What the tool does when an agent calls it, unless the agent sets its own mode. */
    approval: ApprovalModeSchema,
    /** True when the mode cannot be loosened, not even by an agent (e.g. deleting fields). */
    locked: z.boolean(),
    moduleId: z.string().nullable(),
  })
  .meta({ id: 'AiToolInfo' });
export type AiToolInfo = z.infer<typeof AiToolInfoSchema>;

/**
 * What the Home composer and an empty conversation suggest, until a workspace sets its own: the end of "I want to …".
 * They name no object or module, since any of them may be missing: only what every workspace has (objects, records,
 * fields, workflows).
 */
export const DEFAULT_SUGGESTED_PROMPTS = [
  'see how many records I have in each object',
  'find what was created or changed today',
  'add a field to one of my objects',
  'set up a workflow that tells me when something changes',
] as const;
export const SUGGESTED_PROMPTS_MAX = 5;
export const SUGGESTED_PROMPT_MAX_LENGTH = 120;

export const SuggestedPromptSchema = z.string().trim().min(1).max(SUGGESTED_PROMPT_MAX_LENGTH);

export const AiStatusSchema = z
  .object({
    configured: z.boolean(),
    model: z.string(),
    effort: z.string(),
    /** What this person may use, with each tool's own approval mode: the catalog agents pick their tools from. */
    tools: z.array(AiToolInfoSchema),
    canManage: z.boolean(),
  })
  .meta({ id: 'AiStatus' });
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const AiSettingsSchema = z
  .object({
    /** The agent Home and "new conversation" use; null falls back to the first active agent by name. */
    defaultAgentId: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .meta({ id: 'AiSettings' });
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** Only what is given changes. `defaultAgentId` must be an active agent, or null. */
export const AiSettingsPatchSchema = z
  .object({
    defaultAgentId: z.string().nullable().optional(),
  })
  .meta({ id: 'AiSettingsPatch' });
export type AiSettingsPatch = z.infer<typeof AiSettingsPatchSchema>;

// ---------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------

export const SKILL_LABEL_MAX = 80;
export const SKILL_DESCRIPTION_MAX = 300;
export const SKILL_BODY_MAX = 20_000;
/** Skills a workspace writes itself: the list an agent sees stays short. */
export const SKILLS_MAX = 50;
/** Skills one module ships. */
export const MODULE_SKILLS_MAX = 20;

/** What an agent sees of a skill before it loads it: when to use it, not how. */
export const AiSkillSummarySchema = z
  .object({
    workspaceId: z.string(),
    /** A uuid for a skill the workspace wrote, the id its module gave it for one a module ships. */
    id: z.string(),
    label: z.string(),
    /** One line saying when the skill is for. */
    description: z.string(),
    /** The module that ships it, or null for a skill the workspace wrote. A module's skill follows the module. */
    moduleId: z.string().nullable(),
    /** When it was archived; an archived skill is listed and loaded by no agent. */
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'AiSkillSummary' });
export type AiSkillSummary = z.infer<typeof AiSkillSummarySchema>;

export const AiSkillSchema = AiSkillSummarySchema.extend({
  /** The procedure, as Markdown. */
  body: z.string(),
}).meta({ id: 'AiSkill' });
export type AiSkill = z.infer<typeof AiSkillSchema>;

export const AiSkillInputSchema = z
  .object({
    label: z.string().trim().min(1).max(SKILL_LABEL_MAX),
    description: z.string().trim().min(1).max(SKILL_DESCRIPTION_MAX).describe('One line saying when to use the skill'),
    body: z.string().trim().min(1).max(SKILL_BODY_MAX).describe('The procedure to follow, as Markdown'),
  })
  .meta({ id: 'AiSkillInput' });
export type AiSkillInput = z.infer<typeof AiSkillInputSchema>;

/** Only what is given changes. `archived: true` archives the skill and `false` restores it. */
export const AiSkillPatchSchema = AiSkillInputSchema.partial()
  .extend({ archived: z.boolean().optional() })
  .meta({ id: 'AiSkillPatch' });
export type AiSkillPatch = z.infer<typeof AiSkillPatchSchema>;

/**
 * What a person talks to: instructions, a set of tools and its own approvals. It acts for the person chatting, with
 * their role, and its tool list is the only thing that bounds it. Agents are archived, never deleted, so their
 * conversations stay readable.
 */
export const AiAgentSchema = z
  .object({
    workspaceId: z.string(),
    /** A uuid for an agent the workspace made, the id its module gave it for one a module ships. */
    id: z.string(),
    label: z.string(),
    icon: z.string().nullable(),
    /** What the agent is for, shown where people pick one. */
    description: z.string().nullable(),
    /** Added to the system prompt for this agent's conversations. */
    instructions: z.string().nullable(),
    /** Tool names the agent may use; null means every tool the person may use, including ones added later. */
    tools: z.array(z.string()).nullable(),
    /** The end of "I want to …" this agent suggests on Home and in an empty conversation. */
    starterPrompts: z.array(z.string()),
    /** Approval modes for this agent, by tool, on top of each tool's own mode. */
    approvalOverrides: z.record(z.string(), ApprovalModeSchema),
    /** Ids of the skills it may use; null means every active skill, including ones added later. */
    skills: z.array(z.string()).nullable(),
    /** Whether tasks can be given to it: when one is, it works the task on its own and hands it back for review. */
    takesTasks: z.boolean(),
    /** The module that ships it, or null for an agent the workspace made. A module's agent follows the module. */
    moduleId: z.string().nullable(),
    /** When it was archived; archived agents take no new messages. */
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'AiAgent' });
export type AiAgent = z.infer<typeof AiAgentSchema>;

export const AiAgentInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    icon: z.string().max(64).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    instructions: z.string().max(20_000).nullable().optional(),
    /** At least one tool, or null for every tool. */
    tools: z.array(z.string()).min(1).max(500).nullable().optional(),
    starterPrompts: z.array(SuggestedPromptSchema).max(SUGGESTED_PROMPTS_MAX).optional(),
    approvalOverrides: z.record(z.string(), ApprovalModeSchema).optional(),
    /** Ids of the skills it may use, or null for every active skill (the default). */
    skills: z.array(z.string()).max(SKILLS_MAX).nullable().optional(),
    /** Default false. */
    takesTasks: z.boolean().optional(),
  })
  .meta({ id: 'AiAgentInput' });
export type AiAgentInput = z.infer<typeof AiAgentInputSchema>;

/**
 * Only what is given changes; null clears the icon, description or instructions, and `tools: null` allows every tool.
 * `archived: true` archives the agent and `false` restores it.
 */
export const AiAgentPatchSchema = AiAgentInputSchema.partial()
  .extend({ archived: z.boolean().optional() })
  .meta({ id: 'AiAgentPatch' });
export type AiAgentPatch = z.infer<typeof AiAgentPatchSchema>;

/**
 * What an agent has been used for: how many conversations are with it (everyone's, archived ones included) and the
 * tokens they used, groundwork for budgets. Only people who manage agents see it.
 */
export const AiAgentUsageSchema = z
  .object({
    agentId: z.string(),
    conversations: z.number().int(),
    /** Summed over the agent's conversations. */
    usage: AiUsageSchema,
    /** When any conversation with it last had a message; null if none has. */
    lastMessageAt: z.string().nullable(),
  })
  .meta({ id: 'AiAgentUsage' });
export type AiAgentUsage = z.infer<typeof AiAgentUsageSchema>;

/** Which days of an agent's activity to count, and in which time zone (the same two knobs as workflow activity). */
export const AiAgentActivityQuerySchema = z
  .object({
    /** Days to count back, today included (default 30). */
    days: z.coerce.number().int().min(1).max(WORKFLOW_ACTIVITY_MAX_DAYS).optional(),
    /** The IANA time zone the days are counted in (default UTC). */
    tz: z.string().refine(isTimeZone, 'Unknown time zone').optional(),
  })
  .meta({ id: 'AiAgentActivityQuery' });
export type AiAgentActivityQuery = z.infer<typeof AiAgentActivityQuerySchema>;

export const AiAgentActivityDaySchema = z
  .object({
    /** `YYYY-MM-DD`, in the query's time zone. */
    date: z.string(),
    /** Conversations with the agent that started that day. */
    conversations: z.number().int(),
    /** Replies the agent gave that day. */
    messages: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  })
  .meta({ id: 'AiAgentActivityDay' });
export type AiAgentActivityDay = z.infer<typeof AiAgentActivityDaySchema>;

export const AiAgentActivitySchema = z
  .object({
    /** Every day of the period, oldest first and today last; a day without activity counts zero. */
    days: z.array(AiAgentActivityDaySchema),
  })
  .meta({ id: 'AiAgentActivity' });
export type AiAgentActivity = z.infer<typeof AiAgentActivitySchema>;

// ---------------------------------------------------------------------------------------------
// Client contract
// ---------------------------------------------------------------------------------------------

export interface AiStreamHandle {
  /** Stop listening. The server keeps running the turn; call `cancel` to stop it. */
  abort(): void;
  /** Resolves when the stream ends, rejects on transport or API errors. */
  done: Promise<void>;
}

export interface AiStreamOptions {
  signal?: AbortSignal;
}

export interface AiClient {
  status(): Promise<AiStatus>;
  conversations: {
    list(opts?: { limit?: number }): Promise<Conversation[]>;
    create(input?: CreateConversationInput): Promise<Conversation>;
    get(id: string): Promise<ConversationThread>;
    delete(id: string): Promise<void>;
  };
  send(
    conversationId: string,
    input: SendMessageInput,
    onEvent: (event: ChatEvent) => void,
    opts?: AiStreamOptions,
  ): AiStreamHandle;
  resolve(
    conversationId: string,
    toolCallId: string,
    input: ResolveToolCallInput,
    onEvent: (event: ChatEvent) => void,
    opts?: AiStreamOptions,
  ): AiStreamHandle;
  cancel(conversationId: string): Promise<AiTurn | null>;
  settings: {
    get(): Promise<AiSettings>;
    update(patch: AiSettingsPatch): Promise<AiSettings>;
  };
  /** The workspace's agents; everyone lists them, owners and admins manage them. */
  agents: {
    list(opts?: { includeArchived?: boolean }): Promise<AiAgent[]>;
    create(input: AiAgentInput): Promise<AiAgent>;
    update(id: string, patch: AiAgentPatch): Promise<AiAgent>;
    /** Conversations and tokens per agent (owners and admins); every agent has a row, used or not. */
    usage(): Promise<AiAgentUsage[]>;
    /** One agent's conversations, replies and tokens per day (owners and admins). */
    activity(id: string, query?: AiAgentActivityQuery): Promise<AiAgentActivity>;
    /** Archives the agent; `update(id, { archived: false })` restores it. */
    delete(id: string): Promise<void>;
  };
  /** The workspace's skills: procedures agents load when a request calls for them (owners and admins). */
  skills: {
    list(opts?: { includeArchived?: boolean }): Promise<AiSkillSummary[]>;
    get(id: string): Promise<AiSkill>;
    create(input: AiSkillInput): Promise<AiSkill>;
    update(id: string, patch: AiSkillPatch): Promise<AiSkill>;
    /** Archives the skill; `update(id, { archived: false })` restores it. */
    delete(id: string): Promise<void>;
  };
}
