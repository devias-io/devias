import {
  type AiAgent,
  type AiClient,
  type AiSettings,
  type AiSkill,
  type AiStatus,
  type AiStreamHandle,
  type AiToolArea,
  type AiTurn,
  type AiUsage,
  type ApprovalMode,
  activityDays,
  addUsage,
  type ChatEvent,
  type ChatMessage,
  type Conversation,
  type ConversationThread,
  calendarDay,
  DEFAULT_SUGGESTED_PROMPTS,
  DeviasApiError,
  type DisplayBlock,
  emptyUsage,
  isTimeZone,
  type NavigateTarget,
  newId,
  SKILLS_MAX,
  type ToolCall,
  toolOfAction,
} from '@devias/core';
import { deleteRecords, listRecords, lookupRecords } from './records';
import type { MockStore } from './store';

/**
 * A scripted agent for `VITE_MOCK=1`: no model, no server. It understands a few phrases so the
 * panel can be demonstrated end to end, including a pending approval that really deletes on approve:
 *   "how many companies" · "open Ada" / "show Acme" · "delete Ada" · anything else → help text.
 */

export interface MockAiOptions {
  /** Delay between streamed words, in ms (default 12). */
  latency?: number;
  now?: () => string;
  /** Report the agent as not configured (the panel shows the setup hint). */
  configured?: boolean;
}

interface Thread {
  conversation: Conversation;
  messages: ChatMessage[];
  activeTurn: AiTurn | null;
  /** Pending approvals by tool call id, with what to do on approve. */
  pending: Map<
    string,
    {
      call: ToolCall;
      messageId: string;
      execute: (values?: Record<string, string>) => unknown;
      /** Refuses an answer before anything changes, so it can be corrected and resent. */
      check?: (values?: Record<string, string>) => void;
    }
  >;
}

const TOOLS: {
  name: string;
  description: string;
  approval: ApprovalMode;
  locked?: boolean;
  area: AiToolArea;
  readOnly: boolean;
  escalates: boolean;
}[] = [
  {
    name: 'list_objects',
    description: 'List the objects in the workspace.',
    approval: 'auto',
    area: 'model',
    readOnly: true,
    escalates: false,
  },
  {
    name: 'list_records',
    description: 'List the records of one object.',
    approval: 'auto',
    area: 'records',
    readOnly: true,
    escalates: false,
  },
  {
    name: 'lookup_records',
    description: 'Find records by text.',
    approval: 'auto',
    area: 'records',
    readOnly: true,
    escalates: false,
  },
  {
    name: 'create_record',
    description: 'Create one record.',
    approval: 'auto',
    area: 'records',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'update_record',
    description: 'Update one record.',
    approval: 'auto',
    area: 'records',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'delete_records',
    description: 'Delete records by id.',
    approval: 'approve',
    area: 'records',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'create_field',
    description: 'Add a field to an object.',
    approval: 'approve',
    area: 'model',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'delete_field',
    description: 'Delete a field.',
    approval: 'approve',
    locked: true,
    area: 'model',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'create_view',
    description: 'Create a saved view.',
    approval: 'approve',
    area: 'model',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'list_workflows',
    description: 'List the workflows of the workspace.',
    approval: 'auto',
    area: 'workflows',
    readOnly: true,
    escalates: false,
  },
  {
    name: 'create_workflow',
    description: 'Create a workflow.',
    approval: 'approve',
    locked: true,
    area: 'workflows',
    readOnly: false,
    escalates: true,
  },
  {
    name: 'run_workflow',
    description: 'Run a workflow now.',
    approval: 'approve',
    area: 'workflows',
    readOnly: false,
    escalates: true,
  },
  {
    name: 'navigate',
    description: 'Open something in the interface.',
    approval: 'auto',
    area: 'interface',
    readOnly: false,
    escalates: false,
  },
  {
    name: 'ask_user',
    description: 'Ask the person a question and wait for the answer.',
    approval: 'auto',
    area: 'conversation',
    readOnly: true,
    escalates: false,
  },
];

const HELP =
  "I'm the mock agent (no model is connected). Try **how many companies**, **open Ada**, **ask me** for a question, **comment** for a comment, or **delete Ada** to see an approval.";

