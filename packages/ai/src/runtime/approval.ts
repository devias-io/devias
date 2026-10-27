import type { AiToolInfo, ApprovalMode } from '@devias/core';
import type { ToolDefinition } from '../tools/types';

/**
 * The "Balanced" policy: reads, record creates and updates run immediately; record deletes, data-model changes and
 * view changes pause for approval. Each tool ships its default; an agent may set its own mode per tool unless the
 * tool is locked (deleting a field always asks).
 */

export type ApprovalOverrides = Record<string, ApprovalMode>;

/** How a tool is run for an agent: the agent's own mode for it, else the tool's default; a locked tool always asks. */
export const effectiveApproval = (tool: ToolDefinition, overrides: ApprovalOverrides): ApprovalMode => {
  if (tool.locked) {
    return tool.approval;
  }

  return overrides[tool.name] ?? tool.approval;
};

export const describeTool = (tool: ToolDefinition): AiToolInfo => ({
  name: tool.name,
  description: tool.description,
  area: tool.area,
  readOnly: tool.readOnly ?? false,
  escalates: tool.escalates ?? false,
  approval: tool.approval,
  locked: tool.locked ?? false,
  moduleId: tool.moduleId,
});

/**
 * Keep only overrides that name a known, unlocked tool; report the ones that were refused. An agent's overrides are
 * kept as given, a mode equal to the tool's default included.
 */
export const sanitizeOverrides = (
  overrides: ApprovalOverrides,
  tools: ToolDefinition[],
): { accepted: ApprovalOverrides; refused: string[] } => {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const accepted: ApprovalOverrides = {};
  const refused: string[] = [];

  for (const [name, mode] of Object.entries(overrides)) {
    const tool = byName.get(name);

    if (!tool || tool.locked) {
      refused.push(name);
      continue;
    }

    accepted[name] = mode;
  }

  return { accepted, refused };
};
