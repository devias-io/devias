import type { AiAgent, AiToolInfo, ApprovalMode } from '@devias/core';
import { AI_TOOL_AREAS } from '@devias/core';
import { isPlain, toolLabel } from '../../agent-chat/chat/tool-call-summary';

/** The tools the agent-approval card handles. */
export const AGENT_APPROVAL_TOOLS = ['create_agent', 'update_agent', 'archive_agent'] as const;

export interface AgentCallSummary {
  /** The sentence: what approving does. */
  verb: 'create' | 'update' | 'archive';
  /** The agent, as it is called after the call. */
  name: string;
  /** The existing agent the call is about, when it is one (for a link to its page). */
  agentId?: string;
  /** One short line per thing that will be or change. */
  lines: string[];
  /** Set when the call gives the agent tools that reach beyond what their names say. */
  warning: string | null;
}

const MAX_NAMED = 4;
const EXCERPT = 140;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** "A and B", "A, B and C", "A, B, C, D and 2 more": a list that stays one line. */
const named = (names: string[]): string => {
  const shown = names.length <= MAX_NAMED ? names : names.slice(0, MAX_NAMED);
  const rest = names.length - shown.length;

  if (rest > 0) {
    return `${shown.join(', ')} and ${rest} more`;
  }

  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
};

const titles = (names: string[]): string[] => names.map((name) => toolLabel(name).title);

const excerpt = (value: string): string => (value.length > EXCERPT ? `${value.slice(0, EXCERPT).trimEnd()}…` : value);

/** "5 tools in Records and Data model": how many, and where they work. */
const toolsLine = (names: string[], catalog: Map<string, AiToolInfo>): string => {
  const areas = AI_TOOL_AREAS.filter((area) => names.some((name) => catalog.get(name)?.area === area.key)).map(
    (area) => area.label,
  );
  const count = `${names.length} ${names.length === 1 ? 'tool' : 'tools'}`;

  return areas.length > 0 ? `${count} in ${named(areas)}` : count;
};

/** The tools a call gives an agent that run without asking or reach beyond their name, as one warning (or none). */
const warningFor = (granted: string[] | 'all', catalog: Map<string, AiToolInfo>): string | null => {
  if (granted === 'all') {
    return 'It would have every tool, including those that reach beyond their name: workflows, API keys, members, modules and agents.';
  }

  const reaching = granted.filter((name) => catalog.get(name)?.escalates);

  return reaching.length > 0 ? `Reaches beyond what its name says: ${named(titles(reaching))}.` : null;
};

/** The tools that ask by default but would run on their own for this agent. */
const runsFreely = (overrides: unknown, catalog: Map<string, AiToolInfo>): string[] =>
  isPlain(overrides)
    ? Object.entries(overrides)
        .filter(([name, mode]) => (mode as ApprovalMode) === 'auto' && catalog.get(name)?.approval === 'approve')
        .map(([name]) => name)
    : [];

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((item) => b.includes(item));

/**
 * What approving an agent tool call does, in plain lines: the agent it creates, what an update changes against the
 * agent as it is now, or what archiving takes away. Pure, so the card only has to draw it.
 */
export const summarizeAgentCall = (
  call: { name: string; input: unknown },
  agents: readonly AiAgent[],
  tools: readonly AiToolInfo[],
): AgentCallSummary => {
  const input = isPlain(call.input) ? call.input : {};
  const catalog = new Map(tools.map((tool) => [tool.name, tool]));
  const id = text(input.id);
  const current = id ? agents.find((agent) => agent.id === id) : undefined;

  if (call.name === 'archive_agent') {
    return {
      verb: 'archive',
      name: current?.name ?? 'this agent',
      ...(id ? { agentId: id } : {}),
      lines: ['It takes no new messages and leaves the pickers. Its conversations stay readable.'],
      warning: null,
    };
  }

  if (call.name === 'create_agent') {
    const lines: string[] = [];
    const description = text(input.description);

    if (description) {
      lines.push(description);
    }

    const list = input.tools === null || input.tools === undefined ? null : strings(input.tools);
    lines.push(list === null ? 'Every tool the person may use, and ones added later' : toolsLine(list, catalog));
    const free = runsFreely(input.approvalOverrides, catalog);

    if (free.length > 0) {
      lines.push(`Runs without asking: ${named(titles(free))}`);
    }

    const instructions = text(input.instructions);

    if (instructions) {
      lines.push(`Instructions: “${excerpt(instructions)}”`);
    }

    const prompts = strings(input.starterPrompts);

    if (prompts.length > 0) {
      lines.push(`${prompts.length} starter ${prompts.length === 1 ? 'prompt' : 'prompts'}`);
    }

    return {
      verb: 'create',
      name: text(input.name) ?? 'a new agent',
      lines,
      warning: warningFor(list ?? 'all', catalog),
    };
  }

  // update_agent: only what is given changes, so say what differs from the agent as it is.
  const lines: string[] = [];
  let granted: string[] | 'all' = [];
  const name = text(input.name) ?? current?.name ?? 'this agent';

  if (text(input.name) && current && text(input.name) !== current.name) {
    lines.push(`Name: ${current.name} → ${text(input.name)}`);
  }

  if (typeof input.archived === 'boolean') {
    lines.push(input.archived ? 'Archives it: no new messages, off the pickers' : 'Restores it to the pickers');
  }

  if ('description' in input) {
    lines.push(text(input.description) ? `Purpose: ${text(input.description)}` : 'Clears its purpose');
  }

  if ('instructions' in input) {
    const instructions = text(input.instructions);
    lines.push(instructions ? `Instructions: “${excerpt(instructions)}”` : 'Clears its instructions');
  }

  if ('tools' in input) {
    const next = input.tools === null ? null : strings(input.tools);
    const before = current?.tools ?? null;

    if (next === null) {
      if (before !== null) {
        lines.push('Tools: now every tool the person may use, and ones added later');
        granted = 'all';
      }
    } else if (before === null) {
      lines.push(`Tools: limited to ${toolsLine(next, catalog)}`);
    } else if (!sameSet(next, before)) {
      const added = next.filter((tool) => !before.includes(tool));
      const removed = before.filter((tool) => !next.includes(tool));

      if (added.length > 0) {
        lines.push(`Adds ${named(titles(added))}`);
      }

      if (removed.length > 0) {
        lines.push(`Removes ${named(titles(removed))}`);
      }

      granted = added;
    }
  }

  if ('approvalOverrides' in input) {
    const free = runsFreely(input.approvalOverrides, catalog);
    const before = runsFreely(current?.approvalOverrides, catalog);

    if (!sameSet(free, before)) {
      lines.push(free.length > 0 ? `Runs without asking: ${named(titles(free))}` : 'Every tool asks first again');
    }
  }

  if ('starterPrompts' in input) {
    lines.push(`Starter prompts: ${strings(input.starterPrompts).length}`);
  }

  if ('icon' in input && text(input.icon) !== (current?.icon ?? undefined)) {
    lines.push(`Icon: ${text(input.icon) ?? 'none'}`);
  }

  return {
    verb: 'update',
    name,
    ...(id ? { agentId: id } : {}),
    lines: lines.length > 0 ? lines : ['Nothing changes.'],
    warning: warningFor(granted, catalog),
  };
};