const cleanPrompts = (prompts: readonly string[]): string[] => [
  ...new Set(prompts.map((prompt) => prompt.trim()).filter(Boolean)),
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createMockAi = (store: MockStore, options: MockAiOptions = {}): AiClient => {
  const latency = options.latency ?? 12;
  const now = options.now ?? (() => new Date().toISOString());
  const configured = options.configured ?? true;
  const threads = new Map<string, Thread>();
  const agents = new Map<string, AiAgent>();
  const skills = new Map<string, AiSkill>();
  // Like a real workspace, it starts with one agent that has every tool; it is an ordinary, archivable agent.
  const seeded: AiAgent = {
    workspaceId: store.workspaceId,
    id: newId(),
    label: 'Assistant',
    icon: 'avatar-1',
    description: 'Works with everything in the workspace.',
    instructions: null,
    tools: null,
    skills: null,
    starterPrompts: [...DEFAULT_SUGGESTED_PROMPTS],
    approvalOverrides: {},
    takesTasks: true,
    moduleId: null,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  agents.set(seeded.id, seeded);
  let settings: AiSettings = { defaultAgentId: seeded.id, updatedAt: null };

  // Agents archived because their module went away: installing it again restores them.
  const archivedByModule = new Set<string>();
  // Skills archived because their module went away: installing it again restores them.
  const skillsArchivedByModule = new Set<string>();
  /** Make the skills match what the installed modules ship, as the server does on every use. */
  const syncModuleSkills = () => {
    const provided = new Map(
      [...store.modules.values()].flatMap((installed) =>
        installed.skills.map((definition) => [definition.id, { installed, definition }] as const),
      ),
    );

    for (const [id, { installed, definition }] of provided) {
      const existing = skills.get(id);
      const owned = {
        moduleId: installed.id,
        label: definition.label,
        description: definition.description,
        body: definition.body,
      };

      if (!existing) {
        skills.set(id, {
          workspaceId: store.workspaceId,
          ...owned,
          id,
          archivedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
      } else {
        const restore = skillsArchivedByModule.delete(id);
        skills.set(id, { ...existing, ...owned, ...(restore ? { archivedAt: null } : {}) });
      }
    }

    for (const skill of skills.values()) {
      if (skill.moduleId && !skill.archivedAt && !provided.has(skill.id)) {
        skillsArchivedByModule.add(skill.id);
        skills.set(skill.id, { ...skill, archivedAt: now() });
      }
    }
  };

  /** Make the agents match what the installed modules ship, as the server does on every use. */
  const syncModuleAgents = () => {
    syncModuleSkills();

    const provided = new Map(
      [...store.modules.values()].flatMap((installed) =>
        installed.agents.map((definition) => [definition.id, { installed, definition }] as const),
      ),
    );

    for (const [id, { installed, definition }] of provided) {
      const existing = agents.get(id);
      const owned = {
        moduleId: installed.id,
        label: definition.label,
        icon: definition.icon ?? null,
        description: definition.description ?? null,
        instructions: definition.instructions ?? null,
        tools: definition.actionIds.flatMap((id) => toolOfAction(id, installed.actions) ?? []),
        skills: [...new Set(definition.skillIds)],
        starterPrompts: cleanPrompts(definition.starterPrompts),
      };

      if (!existing) {
        agents.set(id, {
          workspaceId: store.workspaceId,
          ...owned,
          id,
          approvalOverrides: {},
          takesTasks: false,
          archivedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
      } else {
        const restore = archivedByModule.delete(existing.id);
        agents.set(existing.id, { ...existing, ...owned, ...(restore ? { archivedAt: null } : {}) });
      }
    }

    for (const a of agents.values()) {
      if (a.moduleId && !a.archivedAt && !provided.has(a.id)) {
        archivedByModule.add(a.id);
        agents.set(a.id, { ...a, archivedAt: now() });

        if (settings.defaultAgentId === a.id) {
          settings = { ...settings, defaultAgentId: null };
        }
      }
    }
  };

  const agent = (id: string): AiAgent => {
    syncModuleAgents();
    const found = agents.get(id);

    if (!found) {
      throw new DeviasApiError(404, 'NOT_FOUND', `Agent "${id}" not found`);
    }

    return found;
  };
  const byLabel = (list: AiAgent[]) => list.sort((a, b) => a.label.localeCompare(b.label));
  const active = () => {
    syncModuleAgents();

    return byLabel([...agents.values()].filter((a) => !a.archivedAt));
  };
  const archivedError = (a: AiAgent) =>
    new DeviasApiError(409, 'CONFLICT', `The agent "${a.label}" is archived; restore it or pick another agent`);
  const defaultAgent = (): AiAgent => {
    const chosen = settings.defaultAgentId ? agents.get(settings.defaultAgentId) : undefined;
    const found = chosen && !chosen.archivedAt ? chosen : active()[0];

    if (!found) {
      throw new DeviasApiError(404, 'NOT_FOUND', 'This workspace has no active agent; an admin can create one');
    }

    return found;
  };
  const knownTools = new Set(TOOLS.map((tool) => tool.name));
  /** An agent's own approval modes: only known tools, and never one that always asks. */
  const checkOverrides = (overrides: Record<string, unknown> | undefined) => {
    const refused = Object.keys(overrides ?? {}).filter((name) => {
      const tool = TOOLS.find((t) => t.name === name);

      return !tool || tool.locked;
    });

    if (refused.length > 0) {
      throw new DeviasApiError(400, 'VALIDATION', `These tools cannot be overridden: ${refused.join(', ')}`, {
        refused,
      });
    }
  };
  const checkTools = (tools: string[] | null | undefined) => {
    if (tools && tools.length === 0) {
      throw new DeviasApiError(400, 'VALIDATION', 'An agent needs at least one tool, or null for all');
    }

    const unknown = (tools ?? []).filter((name) => !knownTools.has(name));

    if (unknown.length > 0) {
      throw new DeviasApiError(400, 'VALIDATION', `Unknown tools: ${unknown.join(', ')}`, { unknown });
    }
  };

  const checkSkills = (ids: string[] | null | undefined, already: readonly string[] = []) => {
    syncModuleSkills();
    const unknown = [...new Set(ids ?? [])].filter(
      (id) => (!skills.get(id) || skills.get(id)?.archivedAt) && !already.includes(id),
    );

    if (unknown.length > 0) {
      throw new DeviasApiError(400, 'VALIDATION', `Unknown or archived skills: ${unknown.join(', ')}`, { unknown });
    }
  };
  const skillOf = (id: string): AiSkill => {
    syncModuleSkills();
    const found = skills.get(id);

    if (!found) {
      throw new DeviasApiError(404, 'NOT_FOUND', `Skill "${id}" not found`);
    }

    return found;
  };
  /** At most `SKILLS_MAX` of the workspace's own, none sharing a label; `except` is the one being changed. */
  const checkWritten = (label: string, except?: string, counting = true) => {
    const written = [...skills.values()].filter((k) => !k.moduleId && !k.archivedAt && k.id !== except);

    if (counting && written.length >= SKILLS_MAX) {
      throw new DeviasApiError(
        409,
        'CONFLICT',
        `A workspace can have ${SKILLS_MAX} skills of its own; archive one first`,
      );
    }

    if (written.some((k) => k.label.toLowerCase() === label.toLowerCase())) {
      throw new DeviasApiError(409, 'CONFLICT', `A skill called "${label}" already exists`);
    }
  };
  const withoutBody = ({ body: _body, ...summary }: AiSkill) => summary;

  const thread = (id: string): Thread => {
    const found = threads.get(id);

    if (!found) {
      throw new DeviasApiError(404, 'NOT_FOUND', `Conversation "${id}" not found`);
    }

    return found;
  };

  const touch = (t: Thread, patch: Partial<Conversation> = {}) => {
    t.conversation = { ...t.conversation, ...patch, updatedAt: now() };
  };

  const findObject = (text: string) => {
    const words = text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);

    for (const object of store.objects.values()) {
      const names = [object.nameSingular, object.namePlural, object.labelSingular, object.labelPlural].map((n) =>
        n.toLowerCase(),
      );

      if (words.some((w) => names.includes(w))) {
        return object;
      }
    }

    return undefined;
  };

  /** Runs one turn; every emitted event also updates the stored thread so reloads see the same thing. */
  const runTurn = (t: Thread, text: string, emit: (event: ChatEvent) => void): Promise<void> => {
    const turnId = newId();
    const usage: AiUsage = addUsage(emptyUsage(), { inputTokens: 120, outputTokens: 30 });
    const userMessage: ChatMessage = {
      id: newId(),
      conversationId: t.conversation.id,
      turnId,
      seq: t.messages.length + 1,
      role: 'user',
      blocks: [{ type: 'text', text }],
      text,
      createdAt: now(),
    };
    t.messages.push(userMessage);
    t.activeTurn = {
      id: turnId,
      conversationId: t.conversation.id,
      status: 'running',
      iteration: 0,
      usage: emptyUsage(),
      error: null,
      startedAt: now(),
      finishedAt: null,
    };
    touch(t, {
      activeTurnId: turnId,
      lastMessageAt: now(),
      title: t.conversation.title ?? text.slice(0, 80),
    });
    emit({
      type: 'turn_start',
      turnId,
      conversationId: t.conversation.id,
      userMessageId: userMessage.id,
      iteration: 0,
    });

    return (async () => {
      const assistant: ChatMessage = {
        id: newId(),
        conversationId: t.conversation.id,
        turnId,
        seq: t.messages.length + 1,
        role: 'assistant',
        blocks: [],
        partial: true,
        createdAt: now(),
      };
      t.messages.push(assistant);
      emit({ type: 'message_start', messageId: assistant.id, iteration: 1 });

      const say = async (reply: string) => {
        const block: DisplayBlock = { type: 'text', text: '' };
        assistant.blocks.push(block);
        const index = assistant.blocks.length - 1;

        for (const word of reply.split(/(\s+)/)) {
          if (!word) {
            continue;
          }

          block.text += word;
          emit({ type: 'text_delta', messageId: assistant.id, blockIndex: index, text: word });

          if (latency > 0 && /\S/.test(word)) {
            await sleep(latency);
          }
        }
      };
      const finishMessage = (stopReason: string) => {
        assistant.partial = false;
        assistant.stopReason = stopReason;
        assistant.usage = usage;
        assistant.model = 'mock';
        emit({ type: 'message_stop', messageId: assistant.id, stopReason, usage, model: 'mock' });
      };
      const done = () => {
        t.activeTurn = null;
        touch(t, { activeTurnId: null, usage: addUsage(t.conversation.usage, usage) });
        emit({ type: 'done', turnId, status: 'completed', stopReason: 'end_turn', usage });
      };
      const navigate = (target: NavigateTarget) => emit({ type: 'navigate', target });

      const lower = text.trim().toLowerCase();
      const del = lower.match(/^(?:delete|remove)\s+(.+)$/);
      const open = lower.match(/^(?:open|show|go to)\s+(.+)$/);

      if (/^(?:add a )?comment\b/.test(lower)) {
        const first = listRecords(store, { object: 'person', limit: 1 }).items[0];

        if (!first) {
          await say('There is no person to write a comment on yet.');
          finishMessage('end_turn');
          done();

          return;
        }

        await say('I will leave a comment on the first person. Approve to continue.');
        const input = {
          object: 'person',
          id: first.id,
          title: 'Missing contact info',
          body: 'Record is still mostly empty. Missing:\n\n- Email and phone\n- Company, job title, seniority\n- City and country\n- LinkedIn\n\nNeeds enrichment before any outreach.',
        };
        const call: ToolCall = {
          id: newId(),
          toolUseId: `toolu_${newId().slice(0, 8)}`,
          name: 'comment_on_record',
          input,
          status: 'pending',
          requiresApproval: true,
        };
        assistant.blocks.push({ type: 'tool_use', toolCall: call });
        emit({ type: 'tool_call', messageId: assistant.id, blockIndex: assistant.blocks.length - 1, toolCall: call });
        finishMessage('tool_use');
        t.pending.set(call.id, {
          call,
          messageId: assistant.id,
          execute: () => ({ created: true, title: input.title }),
        });

        if (t.activeTurn) {
          t.activeTurn = { ...t.activeTurn, status: 'awaiting_approval', iteration: 1 };
        }

        emit({ type: 'paused', turnId, pending: [call] });

        return;
      }

      if (/^ask me\b/.test(lower)) {
        await say('Before I go on, I need one thing from you.');
        const input = {
          question: 'Which pipeline should I look at?',
          options: [
            { label: 'Sales', description: 'New deals and quotes' },
            { label: 'Renewals', description: 'Customers up for renewal' },
          ],
        };
        const call: ToolCall = {
          id: newId(),
          toolUseId: `toolu_${newId().slice(0, 8)}`,
          name: 'ask_user',
          input,
          status: 'pending',
          requiresApproval: true,
          inputRequest: {
            title: input.question,
            fields: [{ name: 'answer', label: 'Your answer', secret: false, required: true }],
            question: { options: input.options.map((o) => ({ value: o.label, ...o })), other: true },
          },
        };
        assistant.blocks.push({ type: 'tool_use', toolCall: call });
        emit({ type: 'tool_call', messageId: assistant.id, blockIndex: assistant.blocks.length - 1, toolCall: call });
        finishMessage('tool_use');
        t.pending.set(call.id, {
          call,
          messageId: assistant.id,
          check: (values) => {
            if (!values?.answer?.trim()) {
              throw new DeviasApiError(400, 'VALIDATION', 'Your answer is required');
            }
          },
          execute: (values) => ({ answer: values?.answer?.trim() ?? '' }),
        });

        if (t.activeTurn) {
          t.activeTurn = { ...t.activeTurn, status: 'awaiting_approval', iteration: 1 };
        }

        emit({ type: 'paused', turnId, pending: [call] });

        return;
      }

      if (del) {
        const hit = lookupRecords(store, { text: del[1] ?? '', limit: 1 })[0];

        if (!hit) {
          await say(`I couldn't find a record matching "${del[1]}".`);
          finishMessage('end_turn');
          done();

          return;
        }

        await say(`I'll delete **${hit.title}** (${hit.object}). Approve to continue.`);
        const call: ToolCall = {
          id: newId(),
          toolUseId: `toolu_${newId().slice(0, 8)}`,
          name: 'delete_records',
          input: { object: hit.object, ids: [hit.recordId] },
          status: 'pending',
          requiresApproval: true,
        };
        assistant.blocks.push({ type: 'tool_use', toolCall: call });
        emit({ type: 'tool_call', messageId: assistant.id, blockIndex: assistant.blocks.length - 1, toolCall: call });
        finishMessage('tool_use');
        t.pending.set(call.id, {
          call,
          messageId: assistant.id,
          execute: () => {
            deleteRecords(store, hit.object, [hit.recordId]);

            return { deleted: 1, object: hit.object, ids: [hit.recordId] };
          },
        });

        if (t.activeTurn) {
          t.activeTurn = { ...t.activeTurn, status: 'awaiting_approval', iteration: 1 };
        }

        emit({ type: 'paused', turnId, pending: [call] });

        return;
      }

      if (open) {
        const hit = lookupRecords(store, { text: open[1] ?? '', limit: 1 })[0];

        if (hit) {
          navigate({ kind: 'record', object: hit.object, id: hit.recordId });
          await say(`Opening [${hit.title}](record:${hit.object}/${hit.recordId}).`);
        } else {
          const object = findObject(open[1] ?? '');

          if (object) {
            navigate({ kind: 'object', object: object.nameSingular });
            await say(`Opening ${object.labelPlural}.`);
          } else {
            await say(`I couldn't find "${open[1]}".`);
          }
        }

        finishMessage('end_turn');
        done();

        return;
      }

      if (/how many|count/.test(lower)) {
        const object = findObject(lower);

        if (object) {
          const page = listRecords(store, { object: object.nameSingular, limit: 1, count: true });
          await say(`There are **${page.totalCount ?? 0}** ${object.labelPlural.toLowerCase()}.`);
        } else {
          const names = [...store.objects.values()].map((o) => o.labelPlural.toLowerCase()).join(', ');
          await say(`Which object do you mean? I know: ${names}.`);
        }

        finishMessage('end_turn');
        done();

        return;
      }

      await say(HELP);
      finishMessage('end_turn');
      done();
    })();
  };

  const handle = (
    run: (emit: (event: ChatEvent) => void) => Promise<void>,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): AiStreamHandle => {
    let detached = false;
    const emit = (event: ChatEvent) => {
      if (!detached) {
        onEvent(event);
      }
    };
    signal?.addEventListener('abort', () => {
      detached = true;
    });

    return {
      abort: () => {
        detached = true;
      },
      done: run(emit),
    };
  };

  return {
    status: async (): Promise<AiStatus> => ({
      configured,
      model: 'mock',
      effort: 'high',
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        area: tool.area,
        readOnly: tool.readOnly,
        escalates: tool.escalates,
        approval: tool.approval,
        locked: tool.locked ?? false,
        moduleId: null,
      })),
      canManage: true,
    }),
    conversations: {
      list: async (opts) =>
        [...threads.values()]
          .map((t) => t.conversation)
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, opts?.limit ?? 50),
      create: async (input) => {
        const id = newId();
        const chosen = input?.agentId ? agent(input.agentId) : defaultAgent();

        if (chosen.archivedAt) {
          throw archivedError(chosen);
        }

        const conversation: Conversation = {
          id,
          workspaceId: store.workspaceId,
          userId: store.actor.id,
          agentId: chosen.id,
          title: input?.title ?? null,
          activeTurnId: null,
          usage: emptyUsage(),
          lastMessageAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        threads.set(id, { conversation, messages: [], activeTurn: null, pending: new Map() });

        return conversation;
      },
      get: async (id): Promise<ConversationThread> => {
        const t = thread(id);

        return structuredClone({ conversation: t.conversation, messages: t.messages, activeTurn: t.activeTurn });
      },
      delete: async (id) => {
        thread(id);
        threads.delete(id);
      },
    },
    send: (conversationId, input, onEvent, opts) => {
      const t = thread(conversationId);
      const chosen = agent(t.conversation.agentId);

      if (chosen.archivedAt) {
        throw archivedError(chosen);
      }

      if (!configured) {
        throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'AI is not configured');
      }

      if (t.activeTurn) {
        throw new DeviasApiError(409, 'CONFLICT', 'The agent is still working on this conversation');
      }

      return handle((emit) => runTurn(t, input.content, emit), onEvent, opts?.signal);
    },
    resolve: (conversationId, toolCallId, input, onEvent, opts) => {
      const t = thread(conversationId);
      const pending = t.pending.get(toolCallId);

      if (!pending || !t.activeTurn) {
        throw new DeviasApiError(409, 'CONFLICT', 'Nothing is waiting for approval');
      }

      if (input.approved) {
        pending.check?.(input.values);
      }

      return handle(
        async (emit) => {
          const turn = t.activeTurn as AiTurn;
          t.pending.delete(toolCallId);
          emit({ type: 'turn_start', turnId: turn.id, conversationId, iteration: 1 });
          const call = pending.call;

          if (input.approved) {
            const result = pending.execute(input.values);
            Object.assign(call, { status: 'executed', result, executedAt: now(), resolvedAt: now() });
            emit({ type: 'tool_result', toolCallId, status: 'executed', result, isError: false });
          } else {
            Object.assign(call, { status: 'rejected', reason: input.reason, resolvedAt: now(), isError: true });
            emit({ type: 'tool_result', toolCallId, status: 'rejected', result: { rejected: true }, isError: true });
          }

          const reply: ChatMessage = {
            id: newId(),
            conversationId,
            turnId: turn.id,
            seq: t.messages.length + 1,
            role: 'assistant',
            blocks: [],
            createdAt: now(),
          };
          t.messages.push(reply);
          emit({ type: 'message_start', messageId: reply.id, iteration: 2 });
          const text =
            call.name === 'ask_user'
              ? input.approved
                ? 'Thanks, I will go with that.'
                : 'Okay, I will carry on without it.'
              : input.approved
                ? 'Done, the record is gone.'
                : 'Okay, I left it alone.';
          reply.blocks.push({ type: 'text', text });
          emit({ type: 'text_delta', messageId: reply.id, blockIndex: 0, text });
          const usage = addUsage(emptyUsage(), { inputTokens: 80, outputTokens: 10 });
          reply.usage = usage;
          reply.model = 'mock';
          reply.stopReason = 'end_turn';
          emit({ type: 'message_stop', messageId: reply.id, stopReason: 'end_turn', usage, model: 'mock' });
          t.activeTurn = null;
          touch(t, { activeTurnId: null, usage: addUsage(t.conversation.usage, usage) });
          emit({ type: 'done', turnId: turn.id, status: 'completed', stopReason: 'end_turn', usage });
        },
        onEvent,
        opts?.signal,
      );
    },
    cancel: async (conversationId) => {
      const t = thread(conversationId);

      if (!t.activeTurn) {
        return null;
      }

      const turn: AiTurn = { ...t.activeTurn, status: 'cancelled', finishedAt: now() };

      for (const { call } of t.pending.values()) {
        Object.assign(call, { status: 'declined', resolvedAt: now() });
      }

      t.pending.clear();
      t.activeTurn = null;
      touch(t, { activeTurnId: null });

      return turn;
    },
    settings: {
      get: async () => settings,
      update: async (patch) => {
        if (patch.defaultAgentId) {
          const chosen = agent(patch.defaultAgentId);

          if (chosen.archivedAt) {
            throw archivedError(chosen);
          }
        }

        settings = {
          defaultAgentId: patch.defaultAgentId !== undefined ? patch.defaultAgentId : settings.defaultAgentId,
          updatedAt: now(),
        };

        return settings;
      },
    },
    agents: {
      activity: async (id, query = {}) => {
        agent(id);
        const tz = query.tz ?? 'UTC';

        if (!isTimeZone(tz)) {
          throw new DeviasApiError(400, 'VALIDATION', `Unknown time zone "${tz}"`);
        }

        const dates = activityDays(new Date(now()), query.days ?? 30, tz);
        const own = [...threads.values()].filter((t) => t.conversation.agentId === id);
        const on = (at: string) => calendarDay(new Date(at), tz);

        return {
          days: dates.map((date) => {
            const replies = own
              .flatMap((t) => t.messages)
              .filter((m) => m.role === 'assistant' && m.usage && on(m.createdAt) === date);

            return {
              date,
              conversations: own.filter((t) => on(t.conversation.createdAt) === date).length,
              messages: replies.length,
              inputTokens: replies.reduce((sum, m) => sum + (m.usage?.inputTokens ?? 0), 0),
              outputTokens: replies.reduce((sum, m) => sum + (m.usage?.outputTokens ?? 0), 0),
            };
          }),
        };
      },
      usage: async () =>
        [...agents.values()].map((a) => {
          const own = [...threads.values()].filter((t) => t.conversation.agentId === a.id);

          return {
            agentId: a.id,
            conversations: own.length,
            usage: own.reduce((sum, t) => addUsage(sum, t.conversation.usage), emptyUsage()),
            lastMessageAt:
              own
                .map((t) => t.conversation.lastMessageAt)
                .filter((v): v is string => v !== null)
                .sort()
                .at(-1) ?? null,
          };
        }),
      list: async (opts) => {
        syncModuleAgents();

        return (opts?.includeArchived ? byLabel([...agents.values()]) : active()).map((a) => ({ ...a }));
      },
      create: async (input) => {
        checkTools(input.tools);
        checkSkills(input.skills);
        checkOverrides(input.approvalOverrides);
        const created: AiAgent = {
          workspaceId: store.workspaceId,
          id: newId(),
          label: input.label.trim(),
          icon: input.icon ?? null,
          description: input.description ?? null,
          instructions: input.instructions ?? null,
          tools: input.tools ? [...new Set(input.tools)] : null,
          skills: input.skills ? [...new Set(input.skills)] : null,
          starterPrompts: cleanPrompts(input.starterPrompts ?? []),
          approvalOverrides: input.approvalOverrides ?? {},
          takesTasks: input.takesTasks ?? false,
          moduleId: null,
          archivedAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        agents.set(created.id, created);

        return created;
      },
      update: async (id, patch) => {
        const current = agent(id);

        if (current.moduleId) {
          const owned = (
            ['label', 'icon', 'description', 'instructions', 'tools', 'skills', 'starterPrompts'] as const
          ).filter((key) => patch[key] !== undefined);

          if (owned.length > 0) {
            throw new DeviasApiError(
              400,
              'VALIDATION',
              `This agent comes with the module "${current.moduleId}", which owns its ${owned.join(', ')}. Change its approvals, or archive it.`,
              { owned },
            );
          }

          if (patch.archived === false && archivedByModule.has(id)) {
            throw new DeviasApiError(409, 'CONFLICT', `The module "${current.moduleId}" no longer provides this agent`);
          }
        }

        checkTools(patch.tools);
        checkSkills(patch.skills, current.skills ?? []);
        checkOverrides(patch.approvalOverrides);
        const updated: AiAgent = {
          ...current,
          ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
          ...(patch.tools !== undefined ? { tools: patch.tools ? [...new Set(patch.tools)] : null } : {}),
          ...(patch.skills !== undefined ? { skills: patch.skills ? [...new Set(patch.skills)] : null } : {}),
          ...(patch.starterPrompts ? { starterPrompts: cleanPrompts(patch.starterPrompts) } : {}),
          ...(patch.approvalOverrides ? { approvalOverrides: patch.approvalOverrides } : {}),
          ...(patch.takesTasks !== undefined ? { takesTasks: patch.takesTasks } : {}),
          ...(patch.archived !== undefined
            ? { archivedAt: patch.archived ? (current.archivedAt ?? now()) : null }
            : {}),
          updatedAt: now(),
        };
        agents.set(id, updated);

        if (patch.archived && settings.defaultAgentId === id) {
          settings = { ...settings, defaultAgentId: null };
        }

        return updated;
      },
      delete: async (id) => {
        const current = agent(id);
        agents.set(id, { ...current, archivedAt: current.archivedAt ?? now(), updatedAt: now() });

        if (settings.defaultAgentId === id) {
          settings = { ...settings, defaultAgentId: null };
        }
      },
    },
    skills: {
      list: async (opts) => {
        syncModuleSkills();

        return [...skills.values()]
          .filter((k) => opts?.includeArchived || !k.archivedAt)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(withoutBody);
      },
      get: async (id) => ({ ...skillOf(id) }),
      create: async (input) => {
        const label = input.label.trim();
        checkWritten(label);
        const created: AiSkill = {
          workspaceId: store.workspaceId,
          id: newId(),
          label,
          description: input.description.trim(),
          body: input.body.trim(),
          moduleId: null,
          archivedAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        skills.set(created.id, created);

        return created;
      },
      update: async (id, patch) => {
        const current = skillOf(id);

        if (current.moduleId) {
          const owned = (['label', 'description', 'body'] as const).filter((key) => patch[key] !== undefined);

          if (owned.length > 0) {
            throw new DeviasApiError(
              400,
              'VALIDATION',
              `This skill comes with the module "${current.moduleId}", which owns its ${owned.join(', ')}. Archive it, or write a skill of your own.`,
              { owned },
            );
          }

          if (patch.archived === false && skillsArchivedByModule.has(id)) {
            throw new DeviasApiError(409, 'CONFLICT', `The module "${current.moduleId}" no longer provides this skill`);
          }
        } else {
          const restoring = patch.archived === false && current.archivedAt !== null;

          if (patch.label !== undefined || restoring) {
            checkWritten(patch.label?.trim() ?? current.label, id, restoring);
          }
        }

        const updated: AiSkill = {
          ...current,
          ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
          ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
          ...(patch.archived !== undefined
            ? { archivedAt: patch.archived ? (current.archivedAt ?? now()) : null }
            : {}),
          updatedAt: now(),
        };
        skills.set(id, updated);

        return updated;
      },
      delete: async (id) => {
        const current = skillOf(id);
        skills.set(id, { ...current, archivedAt: current.archivedAt ?? now(), updatedAt: now() });
      },
    },
  };
};
